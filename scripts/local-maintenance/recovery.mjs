import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  statfs,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tsImport } from "tsx/esm/api";
import { verifyLocalApplication } from "./artifacts.mjs";
import {
  absoluteOption,
  disjointBackup,
  privateDirectory,
  pinBackup,
  withBackupRoot,
} from "./backup-root.mjs";
import {
  copyTree,
  createVerifiedBackup,
  sameTree,
  tree,
  verifyReadyBackup,
  pluginLinkPolicy,
  pluginLinkSummary,
} from "./backup.mjs";
import { canonicalPath, digest, within } from "./checks.mjs";
import {
  readManifest,
  requireCurrentMaintenanceProtocol,
  switchApplication,
  verifyApplication,
} from "./install.mjs";
import { fail } from "./process.mjs";

const recoveryId = (id) => /^recovery-[a-f0-9-]{36}$/.test(id ?? "");
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function launchContract() {
  return (await tsImport("../../packages/desktop/src/main/local-launch/index.ts", import.meta.url))
    .localLaunch;
}
async function pin(root, id, planId) {
  await withBackupRoot(root, false, (context) => pinBackup(context, id, planId));
}

async function dataState(roots) {
  const components = [];
  for (const [role, root] of [
    ["home", roots.home],
    ["data", roots.dataRoot],
  ]) {
    if (role === "data" && roots.home === roots.dataRoot) continue;
    const path = join(root, ".zcode");
    const value = await tree(path, true, pluginLinkPolicy);
    components.push({
      role,
      source: path,
      sha256: value.sha256,
      mode: value.mode,
      ...(value.linkPolicy
        ? { linkPolicy: value.linkPolicy, linkDependencies: value.linkDependencies }
        : {}),
    });
  }
  return { components, sha256: digest(JSON.stringify(components)) };
}
async function selectedPaths(options) {
  const paths = {
    home: await realpath(absoluteOption(options["--home"])),
    dataRoot: await realpath(absoluteOption(options["--data-root"])),
    localApp: await canonicalPath(absoluteOption(options["--local-app"])),
    officialApp: await canonicalPath(absoluteOption(options["--official-app"])),
    backupRoot: await canonicalPath(absoluteOption(options["--backup-root"])),
    currentManifest: absoluteOption(options["--current-manifest"]),
  };
  const selected = [...new Set([join(paths.home, ".zcode"), join(paths.dataRoot, ".zcode")])];
  for (const path of selected) {
    if ((await realpath(path)) !== path) fail("recovery-data-alias");
  }
  const disjoint = [...selected, paths.localApp, paths.officialApp, paths.backupRoot];
  for (let i = 0; i < disjoint.length; i++)
    for (let j = i + 1; j < disjoint.length; j++)
      if (within(disjoint[i], disjoint[j]) || within(disjoint[j], disjoint[i]))
        fail("recovery-path-overlap");
  return paths;
}
const launchInput = (paths) => ({
  home: paths.home,
  dataRoot: paths.dataRoot,
  applications: { local: paths.localApp, official: paths.officialApp },
});
async function currentApplication(paths) {
  const current = await readManifest(paths.currentManifest, "candidate");
  await verifyApplication(current, paths.localApp);
  return current;
}
async function snapshot(paths, id) {
  const verified = await verifyReadyBackup(paths.backupRoot, id);
  if (verified.identity !== digest(JSON.stringify([paths.home, paths.dataRoot])))
    fail("recovery-identity-mismatch");
  const data = verified.components.filter((part) => part.role !== "application");
  const expected = [...new Set([join(paths.home, ".zcode"), join(paths.dataRoot, ".zcode")])];
  if (
    !equal(
      data.map((part) => part.source),
      expected,
    )
  )
    fail("recovery-identity-mismatch");
  const directory = join(paths.backupRoot, id);
  let settings = {};
  try {
    settings = JSON.parse(
      await readFile(join(directory, "payload/home/.zcode/v2/setting.json"), "utf8"),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (
    !settings ||
    typeof settings !== "object" ||
    Array.isArray(settings) ||
    (settings.dataBaseDir !== undefined &&
      (typeof settings.dataBaseDir !== "string" || !settings.dataBaseDir.trim()))
  )
    fail("recovery-data-root-mismatch");
  const saved = await canonicalPath(
    resolve(paths.home, settings.dataBaseDir?.trim() ?? paths.home),
  );
  if (saved !== paths.dataRoot) fail("recovery-data-root-mismatch");
  return {
    ...verified,
    directory,
    manifestSha256: digest(await readFile(join(directory, "backup.json"))),
  };
}
async function lossSummary(current, old) {
  const loss = { added: 0, modified: 0, removed: 0, components: [] };
  for (const component of current.components) {
    const counts = { role: component.role, added: 0, modified: 0, removed: 0 };
    const live = (await tree(component.source, true, pluginLinkPolicy)).members;
    const saved = old.components.find((part) => part.role === component.role);
    const previous = (
      await tree(join(old.directory, `payload/${component.role}/.zcode`), false, saved.linkPolicy)
    ).members;
    for (const [name, member] of live) {
      if (member.kind === "directory") continue;
      if (!previous.has(name)) counts.added++;
      else if (!equal(member, previous.get(name))) counts.modified++;
    }
    for (const [name, member] of previous)
      if (member.kind !== "directory" && !live.has(name)) counts.removed++;
    loss.components.push(counts);
    for (const key of ["added", "modified", "removed"]) loss[key] += counts[key];
  }
  return loss;
}
async function createPlan(command, options) {
  const paths = await selectedPaths(options);
  const localLaunch = await launchContract();
  const result = await localLaunch.withMaintenance(launchInput(paths), async (roots) => {
    const current = await currentApplication(paths);
    const old = await snapshot(paths, options["--id"]);
    const data = await dataState(roots);
    const id = `recovery-${randomUUID()}`;
    const mode = command === "restore-plan" ? "data" : "program";
    const plan = {
      schema: 1,
      kind: "local-recovery-plan",
      id,
      mode,
      paths,
      backupId: old.id,
      backupManifestSha256: old.manifestSha256,
      from: current.manifest.source,
      to: old.source,
      currentManifestSha256: digest(current.raw),
      currentDataSha256: data.sha256,
      snapshotTime: old.createdAt,
      loss: await lossSummary(data, old),
      pluginResourceLinks: {
        current: pluginLinkSummary(data.components).count,
        snapshot: pluginLinkSummary(old.components).count,
        warning: pluginLinkSummary(old.components).warning,
      },
      createdAt: new Date().toISOString(),
      warning:
        mode === "data"
          ? "全量恢复旧快照会丢失快照之后的新增内容并撤销修改，删除的旧内容会重新出现；不进行跨版合并。"
          : "仅回退程序并保留当前数据；兼容性未确认时不启动旧程序。",
    };
    await pin(paths.backupRoot, old.id, id);
    const raw = JSON.stringify(plan, null, 2) + "\n";
    await withBackupRoot(paths.backupRoot, false, async (context) => {
      disjointBackup(context.root, [paths.localApp, ...data.components.map((part) => part.source)]);
      const directory = join(context.root, id);
      await mkdir(directory, { mode: 0o700 });
      await writeFile(join(directory, "plan.json"), raw, { flag: "wx", mode: 0o600 });
    });
    return {
      status: mode === "data" ? "confirmation-required" : "compatibility-review-required",
      ...plan,
      planSha256: digest(raw),
    };
  });
  if (result.kind !== "completed") fail(`recovery-${result.reason}`);
  return result.value;
}
async function loadPlan(options, mode) {
  if (!recoveryId(options["--plan"])) fail("recovery-plan-invalid");
  return withBackupRoot(options["--backup-root"], false, async (context) => {
    const directory = join(context.root, options["--plan"]);
    await privateDirectory(directory);
    const file = join(directory, "plan.json");
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.mode & 0o077) fail("recovery-plan-invalid");
    const raw = await readFile(file);
    const plan = JSON.parse(raw);
    if (
      plan.schema !== 1 ||
      plan.kind !== "local-recovery-plan" ||
      plan.mode !== mode ||
      plan.id !== options["--plan"] ||
      plan.paths.backupRoot !== context.root
    )
      fail("recovery-plan-invalid");
    const paths = await selectedPaths(
      Object.fromEntries(
        Object.entries({
          "--home": plan.paths.home,
          "--data-root": plan.paths.dataRoot,
          "--local-app": plan.paths.localApp,
          "--official-app": plan.paths.officialApp,
          "--backup-root": context.root,
          "--current-manifest": plan.paths.currentManifest,
        }),
      ),
    );
    if (!equal(paths, plan.paths)) fail("recovery-plan-path-changed");
    return { plan, paths, directory, planSha256: digest(raw) };
  });
}
async function validatePlan(context, roots) {
  const { plan, paths } = context;
  const current = await currentApplication(paths);
  if (
    !equal(current.manifest.source, plan.from) ||
    digest(current.raw) !== plan.currentManifestSha256
  )
    fail("recovery-current-changed");
  const old = await snapshot(paths, plan.backupId);
  if (old.manifestSha256 !== plan.backupManifestSha256 || !equal(old.source, plan.to))
    fail("recovery-snapshot-changed");
  if ((await dataState(roots)).sha256 !== plan.currentDataSha256) fail("recovery-data-changed");
  return old;
}
async function rollback(options) {
  const context = await loadPlan(options, "program");
  const { paths, plan, planSha256 } = context;
  const review = JSON.parse(await readFile(absoluteOption(options["--compatibility"]), "utf8"));
  const validateReview = () => {
    if (
      review.schema !== 1 ||
      review.kind !== "local-rollback-compatibility" ||
      review.decision !== "compatible" ||
      review.planSha256 !== planSha256 ||
      review.currentDataSha256 !== plan.currentDataSha256 ||
      !equal(review.from, plan.from) ||
      !equal(review.to, plan.to) ||
      typeof review.evidence !== "string" ||
      !review.evidence.trim()
    )
      fail("rollback-compatibility-unconfirmed");
  };
  validateReview();
  const old = await validatePlan(context, paths);
  const app = join(old.directory, "payload/application.app");
  const verified = await verifyLocalApplication(old.source, app);
  const target = {
    absolute: join(old.directory, "backup.json"),
    raw: await readFile(join(old.directory, "backup.json")),
    manifest: {
      app: "payload/application.app",
      source: old.source,
      package: {
        metadata: verified.packaged.metadata,
        plist: verified.plist,
        appTreeSha256: old.components[0].sha256,
      },
    },
  };
  return switchApplication(
    {
      "--current-manifest": paths.currentManifest,
      "--home": paths.home,
      "--data-root": paths.dataRoot,
      "--local-app": paths.localApp,
      "--official-app": paths.officialApp,
      "--backup-root": paths.backupRoot,
    },
    {
      target,
      validate: async (roots) => {
        validateReview();
        await validatePlan(context, roots);
      },
      planId: plan.id,
    },
  );
}

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function restore(options) {
  const context = await loadPlan(options, "data");
  if (options["--confirm"] !== context.planSha256) fail("restore-confirmation-required");
  const { paths, plan, directory } = context;
  await validatePlan(context, paths);
  await requireCurrentMaintenanceProtocol(await currentApplication(paths), paths.dataRoot);
  const localLaunch = await launchContract();
  const journalFile = join(directory, "journal.json");
  const journal = {
    schema: 1,
    kind: "local-data-restore",
    planId: plan.id,
    planSha256: context.planSha256,
    phase: "prepared",
    entries: [],
    stages: [],
  };
  await writeFile(journalFile, JSON.stringify(journal) + "\n", { flag: "wx", mode: 0o600 });
  const save = async () => {
    const temporary = join(directory, `journal-${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(journal, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, journalFile);
  };
  const undo = async () => {
    journal.phase = "reverting";
    await save();
    for (const entry of [...journal.entries].reverse()) {
      if (entry.placed) {
        await rename(entry.current, entry.after);
        entry.placed = false;
      }
      if (entry.moved) {
        await rename(entry.before, entry.current);
        entry.moved = false;
      }
      await save();
    }
    if ((await dataState(paths)).sha256 !== plan.currentDataSha256) fail("restore-revert-mismatch");
    journal.phase = "failed-current-preserved";
    await save();
  };
  const switched = await localLaunch.switchToCandidate(launchInput(paths), async (roots) => {
    const old = await validatePlan(context, roots);
    const backup = await createVerifiedBackup({
      roots,
      localApp: paths.localApp,
      officialApp: paths.officialApp,
      appManifest: paths.currentManifest,
      backupRoot: paths.backupRoot,
      recoveryPlanId: plan.id,
    });
    journal.currentBackupId = backup.id;
    await verifyReadyBackup(paths.backupRoot, backup.id);
    journal.phase = "current-backed-up";
    await save();
    console.log(
      JSON.stringify({ status: "current-backed-up", planId: plan.id, currentBackupId: backup.id }),
    );
    // 当前基线发布后再次核对，不能让备份或确认期间变化的数据被旧计划覆盖。
    await validatePlan(context, roots);
    for (const component of old.components.filter((part) => part.role !== "application")) {
      const root = component.role === "home" ? paths.home : paths.dataRoot;
      const stage = join(root, `.zcode-restore-${plan.id}`);
      const source = join(old.directory, `payload/${component.role}/.zcode`);
      const required = BigInt(
        (await tree(source, false, component.linkPolicy)).bytes + 64 * 1024 * 1024,
      );
      const space = await statfs(root, { bigint: true });
      if (space.bavail * space.bsize < required) fail("restore-insufficient-space");
      journal.stages.push(stage);
      await save();
      await mkdir(stage, { mode: 0o700 });
      const after = join(stage, "after");
      await copyTree(source, after);
      // SQLite 核验会修改 WAL 的 shm，即使 query_only 也不是逐字节只读。
      // validatePlan 已在独立演练副本核验 SQLite；这里只核对完整树同一性，不能再污染将要恢复的载荷。
      await sameTree(after, component);
      await mkdir(join(stage, "before/local"), { recursive: true, mode: 0o700 });
      const current = join(root, ".zcode");
      const local = await lstat(join(current, "local"));
      if (!local.isDirectory() || local.isSymbolicLink()) fail("restore-control-alias");
      const names = new Set([...(await readdir(current)), ...(await readdir(after))]);
      names.delete("local");
      if ((await exists(join(current, "local/v1"))) || (await exists(join(after, "local/v1"))))
        names.add("local/v1");
      for (const name of [...names].sort())
        journal.entries.push({
          current: join(current, name),
          before: join(stage, "before", name),
          after: join(after, name),
          hadOriginal: await exists(join(current, name)),
          hasTarget: await exists(join(after, name)),
          moved: false,
          placed: false,
        });
    }
    journal.phase = "replacing";
    await save();
    for (const entry of journal.entries) {
      // 先持久化意图；崩溃发生在改名前后均留下路径和 before 副本，不按时间猜测已完成。
      journal.next = entry.current;
      await save();
      if (entry.hadOriginal) {
        await rename(entry.current, entry.before);
        entry.moved = true;
        await save();
      }
      if (entry.hasTarget) {
        await rename(entry.after, entry.current);
        entry.placed = true;
        await save();
      }
    }
    for (const component of old.components.filter((part) => part.role !== "application"))
      await sameTree(component.source, component, true);
    journal.phase = "restored-stopped";
    delete journal.next;
    await save();
    return undefined;
  });
  if (switched.kind === "blocked") {
    journal.phase = `blocked-${switched.reason}`;
    await save();
    fail(`restore-${switched.reason}`);
  }
  if (switched.kind === "failed") {
    const reverted = await localLaunch
      .abortSwitch(launchInput(paths), switched.takeoverToken, undo)
      .catch(() => null);
    if (reverted?.kind !== "completed") fail("restore-recovery-unconfirmed");
    for (const stage of journal.stages)
      await rm(stage, { recursive: true, force: true }).catch(() => {});
    throw switched.error;
  }
  const completed = await localLaunch.abortSwitch(
    launchInput(paths),
    switched.takeoverToken,
    async () => {},
  );
  if (completed.kind !== "completed") fail("restore-complete-unconfirmed");
  for (const stage of journal.stages)
    await rm(stage, { recursive: true, force: true }).catch(() => {});
  return {
    status: "restored-stopped",
    planId: plan.id,
    snapshotId: plan.backupId,
    currentBackupId: journal.currentBackupId,
    journal: journalFile,
  };
}

export async function recoveryCommand(command, options) {
  if (process.platform !== "darwin") fail("unsupported-recovery-host");
  if (command.endsWith("-plan")) return createPlan(command, options);
  if (command === "rollback") return rollback(options);
  return restore(options);
}
