import { spawn, execFile } from "node:child_process";
import { mkdir, realpath, readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { atomicWritePrivateTextFile, withFileLock } from "@zcode/shared/node";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { LocalLaunchContract, LocalLaunchEdition } from "./contract.js";
import { desktopProductIdentities } from "../../../scripts/desktop-product-identity.mjs";
export type { LocalLaunchInput, LocalLaunchResult } from "./contract.js";

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
  phase: "preparing" | "running" | "unconfirmed";
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
    !["preparing", "running", "unconfirmed"].includes(value.phase) ||
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

export const localLaunch: LocalLaunchContract = {
  async run(input) {
    if (process.platform !== "darwin")
      throw new Error("Controlled Local launch currently supports macOS only");
    const executable = await resolveApplication(input.applications[input.edition], input.edition);
    await mkdir(input.home, { recursive: true });
    const home = await realpath(input.home);
    const dataRoot = await selectedDataRoot(home, input.dataRoot);
    if (dataRoot === null) return { kind: "blocked", reason: "data-root-mismatch" };
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
    const owner: Owner = {
      version: 1,
      token: randomUUID(),
      edition: input.edition,
      launcherPid: process.pid,
      phase: "preparing",
    };
    const admitted = await withOwnerLocks(files, async () => {
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
        unmanaged = await runningApplication(input.applications);
      } catch {
        return { kind: "blocked", reason: "unconfirmed" } as const;
      }
      if (unmanaged) return { kind: "blocked", reason: "occupied", edition: unmanaged } as const;
      // native singleton 在无响应时可能强杀持有者；占用必须先持久化，之后才允许子进程访问业务数据。
      for (const file of files) await atomicWritePrivateTextFile(file, JSON.stringify(owner));
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
