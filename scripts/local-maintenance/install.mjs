import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tsImport } from "tsx/esm/api";
import { verifyLocalApplication } from "./artifacts.mjs";
import { applicationTree, treeDigest } from "./package-tree.mjs";
import { absoluteOption, withBackupRoot } from "./backup-root.mjs";
import { createVerifiedBackup, verifyReadyBackup } from "./backup.mjs";
import { canonicalPath, digest, within } from "./checks.mjs";
import { fail } from "./process.mjs";

const maintenanceProtocol = 1;
const sha256 = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const versionParts = (value) => {
  const match = /^(\d+)\.(\d+)\.(\d+)-local\.([1-9]\d*)$/.exec(value ?? "");
  return match ? match.slice(1).map(Number) : null;
};
const compareVersions = (left, right) => {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) return null;
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
};

async function readManifest(path, kind) {
  const absolute = absoluteOption(path);
  const raw = await readFile(absolute);
  const manifest = JSON.parse(raw);
  if (
    manifest.schema !== 1 ||
    manifest.kind !== kind ||
    manifest.status !== "ready" ||
    !/^[a-f0-9]{40}$/.test(manifest.source?.commit ?? "") ||
    manifest.source.version !== manifest.package?.version ||
    !sha256(manifest.package?.appTreeSha256)
  )
    fail(`${kind}-manifest-invalid`);
  return { absolute, raw, manifest };
}

function applicationPath(entry) {
  if (!entry.manifest.app || !isAbsolute(entry.absolute)) fail("candidate-application-invalid");
  const app = resolve(dirname(entry.absolute), entry.manifest.app);
  if (!within(dirname(entry.absolute), app) || app === dirname(entry.absolute))
    fail("candidate-application-invalid");
  return app;
}

async function verifyApplication(entry, app) {
  const info = await lstat(app);
  if (!info.isDirectory() || info.isSymbolicLink()) fail("candidate-application-invalid");
  const members = await applicationTree(app);
  if (treeDigest(members) !== entry.manifest.package.appTreeSha256)
    fail("candidate-application-mismatch");
  const verified = await verifyLocalApplication(entry.manifest.source, app);
  if (
    JSON.stringify(verified.packaged.metadata) !==
      JSON.stringify(entry.manifest.package.metadata) ||
    JSON.stringify(verified.plist) !== JSON.stringify(entry.manifest.package.plist)
  )
    fail("candidate-package-manifest-mismatch");
}

async function runningCurrentOwner(dataRoot, appPidFile) {
  try {
    const owner = JSON.parse(await readFile(appPidFile, "utf8"));
    return owner?.version === 1 && owner.edition === "local" && owner.phase === "running"
      ? owner
      : null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

async function waitForStartup(input) {
  const ownerPath = join(input.dataRoot, ".zcode/local/launch-owner.json");
  const runtimePath = join(input.dataRoot, ".zcode/local/maintenance/runtime.json");
  const deadline = Date.now() + input.timeoutMs;
  do {
    try {
      const owner = JSON.parse(await readFile(ownerPath, "utf8"));
      const runtime = JSON.parse(await readFile(runtimePath, "utf8"));
      if (
        owner.version === 1 &&
        owner.edition === "local" &&
        owner.phase === "running" &&
        Number.isSafeInteger(owner.childPid) &&
        runtime.schema === 1 &&
        runtime.kind === "local-maintenance-runtime" &&
        runtime.state === "ready" &&
        runtime.appPid === owner.childPid &&
        runtime.token === owner.token &&
        runtime.version === input.version
      ) {
        try {
          process.kill(owner.childPid, 0);
        } catch {
          fail("install-startup-failed");
        }
        return owner;
      }
    } catch (error) {
      if (error.maintenanceCode) throw error;
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  fail("install-startup-unconfirmed");
}

async function startTakeoverLauncher(input, takeoverToken) {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const log = await open(join(input.dataRoot, ".zcode/local/maintenance/launcher.log"), "a", 0o600);
  const child = spawn(
    process.execPath,
    [
      join(repo, "node_modules/tsx/dist/cli.mjs"),
      join(repo, "scripts/local-launch.ts"),
      "--edition",
      "local",
      "--takeover-token",
      takeoverToken,
      "--home",
      input.home,
      "--data-root",
      input.dataRoot,
      "--official-app",
      input.officialApp,
      "--local-app",
      input.localApp,
    ],
    {
      cwd: repo,
      detached: true,
      env: process.env,
      stdio: ["ignore", log.fd, log.fd],
    },
  );
  const spawned = await new Promise((resolve) => {
    child.once("error", () => resolve(false));
    child.once("spawn", () => resolve(true));
  });
  await log.close();
  if (!spawned) fail("install-launcher-failed");
  child.unref();
}

async function writeSwitchResult(backupRoot, value) {
  const id = `switch-${randomUUID()}`;
  return withBackupRoot(backupRoot, false, async (context) => {
    const directory = join(context.root, id);
    await mkdir(directory, { mode: 0o700 });
    await writeFile(
      join(directory, "switch.json"),
      JSON.stringify({
        schema: 1,
        kind: "local-switch",
        status: "ready",
        id,
        ...value,
        completedAt: new Date().toISOString(),
      }) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    return id;
  });
}

export async function installCommand(options) {
  if (process.platform !== "darwin") fail("unsupported-install-host");
  const candidate = await readManifest(options["--candidate"], "candidate");
  const current = await readManifest(options["--current-manifest"], "candidate");
  if (candidate.manifest.package.metadata?.localMaintenanceProtocol !== maintenanceProtocol)
    fail("maintenance-protocol-unsupported");
  const candidateVersion = candidate.manifest.source.version;
  const currentVersion = current.manifest.source.version;
  const comparison = compareVersions(candidateVersion, currentVersion);
  if (comparison === null) fail("install-version-invalid");
  if (comparison <= 0) fail("install-version-not-newer");
  const candidateApp = applicationPath(candidate);
  const currentApp = await realpath(absoluteOption(options["--local-app"]));
  const home = await realpath(absoluteOption(options["--home"]));
  const dataRoot = await realpath(absoluteOption(options["--data-root"]));
  const officialApp = absoluteOption(options["--official-app"]);
  const backupRoot = absoluteOption(options["--backup-root"]);
  const target = await canonicalPath(currentApp);
  const official = await canonicalPath(officialApp);
  if (within(official, target) || within(target, official)) fail("official-application-overlap");
  for (const root of [home, dataRoot])
    if (within(join(root, ".zcode"), target)) fail("application-inside-business-data");

  await verifyApplication(candidate, candidateApp);
  await verifyApplication(current, currentApp);

  const ownerPath = join(dataRoot, ".zcode/local/launch-owner.json");
  const runningOwner = await runningCurrentOwner(dataRoot, ownerPath);
  if (
    runningOwner &&
    current.manifest.package.metadata.localMaintenanceProtocol !== maintenanceProtocol
  )
    fail("current-app-quit-required");

  const parent = dirname(currentApp);
  const staging = join(parent, `.ZCode Local.staging-${randomUUID()}.app`);
  const rollbackPath = join(parent, `.ZCode Local.previous-${randomUUID()}.app`);
  try {
    await cp(candidateApp, staging, {
      recursive: true,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
      preserveTimestamps: true,
    });
    await verifyApplication(candidate, staging);
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  console.log(
    JSON.stringify({
      status: "prepared",
      from: currentVersion,
      to: candidateVersion,
      target: currentApp,
    }),
  );

  const { localLaunch } = await tsImport(
    "../../packages/desktop/src/main/local-launch/index.ts",
    import.meta.url,
  );
  const applications = { local: currentApp, official: officialApp };
  let backupId;
  const switched = await localLaunch
    .switchToCandidate({ home, dataRoot, applications }, async (roots) => {
      let movedCurrent = false;
      let replacedCurrent = false;
      try {
        const backup = await createVerifiedBackup({
          roots,
          localApp: currentApp,
          officialApp,
          appManifest: current.absolute,
          backupRoot,
        });
        if (backup?.status !== "usable" || !backup.id) fail("backup-not-ready");
        backupId = backup.id;
        await verifyReadyBackup(backupRoot, backup.id);
        console.log(JSON.stringify({ status: "switching", backupId }));
        await verifyApplication(current, currentApp);
        await verifyApplication(candidate, staging);
        await rename(currentApp, rollbackPath);
        movedCurrent = true;
        try {
          await rename(staging, currentApp);
          replacedCurrent = true;
        } catch (error) {
          await rename(rollbackPath, currentApp);
          movedCurrent = false;
          throw error;
        }
        await verifyApplication(candidate, currentApp);
        return { from: current.manifest.source, to: candidate.manifest.source };
      } catch (error) {
        if (movedCurrent) {
          if (replacedCurrent)
            await rm(currentApp, { recursive: true, force: true }).catch(() => {});
          await rename(rollbackPath, currentApp).catch(() => {});
        }
        throw error;
      }
    })
    .catch(async (error) => {
      await rm(staging, { recursive: true, force: true }).catch(() => {});
      throw error;
    });
  if (switched.kind !== "completed") {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    fail(`install-${switched.reason}`);
  }

  const configuredTimeout = Number(process.env.ZCODE_MAINTENANCE_STARTUP_TIMEOUT_MS ?? 20_000);
  await startTakeoverLauncher(
    { home, dataRoot, officialApp, localApp: currentApp },
    switched.takeoverToken,
  );
  const startupOwner = await waitForStartup({
    dataRoot,
    version: candidateVersion,
    timeoutMs:
      Number.isSafeInteger(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 20_000,
  });
  await rm(rollbackPath, { recursive: true, force: true }).catch(() => {});
  const switchId = await writeSwitchResult(backupRoot, {
    backupId,
    from: current.manifest.source,
    to: candidate.manifest.source,
    candidateManifestSha256: digest(candidate.raw),
    currentManifestSha256: digest(current.raw),
    appPid: startupOwner.childPid,
    connectionCheck: "local-host-ready",
  });
  return {
    status: "installed",
    switchId,
    backupId,
    version: candidateVersion,
    appPid: startupOwner.childPid,
  };
}
