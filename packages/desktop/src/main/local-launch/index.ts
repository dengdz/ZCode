import { spawn, execFile } from "node:child_process";
import { lstat, mkdir, realpath, readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { atomicWritePrivateTextFile, withFileLock } from "@zcode/shared/node";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import type {
  LocalLaunchContract,
  LocalLaunchEdition,
  LocalMaintenanceInput,
  LocalSwitchCompletionInput,
  LocalSwitchInput,
} from "./contract.js";
import {
  claimLocalMaintenanceSwitch,
  validateLocalMaintenanceSwitch,
  clearLocalMaintenanceFiles,
  readLocalMaintenanceResponse,
  readLocalMaintenanceRuntime,
  releaseLocalMaintenanceSwitch,
  writeLocalMaintenanceCommit,
  writeLocalMaintenanceRequest,
} from "./maintenance.js";
import { desktopProductIdentities } from "../../../scripts/desktop-product-identity.mjs";
export type {
  LocalLaunchInput,
  LocalLaunchResult,
  LocalSwitchCompletionInput,
  LocalSwitchInput,
  LocalSwitchResult,
} from "./contract.js";
export {
  LOCAL_MAINTENANCE_PROTOCOL,
  installLocalMaintenanceRuntime,
  writeLocalMaintenanceRuntime,
} from "./maintenance.js";

const execute = promisify(execFile);
const identities = {
  official: desktopProductIdentities.production,
  local: desktopProductIdentities.local,
};

async function resolveApplication(path: string, edition: LocalLaunchEdition) {
  const root = await realpath(path);
  const info = join(root, "Contents", "Info.plist");
  const read = async (key: string) =>
    (await execute("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, info])).stdout.trim();
  if ((await read("CFBundleIdentifier")) !== identities[edition].appId)
    throw new Error("Application identity does not match selected edition");
  const executable = await read("CFBundleExecutable");
  if (
    !executable ||
    executable === "." ||
    executable === ".." ||
    basename(executable) !== executable
  )
    throw new Error("Invalid application executable");
  return join(root, "Contents", "MacOS", executable);
}

async function runningApplication(
  applications: Readonly<Record<LocalLaunchEdition, string>>,
): Promise<LocalLaunchEdition | null> {
  const roots = await Promise.all(
    (["official", "local"] as const).map(async (edition) => ({
      edition,
      root: await realpath(applications[edition]).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          return resolve(applications[edition]);
        throw error;
      }),
    })),
  );
  // 原始官网程序不会写 Local 占用记录；首次经受控入口启动前仍须观察它是否已运行。
  const { stdout } = await execute("/bin/ps", ["-ww", "-axo", "pid=,comm="], {
    timeout: 3000,
    maxBuffer: 2 * 1024 * 1024,
  });
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (!match || !match[2]!.includes(".app/Contents/")) continue;
    const path = await realpath(match[2]!).catch(() => match[2]!);
    const owner = roots.find(({ root }) => path.startsWith(root + "/Contents/"));
    if (owner) return owner.edition;
  }
  return null;
}

interface Owner {
  version: 1;
  token: string;
  edition: LocalLaunchEdition;
  launcherPid: number;
  childPid?: number;
  phase: "preparing" | "running" | "switching" | "unconfirmed";
}

function isProcessAlive(pid: number | undefined): boolean {
  if (pid === undefined) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function readOwner(file: string): Promise<Owner | null> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const value = JSON.parse(raw) as Owner;
  const keys = ["version", "token", "edition", "launcherPid", "childPid", "phase"];
  if (
    !value ||
    value.version !== 1 ||
    typeof value.token !== "string" ||
    !value.token ||
    !["official", "local"].includes(value.edition) ||
    !["preparing", "running", "switching", "unconfirmed"].includes(value.phase) ||
    !Number.isSafeInteger(value.launcherPid) ||
    value.launcherPid <= 0 ||
    (value.childPid !== undefined &&
      (!Number.isSafeInteger(value.childPid) || value.childPid <= 0)) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new Error("Unconfirmed owner record");
  return value;
}

async function processGroupEnded(pid: number): Promise<boolean> {
  // 主进程退出不代表 Host 等写进程已结束；期限只决定是否报告未知，不用超时自动放行。
  const deadline = Date.now() + 3000;
  do {
    try {
      process.kill(-pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  return false;
}

async function canonicalPath(path: string): Promise<string> {
  return realpath(path).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return resolve(path);
    throw error;
  });
}

async function selectedDataRoot(home: string, requested: string | undefined) {
  let settings: { dataBaseDir?: unknown } = {};
  try {
    settings = JSON.parse(await readFile(join(home, ".zcode/v2/setting.json"), "utf8"));
    if (!settings || typeof settings !== "object" || Array.isArray(settings))
      throw new Error("Unconfirmed bootstrap settings");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  // 官网 bootstrap 的 setDataBaseDir 优先于环境变量；未显式选择的重定向不能加载到候选。
  const saved = settings.dataBaseDir;
  if (saved !== undefined && (typeof saved !== "string" || !saved.trim()))
    throw new Error("Unconfirmed saved data root");
  const actual = await canonicalPath(
    resolve(home, typeof saved === "string" ? saved.trim() : home),
  );
  return actual === (await canonicalPath(resolve(home, requested ?? home))) ? actual : null;
}

async function withOwnerLocks<T>(
  files: readonly string[],
  operation: () => Promise<T>,
): Promise<T> {
  const next = (index: number): Promise<T> =>
    index === files.length ? operation() : withFileLock(files[index]!, () => next(index + 1));
  return next(0);
}

async function maintenanceRoots(input: LocalMaintenanceInput, recoveringSwitch = false) {
  await mkdir(input.home, { recursive: true });
  const home = await realpath(input.home);
  // 数据恢复可暂时移走 setting.json；撤销必须以原 token 的双根 owner 核对，不能先依赖该文件。
  const dataRoot = recoveringSwitch
    ? await canonicalPath(resolve(home, input.dataRoot ?? home))
    : await selectedDataRoot(home, input.dataRoot);
  if (dataRoot === null) return null;
  const directories = await Promise.all(
    [home, dataRoot].map(async (root) => {
      const directory = join(root, ".zcode/local");
      await mkdir(directory, { recursive: true, mode: 0o700 });
      return realpath(directory);
    }),
  );
  const files = [
    ...new Set(directories.map((directory) => join(directory, "launch-owner.json"))),
  ].sort();
  return { home, dataRoot, files };
}

async function admission(
  files: readonly string[],
  applications: LocalMaintenanceInput["applications"],
  dataRoot: string,
) {
  try {
    await lstat(join(dataRoot, ".zcode/local/maintenance/switch-gate"));
    return { kind: "blocked", reason: "unconfirmed" } as const;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return { kind: "blocked", reason: "unconfirmed" } as const;
    }
  }
  try {
    await readFile(join(dataRoot, ".zcode/local/maintenance/switch-request.json"));
    return { kind: "blocked", reason: "unconfirmed" } as const;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return { kind: "blocked", reason: "unconfirmed" } as const;
    }
  }
  for (const file of files) {
    let current: Owner | null;
    try {
      current = await readOwner(file);
    } catch {
      return { kind: "blocked", reason: "unconfirmed" } as const;
    }
    if (current)
      return {
        kind: "blocked",
        reason:
          current.phase === "unconfirmed" ||
          (!isProcessAlive(current.launcherPid) && !isProcessAlive(current.childPid))
            ? "unconfirmed"
            : "occupied",
        edition: current.edition,
      } as const;
  }
  let unmanaged: LocalLaunchEdition | null;
  try {
    unmanaged = await runningApplication(applications);
  } catch {
    return { kind: "blocked", reason: "unconfirmed" } as const;
  }
  if (unmanaged) return { kind: "blocked", reason: "occupied", edition: unmanaged } as const;
  return null;
}

async function consistentOwner(files: readonly string[]): Promise<Owner | null> {
  const owners = await Promise.all(files.map((file) => readOwner(file)));
  const present = owners.filter((owner): owner is Owner => owner !== null);
  if (present.length === 0) return null;
  if (present.length !== owners.length) throw new Error("Partial launch ownership");
  const first = present[0]!;
  if (
    present.some(
      (owner) =>
        owner.token !== first.token ||
        owner.phase !== first.phase ||
        owner.edition !== first.edition ||
        owner.launcherPid !== first.launcherPid ||
        owner.childPid !== first.childPid,
    )
  )
    throw new Error("Launch ownership mismatch");
  return first;
}

async function writeOwnerFiles(files: readonly string[], owner: Owner): Promise<void> {
  for (const file of files) await atomicWritePrivateTextFile(file, JSON.stringify(owner));
}

async function removeOwnerFiles(files: readonly string[]): Promise<void> {
  for (const file of files) await rm(file, { force: true });
}

async function waitForCleanExit(
  files: readonly string[],
  applications: LocalMaintenanceInput["applications"],
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + Math.max(timeoutMs, 0);
  do {
    const owner = await consistentOwner(files).catch(() => undefined);
    let running: LocalLaunchEdition | null;
    try {
      running = await runningApplication(applications);
    } catch {
      return false;
    }
    if (owner === null && running === null) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  return false;
}

type RequestApplicationExitResult = (
  | { kind: "idle" }
  | { kind: "busy"; runningTaskCount: number }
  | { kind: "unknown" }
  | { kind: "exit-unconfirmed" }
) & { keepGate: boolean };

async function requestApplicationExit(
  roots: { home: string; dataRoot: string; files: readonly string[] },
  applications: LocalMaintenanceInput["applications"],
  timeoutMs: number,
): Promise<RequestApplicationExitResult> {
  const owner = await consistentOwner(roots.files).catch(() => undefined);
  if (owner === undefined) return { kind: "unknown", keepGate: false };
  if (!owner) {
    try {
      return (await runningApplication(applications)) === null
        ? { kind: "idle", keepGate: true }
        : { kind: "unknown", keepGate: false };
    } catch {
      return { kind: "unknown", keepGate: false };
    }
  }
  if (
    owner.edition !== "local" ||
    owner.phase !== "running" ||
    !owner.childPid ||
    !isProcessAlive(owner.childPid) ||
    !isProcessAlive(owner.launcherPid)
  )
    return { kind: "unknown", keepGate: false };
  const readyDeadline = Date.now() + Math.max(timeoutMs, 0);
  let runtimeReady = false;
  while (Date.now() < readyDeadline) {
    try {
      const runtime = await readLocalMaintenanceRuntime(
        roots.dataRoot,
        owner.token,
        owner.childPid,
      );
      if (runtime?.state === "ready") {
        runtimeReady = true;
        break;
      }
    } catch {
      return { kind: "unknown", keepGate: false };
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!runtimeReady) return { kind: "unknown", keepGate: false };
  const request = await writeLocalMaintenanceRequest({
    dataRoot: roots.dataRoot,
    token: owner.token,
    appPid: owner.childPid,
  });
  try {
    process.kill(owner.childPid, "SIGUSR2");
  } catch {
    await clearLocalMaintenanceFiles(roots.dataRoot);
    return { kind: "unknown", keepGate: false };
  }
  // 第一步只取得 idle/busy/unknown，不触发退出；超时撤销请求不会让 Main 稍后误退出。
  const idleDeadline = Date.now() + Math.max(timeoutMs, 0);
  let idle = false;
  while (Date.now() < idleDeadline) {
    let response;
    try {
      response = await readLocalMaintenanceResponse(roots.dataRoot, request);
    } catch {
      await clearLocalMaintenanceFiles(roots.dataRoot);
      return { kind: "unknown", keepGate: false };
    }
    if (response?.status === "busy") {
      await clearLocalMaintenanceFiles(roots.dataRoot);
      return {
        kind: "busy",
        runningTaskCount: response.runningTaskCount,
        keepGate: false,
      };
    }
    if (response?.status === "unknown") {
      await clearLocalMaintenanceFiles(roots.dataRoot);
      return { kind: "unknown", keepGate: false };
    }
    if (response?.status === "idle") {
      idle = true;
      break;
    }
    if (response?.status === "accepted") {
      await clearLocalMaintenanceFiles(roots.dataRoot);
      return { kind: "unknown", keepGate: false };
    }
    if (!isProcessAlive(owner.childPid)) {
      await clearLocalMaintenanceFiles(roots.dataRoot);
      return { kind: "exit-unconfirmed", keepGate: false };
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!idle) {
    await clearLocalMaintenanceFiles(roots.dataRoot);
    return { kind: "unknown", keepGate: false };
  }

  await writeLocalMaintenanceCommit(roots.dataRoot, request);
  try {
    process.kill(owner.childPid, "SIGUSR2");
  } catch {
    return { kind: "exit-unconfirmed", keepGate: true };
  }
  const exitDeadline = Date.now() + Math.max(timeoutMs, 0);
  while (Date.now() < exitDeadline) {
    let response;
    try {
      response = await readLocalMaintenanceResponse(roots.dataRoot, request);
    } catch {
      return { kind: "exit-unconfirmed", keepGate: true };
    }
    if (response?.status === "busy") {
      await clearLocalMaintenanceFiles(roots.dataRoot);
      return {
        kind: "busy",
        runningTaskCount: response.runningTaskCount,
        keepGate: false,
      };
    }
    if (response?.status === "unknown") {
      await clearLocalMaintenanceFiles(roots.dataRoot);
      return { kind: "unknown", keepGate: false };
    }
    if (response?.status === "accepted") {
      // accepted 之后 Main 已进入正常退出；任何超时或进程异常都必须保守保留请求证据。
      return (await waitForCleanExit(roots.files, applications, Math.max(10_000, timeoutMs)))
        ? { kind: "idle", keepGate: true }
        : { kind: "exit-unconfirmed", keepGate: true };
    }
    if (!isProcessAlive(owner.childPid)) return { kind: "exit-unconfirmed", keepGate: true };
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return { kind: "exit-unconfirmed", keepGate: true };
}

export const localLaunch: LocalLaunchContract = {
  async withMaintenance(input, operation) {
    if (process.platform !== "darwin")
      throw new Error("Controlled Local maintenance currently supports macOS only");
    const roots = await maintenanceRoots(input);
    if (!roots) return { kind: "blocked", reason: "data-root-mismatch" };
    return withOwnerLocks(roots.files, async () => {
      const blocked = await admission(roots.files, input.applications, roots.dataRoot);
      if (blocked) return blocked;
      return { kind: "completed", value: await operation(roots) };
    });
  },
  async switchToCandidate(input, operation) {
    if (process.platform !== "darwin")
      throw new Error("Controlled Local switching currently supports macOS only");
    const roots = await maintenanceRoots(input);
    if (!roots) return { kind: "blocked", reason: "data-root-mismatch" };
    const takeoverToken = randomUUID();
    if (!(await claimLocalMaintenanceSwitch(roots.dataRoot, takeoverToken)))
      return { kind: "blocked", reason: "unknown" };
    const admitted = await withOwnerLocks(roots.files, async () => {
      const owner = await consistentOwner(roots.files).catch(() => undefined);
      if (owner === undefined) return { kind: "blocked", reason: "unknown" } as const;
      if (owner) {
        if (
          owner.edition === "local" &&
          owner.phase === "running" &&
          owner.childPid &&
          isProcessAlive(owner.childPid) &&
          isProcessAlive(owner.launcherPid)
        )
          return null;
        const dead = !isProcessAlive(owner.launcherPid) && !isProcessAlive(owner.childPid);
        return {
          kind: "blocked",
          reason: dead || owner.phase === "unconfirmed" ? "unknown" : "occupied",
          edition: owner.edition,
        } as const;
      }
      let running: LocalLaunchEdition | null;
      try {
        running = await runningApplication(input.applications);
      } catch {
        return { kind: "blocked", reason: "unknown" } as const;
      }
      if (running === "official")
        return { kind: "blocked", reason: "occupied", edition: "official" } as const;
      if (running) return { kind: "blocked", reason: "unknown", edition: running } as const;
      return null;
    });
    if (admitted) {
      await releaseLocalMaintenanceSwitch(roots.dataRoot, takeoverToken);
      return admitted;
    }

    const exited = await requestApplicationExit(
      roots,
      input.applications,
      input.requestTimeoutMs ?? 5_000,
    );
    if (exited.kind === "busy") {
      if (!exited.keepGate) await releaseLocalMaintenanceSwitch(roots.dataRoot, takeoverToken);
      return {
        kind: "blocked",
        reason: "busy",
        runningTaskCount: exited.runningTaskCount,
      };
    }
    if (exited.kind !== "idle") {
      if (!exited.keepGate) await releaseLocalMaintenanceSwitch(roots.dataRoot, takeoverToken);
      return { kind: "blocked", reason: exited.kind };
    }

    return withOwnerLocks(roots.files, async () => {
      const current = await consistentOwner(roots.files).catch(() => undefined);
      if (current !== null) return { kind: "blocked", reason: "unknown" } as const;
      let running: LocalLaunchEdition | null;
      try {
        running = await runningApplication(input.applications);
      } catch {
        return { kind: "blocked", reason: "unknown" } as const;
      }
      if (running) return { kind: "blocked", reason: "occupied", edition: running } as const;
      const switching: Owner = {
        version: 1,
        token: takeoverToken,
        edition: "local",
        launcherPid: process.pid,
        phase: "switching",
      };
      await writeOwnerFiles(roots.files, switching);
      try {
        const value = await operation({ home: roots.home, dataRoot: roots.dataRoot });
        return { kind: "completed", takeoverToken, value } as const;
      } catch (error) {
        return { kind: "failed", takeoverToken, error } as const;
      }
    });
  },
  async completeSwitch(input: LocalSwitchCompletionInput, takeoverToken) {
    if (process.platform !== "darwin")
      throw new Error("Controlled Local switching currently supports macOS only");
    const roots = await maintenanceRoots(input);
    if (!roots) return { kind: "blocked", reason: "data-root-mismatch" };
    return withOwnerLocks(roots.files, async () => {
      const owner = await consistentOwner(roots.files).catch(() => undefined);
      if (
        !owner ||
        owner.edition !== "local" ||
        owner.phase !== "running" ||
        !owner.childPid ||
        !isProcessAlive(owner.launcherPid) ||
        !isProcessAlive(owner.childPid)
      )
        return { kind: "blocked", reason: "unconfirmed" } as const;
      let runtime: Awaited<ReturnType<typeof readLocalMaintenanceRuntime>>;
      try {
        runtime = await readLocalMaintenanceRuntime(roots.dataRoot, owner.token, owner.childPid);
      } catch {
        return { kind: "blocked", reason: "unconfirmed" } as const;
      }
      if (
        runtime?.state !== "ready" ||
        (input.expectedVersion !== undefined && runtime.version !== input.expectedVersion)
      )
        return { kind: "blocked", reason: "unconfirmed" } as const;
      await clearLocalMaintenanceFiles(roots.dataRoot);
      await releaseLocalMaintenanceSwitch(roots.dataRoot, takeoverToken);
      return { kind: "completed", value: undefined } as const;
    });
  },
  async abortSwitch(input, takeoverToken, operation) {
    if (process.platform !== "darwin")
      throw new Error("Controlled Local switching currently supports macOS only");
    const roots = await maintenanceRoots(input, true);
    if (!roots) return { kind: "blocked", reason: "data-root-mismatch" };
    return withOwnerLocks(roots.files, async () => {
      const owner = await consistentOwner(roots.files).catch(() => undefined);
      if (
        !owner ||
        owner.phase !== "switching" ||
        owner.token !== takeoverToken ||
        owner.childPid !== undefined
      )
        return { kind: "blocked", reason: "unconfirmed" } as const;
      try {
        await validateLocalMaintenanceSwitch(roots.dataRoot, takeoverToken);
      } catch {
        return { kind: "blocked", reason: "unconfirmed" } as const;
      }
      let running: LocalLaunchEdition | null;
      try {
        running = await runningApplication(input.applications);
      } catch {
        return { kind: "blocked", reason: "unconfirmed" } as const;
      }
      if (running) return { kind: "blocked", reason: "occupied", edition: running } as const;

      const value = await operation({ home: roots.home, dataRoot: roots.dataRoot });
      const current = await consistentOwner(roots.files);
      if (
        current?.phase !== "switching" ||
        current.token !== takeoverToken ||
        current.childPid !== undefined
      )
        throw new Error("Switching ownership changed during abort");
      await clearLocalMaintenanceFiles(roots.dataRoot);
      await releaseLocalMaintenanceSwitch(roots.dataRoot, takeoverToken);
      await removeOwnerFiles(roots.files);
      return { kind: "completed", value } as const;
    });
  },
  async run(input, options) {
    if (process.platform !== "darwin")
      throw new Error("Controlled Local launch currently supports macOS only");
    const executable = await resolveApplication(input.applications[input.edition], input.edition);
    const roots = await maintenanceRoots(input);
    if (!roots) return { kind: "blocked", reason: "data-root-mismatch" };
    const { home, dataRoot, files } = roots;
    const owner: Owner = {
      version: 1,
      token: randomUUID(),
      edition: input.edition,
      launcherPid: process.pid,
      phase: "preparing",
    };
    const admitted = await withOwnerLocks(files, async () => {
      if (options?.takeoverToken) {
        const current = await consistentOwner(files).catch(() => undefined);
        if (
          current === undefined ||
          current?.phase !== "switching" ||
          current.token !== options.takeoverToken
        )
          return { kind: "blocked", reason: "unconfirmed" } as const;
        let running: LocalLaunchEdition | null;
        try {
          running = await runningApplication(input.applications);
        } catch {
          return { kind: "blocked", reason: "unconfirmed" } as const;
        }
        if (running) return { kind: "blocked", reason: "occupied", edition: running } as const;
        await writeOwnerFiles(files, owner);
        return null;
      }
      const blocked = await admission(files, input.applications, dataRoot);
      if (blocked) return blocked;
      // native singleton 在无响应时可能强杀持有者；占用必须先持久化，之后才允许子进程访问业务数据。
      await writeOwnerFiles(files, owner);
      return null;
    });
    if (admitted) return admitted;
    const transition = async (phase: Owner["phase"] | null) =>
      withOwnerLocks(files, async () => {
        for (const file of files) {
          const current = await readOwner(file);
          if (current?.token !== owner.token)
            throw new Error("Launch ownership changed unexpectedly");
        }
        for (const file of files) {
          if (phase === null) await rm(file);
          else await atomicWritePrivateTextFile(file, JSON.stringify({ ...owner, phase }));
        }
      });
    try {
      const profile = join(home, ".zcode", "local", "profiles", input.edition);
      await mkdir(join(profile, "session"), { recursive: true, mode: 0o700 });
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        HOME: home,
        ZCODE_DATA_BASE_DIR: dataRoot,
        ZCODE_DESKTOP_HOME_DIR: home,
        ZCODE_DESKTOP_USER_DATA_DIR: profile,
        ZCODE_DESKTOP_SESSION_DATA_DIR: join(profile, "session"),
        ZCODE_LOCAL_LAUNCH_TOKEN: owner.token,
      };
      delete env.ZCODE_DESKTOP_APPLICATION_NAME;
      delete env.ZCODE_DESKTOP_USE_ELECTRON_DEFAULT_USER_DATA;
      const child = spawn(executable, [...(input.applicationArguments ?? [])], {
        env,
        cwd: home,
        detached: true,
        stdio: "inherit",
      });
      const outcome = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
        error?: Error;
      }>((resolve) => {
        child.once("error", (error) => resolve({ code: null, signal: null, error }));
        child.once("exit", (code, signal) => resolve({ code, signal }));
      });
      owner.childPid = child.pid;
      await transition("running");
      const { code, signal, error } = await outcome;
      if (error) throw error;
      const clean =
        code === 0 &&
        signal === null &&
        child.pid !== undefined &&
        (await processGroupEnded(child.pid)) &&
        (await runningApplication(input.applications)) === null;
      await transition(clean ? null : "unconfirmed");
      if (code === 0 && !clean) return { kind: "unconfirmed", edition: input.edition };
      return { kind: "exited", code, signal };
    } catch (error) {
      await transition("unconfirmed");
      throw error;
    }
  },
};
