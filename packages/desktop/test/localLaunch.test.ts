import { execFile, spawn, type ChildProcess } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { botsConfigFileSchema } from "@zcode/shared";

const execute = promisify(execFile);
const repo = resolve(import.meta.dirname, "../../..");
const roots: string[] = [];
const children: ChildProcess[] = [];

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "zcode-local-launch-")));
  roots.push(root);
  const home = join(root, "home");
  await mkdir(home);
  for (const edition of ["official", "local"]) {
    const app = join(root, `${edition}.app`, "Contents");
    await mkdir(join(app, "MacOS"), { recursive: true });
    const id = edition === "official" ? "dev.zcode.app" : "dev.zcode.app.local";
    await writeFile(
      join(app, "Info.plist"),
      `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${id}</string><key>CFBundleExecutable</key><string>fixture</string></dict></plist>`,
    );
    const binary = join(app, "MacOS", "fixture");
    await writeFile(
      binary,
      `#!/usr/bin/env node\nconst fs=require('node:fs'),path=require('node:path');const home=process.env.HOME;fs.writeFileSync(path.join(home,'observed-${edition}.json'),JSON.stringify({pid:process.pid,home,data:process.env.ZCODE_DATA_BASE_DIR,desktopHome:process.env.ZCODE_DESKTOP_HOME_DIR,profile:process.env.ZCODE_DESKTOP_USER_DATA_DIR,args:process.argv.slice(2)}));if(process.argv.includes('--leave-helper')){const child=require('node:child_process').spawn(process.execPath,['-e',"const fs=require('node:fs');setInterval(()=>{if(fs.existsSync("+JSON.stringify(path.join(home,'release-${edition}'))+"))process.exit(0)},25)"],{stdio:'ignore'});child.unref();}if(process.argv.includes('--hold'))setInterval(()=>{if(fs.existsSync(path.join(home,'release-${edition}')))process.exit(0)},25);\n`,
    );
    await chmod(binary, 0o700);
  }
  const launch = (
    edition: string,
    appArgs: string[] = [],
    requestedHome = home,
    dataRoot?: string,
    takeoverToken?: string,
  ) => {
    const child = spawn(
      process.execPath,
      [
        join(repo, "node_modules/tsx/dist/cli.mjs"),
        join(repo, "scripts/local-launch.ts"),
        "--edition",
        edition,
        "--home",
        requestedHome,
        "--official-app",
        join(root, "official.app"),
        "--local-app",
        join(root, "local.app"),
        ...(takeoverToken ? ["--takeover-token", takeoverToken] : []),
        ...(dataRoot ? ["--data-root", dataRoot] : []),
        "--",
        ...appArgs,
      ],
      { cwd: repo, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
    );
    children.push(child);
    let output = "";
    child.stdout?.on("data", (b) => (output += b));
    child.stderr?.on("data", (b) => (output += b));
    const done = new Promise<{ code: number | null; output: string }>((r) =>
      child.once("exit", (code) => r({ code, output })),
    );
    return { child, done };
  };
  return { root, home, launch };
}

async function observed(home: string, edition: string) {
  const start = Date.now();
  while (Date.now() - start < 8000) {
    try {
      return JSON.parse(await readFile(join(home, `observed-${edition}.json`), "utf8"));
    } catch {}
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("application did not start");
}

async function prepareNativeHolder(root: string) {
  const source = join(root, "native-holder.c");
  const app = join(root, "official.app");
  const binary = join(app, "Contents/MacOS/fixture");
  // 系统二进制的原签名不适用于临时应用包；使用自有程序，并为完整 bundle 签名。
  await writeFile(
    source,
    String.raw`
#include <signal.h>
#include <stdio.h>
#include <unistd.h>
static volatile sig_atomic_t stopping = 0;
static void stop(int signal_number) { (void)signal_number; stopping = 1; }
int main(int argc, char **argv) {
  if (argc != 3) return 64;
  signal(SIGTERM, stop);
  signal(SIGINT, stop);
  FILE *ready = fopen(argv[1], "w");
  if (!ready) return 73;
  fprintf(ready, "{\"pid\":%d}\n", getpid());
  if (fclose(ready) != 0) return 74;
  unsigned polls = 0;
  const unsigned max_polls = 1200;
  while (!stopping && access(argv[2], F_OK) != 0) {
    if (++polls > max_polls) return 75;
    usleep(25000);
  }
  return 0;
}
`,
  );
  await execute("/usr/bin/xcrun", ["clang", "-Wall", "-Wextra", "-Werror", source, "-o", binary]);
  await execute("/usr/bin/codesign", ["--force", "--sign", "-", "--timestamp=none", app]);
  return { app, binary };
}

afterEach(async () => {
  for (const root of roots)
    for (const name of ["home", "second-home"])
      for (const edition of ["official", "local"])
        await writeFile(join(root, name, `release-${edition}`), "exit").catch(() => {});
  await new Promise((r) => setTimeout(r, 100));
  for (const child of children)
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  roots.length = 0;
  children.length = 0;
});

it.skipIf(process.platform !== "darwin")(
  "受控入口以同一业务home和独立profile启动两版，正常退出后可切换",
  async () => {
    const { home, launch } = await fixture();
    const first = await launch("official").done;
    expect(first, first.output).toMatchObject({ code: 0 });
    const official = await observed(home, "official");
    const second = await launch("local", ["--example-argument"]).done;
    expect(second, second.output).toMatchObject({ code: 0 });
    const local = await observed(home, "local");
    expect([official.data, local.data, official.desktopHome, local.desktopHome]).toEqual([
      home,
      home,
      home,
      home,
    ]);
    expect(local.profile).not.toBe(official.profile);
    expect(local.args).toEqual(["--example-argument"]);
  },
);

it.skipIf(process.platform !== "darwin").each(["official", "local"])(
  "%s 已占用时另一版保持未启动，退出后再允许切换",
  async (edition) => {
    const { home, launch } = await fixture();
    const other = edition === "official" ? "local" : "official";
    const first = launch(edition, ["--hold"]);
    await observed(home, edition);
    const second = await launch(other).done;
    expect(second, second.output).toMatchObject({ code: 2 });
    await expect(readFile(join(home, `observed-${other}.json`))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await writeFile(join(home, `release-${edition}`), "exit");
    expect((await first.done).code).toBe(0);
    expect((await launch(other).done).code).toBe(0);
  },
);

it.skipIf(process.platform !== "darwin")(
  "主进程正常退出但同组子进程仍存活时不释放业务占用",
  async () => {
    const { home, launch } = await fixture();
    const first = await launch("local", ["--leave-helper"]).done;
    expect(first, first.output).toMatchObject({ code: 3 });
    const second = await launch("official").done;
    expect(second, second.output).toMatchObject({ code: 2 });
    await expect(readFile(join(home, "observed-official.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it.skipIf(process.platform !== "darwin")(
  "启动入口崩溃后保留占用，原应用退出也不能把未知结果当成完成",
  async () => {
    const { home, launch } = await fixture();
    const first = launch("local", ["--hold"]);
    const app = await observed(home, "local");
    const owner = JSON.parse(await readFile(join(home, ".zcode/local/launch-owner.json"), "utf8"));
    process.kill(owner.launcherPid, "SIGKILL");
    await first.done;
    expect((await launch("official").done).code).toBe(2);
    await writeFile(join(home, "release-local"), "exit");
    for (let i = 0; i < 100; i++) {
      try {
        process.kill(app.pid, 0);
      } catch {
        break;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    const next = await launch("official").done;
    expect(next.code).toBe(2);
    expect(next.output).toContain('"reason":"unconfirmed"');
  },
);

it.skipIf(process.platform !== "darwin")("首次使用入口也会拒绝已经直接运行的原始应用", async () => {
  const { root, home, launch } = await fixture();
  const { app, binary } = await prepareNativeHolder(root);
  // 原夹具签名异常曾弹出系统损坏/崩溃提示；签名不完整时必须在实际启动前失败。
  await execute("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
  const release = join(home, "release-official");
  const raw = spawn(binary, [join(home, "observed-official.json"), release], {
    stdio: "ignore",
    detached: true,
  });
  children.push(raw);
  const exited = new Promise((resolve) => {
    raw.once("error", (error) => resolve({ error }));
    raw.once("exit", (code, signal) => resolve({ code, signal }));
  });
  try {
    const running = await observed(home, "official");
    expect(running.pid).toBe(raw.pid);
    const result = await launch("local").done;
    expect(result, result.output).toMatchObject({ code: 2 });
    expect(result.output).toContain('"reason":"occupied"');
    expect(() => process.kill(running.pid, 0)).not.toThrow();
    expect(raw.exitCode).toBeNull();
    await expect(readFile(join(home, "observed-local.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    await writeFile(release, "exit");
    expect(await exited).toEqual({ code: 0, signal: null });
  }
});

it.skipIf(process.platform !== "darwin").each(["official", "local"])(
  "%s 无响应时另一版快速拒绝且不强杀持有者",
  async (edition) => {
    const { home, launch } = await fixture();
    const first = launch(edition, ["--hold"]);
    const app = await observed(home, edition);
    process.kill(app.pid, "SIGSTOP");
    try {
      const second = await launch(edition === "official" ? "local" : "official").done;
      expect(second.code).toBe(2);
      expect(() => process.kill(app.pid, 0)).not.toThrow();
      expect(first.child.exitCode).toBeNull();
    } finally {
      process.kill(app.pid, "SIGCONT");
      await writeFile(join(home, `release-${edition}`), "exit");
      await first.done;
    }
  },
);

it.skipIf(process.platform !== "darwin")("同一目录的别名也不能绕过占用", async () => {
  const { root, home, launch } = await fixture();
  const alias = join(root, "home-alias");
  await symlink(home, alias);
  const first = launch("local", ["--hold"]);
  await observed(home, "local");
  expect((await launch("official", [], alias).done).code).toBe(2);
  await writeFile(join(home, "release-local"), "exit");
  await first.done;
});

it.skipIf(process.platform !== "darwin").each(["{invalid", '{"version":999}'])(
  "占用记录不可识别时拒绝启动且不改写记录：%s",
  async (raw) => {
    const { home, launch } = await fixture();
    const dir = join(home, ".zcode/local");
    await mkdir(dir, { recursive: true });
    const file = join(dir, "launch-owner.json");
    await writeFile(file, raw);
    const result = await launch("local").done;
    expect(result.code).toBe(2);
    expect(result.output).toContain('"reason":"unconfirmed"');
    expect(await readFile(file, "utf8")).toBe(raw);
    await expect(readFile(join(home, "observed-local.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it.skipIf(process.platform !== "darwin")(
  "Local 扩展目录及两版启动不改写官网业务文件，严格 Reader 仍可读取",
  async () => {
    const { home, launch } = await fixture();
    const data = join(home, ".zcode/v2");
    await mkdir(data, { recursive: true });
    const config = {
      version: 3,
      bots: [
        {
          id: "synthetic-bot",
          name: "Synthetic",
          provider: "webhook",
          enabled: false,
          allowedWorkspaces: ["/synthetic/project"],
          allowedCommands: {
            status: true,
            new: true,
            workspace: true,
            model: true,
            thoughtLevel: true,
            reply: true,
          },
          currentOptions: {},
          replyMode: "assistant_changes",
        },
      ],
    };
    const content = JSON.stringify(config);
    const file = join(data, "bot-config.v3.json");
    await writeFile(file, content);
    const state = join(data, "bot-state.v3.json");
    const stateContent = JSON.stringify({ version: 3, bots: {} });
    await writeFile(state, stateContent);
    const extension = join(home, ".zcode/local/v1");
    await mkdir(extension, { recursive: true });
    await writeFile(
      join(extension, "reader-probe.json"),
      JSON.stringify({ version: 1, purpose: "compatibility-fixture" }),
    );
    for (const edition of ["official", "local"]) {
      expect((await launch(edition).done).code).toBe(0);
      expect(await readFile(file, "utf8")).toBe(content);
      expect(await readFile(state, "utf8")).toBe(stateContent);
      expect(
        botsConfigFileSchema.parse(JSON.parse(await readFile(file, "utf8"))).bots[0]?.name,
      ).toBe("Synthetic");
    }
  },
);

it.skipIf(process.platform !== "darwin")("同时请求两版时只启动一个实际进程", async () => {
  const { home, launch } = await fixture();
  const a = launch("official", ["--hold"]),
    b = launch("local", ["--hold"]);
  const loser = await Promise.race([
    a.done.then((result) => ({ edition: "official", result })),
    b.done.then((result) => ({ edition: "local", result })),
  ]);
  expect(loser.result.code).toBe(2);
  const winner = loser.edition === "official" ? "local" : "official";
  await observed(home, winner);
  await expect(readFile(join(home, `observed-${loser.edition}.json`))).rejects.toMatchObject({
    code: "ENOENT",
  });
  await writeFile(join(home, `release-${winner}`), "exit");
  expect((await (winner === "official" ? a : b).done).code).toBe(0);
});

it.skipIf(process.platform !== "darwin")(
  "未显式选择保存的自定义根时不启动也不创建该根",
  async () => {
    const { root, home, launch } = await fixture();
    const dataRoot = join(root, "custom-data");
    await mkdir(join(home, ".zcode/v2"), { recursive: true });
    await writeFile(
      join(home, ".zcode/v2/setting.json"),
      JSON.stringify({ dataBaseDir: dataRoot }),
    );
    const result = await launch("local").done;
    expect(result, result.output).toMatchObject({ code: 2 });
    expect(result.output).toContain('"reason":"data-root-mismatch"');
    await expect(readFile(join(home, "observed-local.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(realpath(dataRoot)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.skipIf(process.platform !== "darwin")(
  "显式选择自定义根时保留home上下文并规范化业务根别名",
  async () => {
    const { root, home, launch } = await fixture();
    const dataRoot = join(root, "custom-data"),
      alias = join(root, "custom-alias");
    await mkdir(dataRoot);
    await symlink(dataRoot, alias);
    await mkdir(join(home, ".zcode/v2"), { recursive: true });
    await writeFile(join(home, ".zcode/v2/setting.json"), JSON.stringify({ dataBaseDir: alias }));
    const result = await launch("local", [], home, dataRoot).done;
    expect(result, result.output).toMatchObject({ code: 0 });
    expect(await observed(home, "local")).toMatchObject({
      home,
      data: dataRoot,
      desktopHome: home,
    });
    for (const base of [home, dataRoot])
      await expect(readFile(join(base, ".zcode/local/launch-owner.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });
  },
);

it.skipIf(process.platform !== "darwin")("不同home指向同一业务根时并发也只能启动一版", async () => {
  const { root, home, launch } = await fixture();
  const otherHome = join(root, "second-home"),
    dataRoot = join(root, "custom-data");
  for (const candidate of [home, otherHome]) {
    await mkdir(join(candidate, ".zcode/v2"), { recursive: true });
    await writeFile(
      join(candidate, ".zcode/v2/setting.json"),
      JSON.stringify({ dataBaseDir: dataRoot }),
    );
  }
  const a = launch("official", ["--hold"], home, dataRoot);
  const b = launch("local", ["--hold"], otherHome, dataRoot);
  const loser = await Promise.race([
    a.done.then((result) => ({ edition: "official", result })),
    b.done.then((result) => ({ edition: "local", result })),
  ]);
  expect(loser.result, loser.result.output).toMatchObject({ code: 2 });
  expect(loser.result.output).toContain('"reason":"occupied"');
  const winner = loser.edition === "official" ? "local" : "official";
  const winnerHome = winner === "official" ? home : otherHome;
  await observed(winnerHome, winner);
  const owner = JSON.parse(
    await readFile(join(dataRoot, ".zcode/local/launch-owner.json"), "utf8"),
  );
  expect(owner.edition).toBe(winner);
  await writeFile(join(winnerHome, `release-${winner}`), "exit");
  expect((await (winner === "official" ? a : b).done).code).toBe(0);
});

it.skipIf(process.platform !== "darwin")(
  "switching owner只允许匹配的takeover启动并转为running",
  async () => {
    const { home, launch } = await fixture();
    const owner = join(home, ".zcode/local/launch-owner.json");
    await mkdir(join(home, ".zcode/local"), { recursive: true });
    await writeFile(
      owner,
      JSON.stringify({
        version: 1,
        token: "switch-token",
        edition: "local",
        launcherPid: process.pid,
        phase: "switching",
      }),
    );
    const rejected = await launch("local").done;
    expect(rejected.code).toBe(2);
    expect(rejected.output).toContain('"reason":"occupied"');
    await expect(readFile(join(home, "observed-local.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });

    const takeover = launch("local", ["--hold"], home, undefined, "switch-token");
    await observed(home, "local");
    expect(JSON.parse(await readFile(owner, "utf8"))).toMatchObject({
      edition: "local",
      phase: "running",
    });
    await writeFile(join(home, "release-local"), "exit");
    expect((await takeover.done).code).toBe(0);
  },
);
