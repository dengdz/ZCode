import {
  cp,
  mkdir,
  lstat,
  realpath,
  readFile,
  writeFile,
  rename,
  rm,
  statfs,
  readlink,
  open,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, dirname, resolve, relative, isAbsolute } from "node:path";
import { verifyLocalApplication } from "./artifacts.mjs";
import { tsImport } from "tsx/esm/api";
import { fail, run } from "./process.mjs";
import { json, digest, within, canonicalPath } from "./checks.mjs";
import { applicationTree, treeDigest } from "./package-tree.mjs";
import {
  absoluteOption,
  backupId,
  withBackupRoot,
  backupDirectories,
  privateDirectory,
  disjointBackup,
  pinBackup,
} from "./backup-root.mjs";

export const included = (path) =>
  !path.startsWith("local/") || path === "local/v1" || path.startsWith("local/v1/");
const location = (role) =>
  role === "application" ? "payload/application.app" : `payload/${role}/.zcode`;
const sha = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export async function tree(path, data = false) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) fail("backup-source-type");
  const members = await applicationTree(path, { include: data ? included : () => true });
  let bytes = 4096;
  for (const [name, member] of members) {
    bytes += 4096;
    const file = join(path, name);
    if (member.kind === "file") bytes += (await lstat(file)).size;
    if (member.kind === "link") {
      const link = await readlink(file);
      // 快照不能把业务路径或绝对链接带回在用源；只接受范围内可解析的相对链接。
      if (
        isAbsolute(link) ||
        !within(path, resolve(dirname(file), link)) ||
        !within(path, await realpath(file))
      )
        fail("backup-external-link");
    }
  }
  return { sha256: treeDigest(members), mode: info.mode & 0o777, bytes, members };
}
export async function copyTree(source, target, data = false) {
  await cp(source, target, {
    recursive: true,
    errorOnExist: true,
    force: false,
    verbatimSymlinks: true,
    preserveTimestamps: true,
    filter: (path) => !data || included(relative(source, path).split("\\").join("/")),
  });
}
export async function sameTree(path, expected, data = false) {
  const actual = await tree(path, data);
  if (actual.sha256 !== expected.sha256 || actual.mode !== expected.mode)
    fail("backup-content-mismatch");
  return actual;
}
async function signed(path) {
  await run("codesign", ["--verify", "--deep", "--strict", path]);
}
export async function sqliteIntegrity(path, members) {
  for (const [name, member] of members) {
    if (member.kind !== "file") continue;
    const file = join(path, name);
    const handle = await open(file, "r");
    const header = Buffer.alloc(16);
    try {
      await handle.read(header, 0, 16, 0);
    } finally {
      await handle.close();
    }
    // 数据库页头本身也可能损坏；已知数据库扩展名仍必须交给 SQLite 核验，不能因 magic 丢失被当作普通文件放行。
    if (
      (header.toString() === "SQLite format 3\0" || /\.(db|sqlite|sqlite3)$/i.test(name)) &&
      // Bug 原因：干净关闭的 WAL 数据库常无 -wal/-shm，sqlite3 -readonly 会因无法建立共享内存而打不开。
      // 这里只操作已隔离的恢复副本，先 query_only 再检查，既禁止业务写入又保持 WAL 读取语义。
      (await run("sqlite3", [file, "PRAGMA query_only=ON; PRAGMA integrity_check;"])) !== "ok"
    )
      fail("backup-database-invalid");
  }
}
async function rehearse(directory, components) {
  const rehearsal = join(directory, `.verify-${randomUUID()}`);
  await mkdir(rehearsal, { mode: 0o700 });
  try {
    for (const component of components) {
      const target = join(rehearsal, component.role);
      await copyTree(join(directory, location(component.role)), target);
      const restored = await sameTree(target, component);
      if (component.role === "application") await signed(target);
      else await sqliteIntegrity(target, restored.members);
    }
  } finally {
    await rm(rehearsal, { recursive: true, force: true });
  }
}
function validManifest(manifest, id, owner) {
  const roles = manifest?.components?.map((part) => part.role);
  if (
    manifest?.schema !== 1 ||
    manifest.kind !== "backup" ||
    manifest.status !== "ready" ||
    manifest.id !== id ||
    manifest.rootToken !== owner.token ||
    !Number.isSafeInteger(manifest.sequence) ||
    manifest.sequence < 1 ||
    !Number.isFinite(Date.parse(manifest.createdAt)) ||
    !/^[a-f0-9]{40}$/.test(manifest.source?.commit ?? "") ||
    !/^\d+\.\d+\.\d+-local\.[1-9]\d*$/.test(manifest.source?.version ?? "") ||
    !sha(manifest.identity) ||
    !sha(manifest.appManifestSha256) ||
    !roles ||
    roles[0] !== "application" ||
    roles[1] !== "home" ||
    roles.length > 3 ||
    (roles.length === 3 && roles[2] !== "data") ||
    manifest.components.some(
      (part) =>
        !sha(part.sha256) ||
        !Number.isInteger(part.mode) ||
        part.mode < 0 ||
        part.mode > 0o777 ||
        !isAbsolute(part.source),
    )
  )
    fail("backup-manifest-invalid");
}
async function verify(context, id, exercise = false) {
  if (!backupId(id)) fail("backup-id-invalid");
  const directory = join(context.root, id);
  await privateDirectory(directory);
  const file = join(directory, "backup.json");
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
    fail("backup-manifest-invalid");
  const manifest = await json(file);
  validManifest(manifest, id, context.owner);
  for (const component of manifest.components) {
    disjointBackup(context.root, [component.source]);
    // 逐级拒绝 payload 目录别名，避免清单校验/演练越出私有组目录。
    let parent = directory;
    for (const name of location(component.role).split("/")) {
      parent = join(parent, name);
      const info = await lstat(parent);
      if (!info.isDirectory() || info.isSymbolicLink()) fail("backup-source-type");
    }
    await sameTree(parent, component);
  }
  await verifyLocalApplication(manifest.source, join(directory, location("application")));
  if (exercise) await rehearse(directory, manifest.components);
  return manifest;
}
async function listing(context) {
  const backups = [];
  for (const id of await backupDirectories(context.root)) {
    try {
      const manifest = await verify(context, id);
      backups.push({
        id,
        status: "usable",
        source: manifest.source,
        createdAt: manifest.createdAt,
        sequence: manifest.sequence,
        identity: manifest.identity,
      });
    } catch (e) {
      backups.push({ id, status: "unusable", reason: e.maintenanceCode ?? "backup-incomplete" });
    }
  }
  return backups.sort((a, b) => (b.sequence ?? 0) - (a.sequence ?? 0));
}
async function retain(context, identity) {
  const usable = (await listing(context)).filter(
    (item) => item.status === "usable" && item.identity === identity,
  );
  const ordinary = [];
  for (const item of usable) {
    // pin 是额外恢复依据，不能占用最近三组普通基线的名额；未知标记也保守保留。
    try {
      await lstat(join(context.root, item.id, ".recovery-pin"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      ordinary.push(item);
    }
  }
  if (ordinary.length <= 3) return;
  for (const item of ordinary.slice(0, 3)) await verify(context, item.id, true);
  for (const item of ordinary.slice(3)) {
    await verify(context, item.id);
    await rm(join(context.root, item.id), { recursive: true });
  }
}

async function createBackup(context, options, roots, recoveryPlanId) {
  const app = await realpath(absoluteOption(options["--local-app"]));
  disjointBackup(context.root, [app, join(roots.home, ".zcode"), join(roots.dataRoot, ".zcode")]);
  const raw = await readFile(absoluteOption(options["--app-manifest"]));
  const candidate = JSON.parse(raw);
  if (
    candidate.schema !== 1 ||
    candidate.kind !== "candidate" ||
    candidate.status !== "ready" ||
    !/^[a-f0-9]{40}$/.test(candidate.source?.commit ?? "") ||
    candidate.source.version !== candidate.package?.version ||
    !sha(candidate.package?.appTreeSha256)
  )
    fail("backup-app-manifest-invalid");
  const appTree = await tree(app);
  if (appTree.sha256 !== candidate.package.appTreeSha256) fail("backup-application-mismatch");
  await verifyLocalApplication(candidate.source, app);
  const components = [{ role: "application", source: app, ...appTree }];
  for (const [role, root] of [
    ["home", roots.home],
    ["data", roots.dataRoot],
  ]) {
    if (role === "data" && roots.home === roots.dataRoot) continue;
    const source = join(root, ".zcode");
    components.push({ role, source, ...(await tree(source, true)) });
  }
  if (!(await lstat(join(roots.dataRoot, ".zcode/v2"))).isDirectory())
    fail("backup-business-data-missing");
  const required =
    components.reduce((total, component) => total + component.bytes, 0) * 2 + 64 * 1024 * 1024;
  const space = await statfs(context.root, { bigint: true });
  if (space.bavail * space.bsize < BigInt(required)) fail("backup-insufficient-space");
  const id = `backup-${randomUUID()}`;
  const directory = join(context.root, id);
  await mkdir(directory, { mode: 0o700 });
  await writeFile(
    join(directory, "pending.json"),
    JSON.stringify({ schema: 1, kind: "backup-pending", id, createdAt: new Date().toISOString() }) +
      "\n",
    { flag: "wx", mode: 0o600 },
  );
  for (const component of components) {
    await copyTree(
      component.source,
      join(directory, location(component.role)),
      component.role !== "application",
    );
    await sameTree(component.source, component, component.role !== "application");
    await sameTree(join(directory, location(component.role)), component);
  }
  await rehearse(directory, components);
  // 恢复演练可能耗时；发布前再次核对所有源，不能只核对刚复制完成的一个组件。
  for (const component of components)
    await sameTree(component.source, component, component.role !== "application");
  const previous = await listing(context);
  const manifest = {
    schema: 1,
    kind: "backup",
    status: "ready",
    id,
    rootToken: context.owner.token,
    sequence: Math.max(0, ...previous.map((item) => item.sequence ?? 0)) + 1,
    createdAt: new Date().toISOString(),
    identity: digest(JSON.stringify([roots.home, roots.dataRoot])),
    source: candidate.source,
    appManifestSha256: digest(raw),
    verification: "file-restore+sqlite-integrity+application-signature",
    components: components.map(({ members: _members, bytes: _bytes, ...component }) => component),
  };
  validManifest(manifest, id, context.owner);
  await writeFile(join(directory, "backup.json.tmp"), JSON.stringify(manifest, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  await rename(join(directory, "backup.json.tmp"), join(directory, "backup.json"));
  await rm(join(directory, "pending.json"));
  if (recoveryPlanId !== undefined) await pinBackup(context, id, recoveryPlanId);
  await retain(context, manifest.identity);
  return { status: "usable", id, source: manifest.source };
}
export async function backupCommand(command, options) {
  if (process.platform !== "darwin") fail("unsupported-backup-host");
  if (command !== "backup") {
    return withBackupRoot(options["--backup-root"], false, async (context) => {
      if (command === "backup-list") return { backups: await listing(context) };
      const manifest = await verify(context, options["--id"], true);
      return { status: "usable", id: manifest.id, source: manifest.source };
    });
  }
  const home = await realpath(absoluteOption(options["--home"]));
  const dataRoot = await realpath(absoluteOption(options["--data-root"]));
  const applications = {
    local: absoluteOption(options["--local-app"]),
    official: absoluteOption(options["--official-app"]),
  };
  for (const root of new Set([home, dataRoot])) {
    for (const subdirectory of [".zcode", ".zcode/v2"]) {
      const info = await lstat(join(root, subdirectory));
      if (!info.isDirectory() || info.isSymbolicLink()) fail("backup-source-type");
    }
  }
  const { localLaunch } = await tsImport(
    "../../packages/desktop/src/main/local-launch/index.ts",
    import.meta.url,
  );
  // home 设置可能指向参数未确认的业务根；必须先由原 owner 确认实际根，再创建目的根，避免拒绝路径污染在用数据。
  const result = await localLaunch.withMaintenance(
    { home, dataRoot, applications },
    async (roots) => {
      return createVerifiedBackup({
        roots,
        localApp: applications.local,
        officialApp: applications.official,
        appManifest: options["--app-manifest"],
        backupRoot: options["--backup-root"],
      });
    },
  );
  if (result.kind !== "completed") fail(`backup-${result.reason}`);
  return result.value;
}

export async function createVerifiedBackup(input) {
  const destination = absoluteOption(input.backupRoot);
  const target = join(await realpath(dirname(destination)), destination.split("/").at(-1));
  disjointBackup(target, [
    join(input.roots.home, ".zcode"),
    join(input.roots.dataRoot, ".zcode"),
    await realpath(input.localApp),
    // 官网包也可能通过别名选择；复用真实路径解析，防止在未备份的原官网包内创建目录。
    await canonicalPath(input.officialApp),
  ]);
  return withBackupRoot(destination, true, (context) =>
    createBackup(
      context,
      {
        "--local-app": input.localApp,
        "--app-manifest": input.appManifest,
      },
      input.roots,
      input.recoveryPlanId,
    ),
  );
}

export async function verifyReadyBackup(backupRoot, id) {
  return withBackupRoot(backupRoot, false, async (context) => {
    const manifest = await verify(context, id, true);
    return {
      status: "usable",
      id: manifest.id,
      source: manifest.source,
      identity: manifest.identity,
      createdAt: manifest.createdAt,
      components: manifest.components,
    };
  });
}
