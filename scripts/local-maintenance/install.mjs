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
const isProcessAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
};

async function readManifest(path, kind) {
  const absolute = await canonicalPath(absoluteOption(path));
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

async function applicationPath(entry) {
  if (!entry.manifest.app || !isAbsolute(entry.absolute)) fail("candidate-application-invalid");
  const root = dirname(entry.absolute);
  const requested = resolve(root, entry.manifest.app);
  if (!within(root, requested) || requested === root) fail("candidate-application-invalid");
  const app = await canonicalPath(requested);
  if (!within(root, app) || app === root) fail("candidate-application-invalid");
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

function installPathsDisjoint(paths) {
  for (let left = 0; left < paths.length; left++) {
    for (let right = left + 1; right < paths.length; right++) {
      if (within(paths[left], paths[right]) || within(paths[right], paths[left]))
        fail("install-path-overlap");
    }
  }
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

async function readStartupOwner(path) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  let owner;
  try {
    owner = JSON.parse(raw);
  } catch {
    fail("install-startup-unconfirmed");
  }
  const keys = ["version", "token", "edition", "launcherPid", "childPid", "phase"];
  if (
    !owner ||
    owner.version !== 1 ||
    typeof owner.token !== "string" ||
    !owner.token ||
    owner.edition !== "local" ||
    !["preparing", "running", "switching", "unconfirmed"].includes(owner.phase) ||
    !Number.isSafeInteger(owner.launcherPid) ||
    owner.launcherPid <= 0 ||
    (owner.childPid !== undefined &&
      (!Number.isSafeInteger(owner.childPid) || owner.childPid <= 0)) ||
    Object.keys(owner).some((key) => !keys.includes(key))
  )
    fail("install-startup-unconfirmed");
  return owner;
}

async function readStartupRuntime(path) {
  let runtime;
  try {
    runtime = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    if (error instanceof SyntaxError) fail("install-startup-unconfirmed");
    throw error;
  }
  const keys = ["schema", "kind", "token", "appPid", "version", "state", "updatedAt"];
  if (
    runtime.schema !== 1 ||
    runtime.kind !== "local-maintenance-runtime" ||
    typeof runtime.token !== "string" ||
    !runtime.token ||
    !Number.isSafeInteger(runtime.appPid) ||
    runtime.appPid <= 0 ||
    typeof runtime.version !== "string" ||
    !runtime.version ||
    !["starting", "ready"].includes(runtime.state) ||
    typeof runtime.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(runtime.updatedAt)) ||
    Object.keys(runtime).some((key) => !keys.includes(key))
  )
    fail("install-startup-unconfirmed");
  return runtime;
}

function sameOwner(left, right) {
  return (
    left.token === right.token &&
    left.edition === right.edition &&
    left.launcherPid === right.launcherPid &&
    left.childPid === right.childPid &&
    left.phase === right.phase
  );
}

async function waitForStartup(input) {
  const ownerPaths = [
    ...new Set(
      [input.home, input.dataRoot].map((root) => join(root, ".zcode/local/launch-owner.json")),
    ),
  ];
  const runtimePath = join(input.dataRoot, ".zcode/local/maintenance/runtime.json");
  const deadline = Date.now() + input.timeoutMs;
  do {
    const owners = await Promise.all(ownerPaths.map(readStartupOwner));
    if (owners.every(Boolean)) {
      const owner = owners[0];
      const consistent = owners.every((candidate) => sameOwner(owner, candidate));
      if (!consistent) {
        if (owners.every((candidate) => candidate.phase === "running"))
          fail("install-startup-unconfirmed");
      } else if (owner.phase === "running") {
        if (
          owner.token === input.switchToken ||
          owner.childPid === undefined ||
          !isProcessAlive(owner.launcherPid) ||
          !isProcessAlive(owner.childPid)
        )
          fail("install-startup-unconfirmed");
        const runtime = await readStartupRuntime(runtimePath);
        if (
          runtime?.state === "ready" &&
          runtime.appPid === owner.childPid &&
          runtime.token === owner.token &&
          runtime.version === input.version
        )
          return owner;
      }
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

async function abortUnstartedSwitch(localLaunch, input, takeoverToken, paths, replacement) {
  return localLaunch.abortSwitch(input, takeoverToken, async () => {
    if (replacement.replacedCurrent) {
      await rename(paths.currentApp, paths.staging);
      replacement.replacedCurrent = false;
    }
    if (replacement.movedCurrent) {
      await rename(paths.rollbackPath, paths.currentApp);
      replacement.movedCurrent = false;
    }
    await rm(paths.staging, { recursive: true, force: true });
  });
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
  const candidateApp = await applicationPath(candidate);
  const currentApp = await realpath(absoluteOption(options["--local-app"]));
  const home = await realpath(absoluteOption(options["--home"]));
  const dataRoot = await realpath(absoluteOption(options["--data-root"]));
  const officialApp = absoluteOption(options["--official-app"]);
  const backupRoot = await canonicalPath(absoluteOption(options["--backup-root"]));
  const target = await canonicalPath(currentApp);
  const official = await canonicalPath(officialApp);
  if (within(official, target) || within(target, official)) fail("official-application-overlap");
  const staging = join(dirname(currentApp), `.ZCode Local.staging-${randomUUID()}.app`);
  const rollbackPath = join(dirname(currentApp), `.ZCode Local.previous-${randomUUID()}.app`);
  const stagingPath = await canonicalPath(staging);
  const rollbackTarget = await canonicalPath(rollbackPath);
  const selectedLocalRoots = new Set(
    await Promise.all(
      [join(home, ".zcode"), join(dataRoot, ".zcode")].map((root) => canonicalPath(root)),
    ),
  );
  installPathsDisjoint([
    ...selectedLocalRoots,
    candidateApp,
    target,
    official,
    backupRoot,
    stagingPath,
    rollbackTarget,
  ]);

  await verifyApplication(candidate, candidateApp);
  await verifyApplication(current, currentApp);

  const ownerPath = join(dataRoot, ".zcode/local/launch-owner.json");
  const runningOwner = await runningCurrentOwner(dataRoot, ownerPath);
  if (
    runningOwner &&
    current.manifest.package.metadata.localMaintenanceProtocol !== maintenanceProtocol
  )
    fail("current-app-quit-required");

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
  const configuredRequestTimeout = Number(
    process.env.ZCODE_MAINTENANCE_REQUEST_TIMEOUT_MS ?? 5_000,
  );
  let backupId;
  const replacement = { movedCurrent: false, replacedCurrent: false };
  const switchInput = {
    home,
    dataRoot,
    applications,
    requestTimeoutMs:
      Number.isSafeInteger(configuredRequestTimeout) && configuredRequestTimeout > 0
        ? configuredRequestTimeout
        : 5_000,
  };
  const switched = await localLaunch.switchToCandidate(switchInput, async (roots) => {
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
    replacement.movedCurrent = true;
    await rename(staging, currentApp);
    replacement.replacedCurrent = true;
    await verifyApplication(candidate, currentApp);
    return { from: current.manifest.source, to: candidate.manifest.source };
  });
  if (switched.kind === "failed") {
    const aborted = await abortUnstartedSwitch(
      localLaunch,
      switchInput,
      switched.takeoverToken,
      { currentApp, staging, rollbackPath },
      replacement,
    ).catch(() => null);
    if (aborted?.kind !== "completed") fail("install-rollback-unconfirmed");
    throw switched.error;
  }
  if (switched.kind === "blocked") {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    fail(`install-${switched.reason}`);
  }

  const configuredTimeout = Number(process.env.ZCODE_MAINTENANCE_STARTUP_TIMEOUT_MS ?? 20_000);
  const takeoverInput = { home, dataRoot, applications };
  let startupOwner;
  try {
    await startTakeoverLauncher(
      { home, dataRoot, officialApp, localApp: currentApp },
      switched.takeoverToken,
    );
    startupOwner = await waitForStartup({
      home,
      dataRoot,
      version: candidateVersion,
      switchToken: switched.takeoverToken,
      timeoutMs:
        Number.isSafeInteger(configuredTimeout) && configuredTimeout > 0
          ? configuredTimeout
          : 20_000,
    });
  } catch (error) {
    await abortUnstartedSwitch(
      localLaunch,
      takeoverInput,
      switched.takeoverToken,
      { currentApp, staging, rollbackPath },
      replacement,
    ).catch(() => {});
    throw error;
  }
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
  const completed = await localLaunch.completeSwitch(
    { ...takeoverInput, expectedVersion: candidateVersion },
    switched.takeoverToken,
  );
  if (completed.kind !== "completed") fail(`install-complete-${completed.reason}`);
  return {
    status: "installed",
    switchId,
    backupId,
    version: candidateVersion,
    appPid: startupOwner.childPid,
  };
}
