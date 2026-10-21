import { spawn, type ChildProcess } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { botsConfigFileSchema } from "@zcode/shared";

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
  const launch = (edition: string, appArgs: string[] = [], requestedHome = home) => {
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

afterEach(async () => {
  for (const root of roots)
    for (const edition of ["official", "local"])
      await writeFile(join(root, "home", `release-${edition}`), "exit");
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
  const binary = join(root, "official.app/Contents/MacOS/fixture");
  await copyFile("/bin/sleep", binary);
  const raw = spawn(binary, ["30"], { stdio: "ignore", detached: true });
  children.push(raw);
  await new Promise<void>((resolve, reject) => {
    raw.once("spawn", resolve);
    raw.once("error", reject);
  });
  const result = await launch("local").done;
  expect(result, result.output).toMatchObject({ code: 2 });
  await expect(readFile(join(home, "observed-local.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
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
