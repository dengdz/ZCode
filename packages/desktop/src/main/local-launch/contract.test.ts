import { mkdtemp, stat, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { LocalLaunchContract } from "./contract.js";
import { localLaunch } from "./index.js";

const port: LocalLaunchContract = localLaunch;
it.skipIf(process.platform !== "darwin")("无效应用在接触业务数据之前拒绝", async () => {
  const root = await mkdtemp(join(tmpdir(), "local-launch-contract-"));
  const home = join(root, "untouched-home");
  await expect(
    port.run({
      edition: "local",
      home,
      applications: {
        official: join(root, "missing-official.app"),
        local: join(root, "missing-local.app"),
      },
    }),
  ).rejects.toMatchObject({ code: "ENOENT" });
  await expect(stat(home)).rejects.toMatchObject({ code: "ENOENT" });
});

it.skipIf(process.platform !== "darwin")("维护接口不解除异常占用或执行文件操作", async () => {
  const home = await mkdtemp(join(tmpdir(), "local-maintenance-contract-"));
  const owner = join(home, ".zcode/local/launch-owner.json");
  const resultFile = join(home, "must-not-write");
  await mkdir(join(home, ".zcode/local"), { recursive: true });
  await writeFile(owner, "unconfirmed owner");
  const result = await port.withMaintenance(
    {
      home,
      applications: { local: join(home, "local.app"), official: join(home, "official.app") },
    },
    async () => writeFile(resultFile, "unsafe operation"),
  );
  expect(result).toEqual({ kind: "blocked", reason: "unconfirmed" });
  await expect(stat(resultFile)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(owner, "utf8")).toBe("unconfirmed owner");
});

it.skipIf(process.platform !== "darwin")("切换接口不接管损坏的owner或调用替换回调", async () => {
  const home = await mkdtemp(join(tmpdir(), "local-switch-contract-"));
  const owner = join(home, ".zcode/local/launch-owner.json");
  const resultFile = join(home, "must-not-switch");
  await mkdir(join(home, ".zcode/local"), { recursive: true });
  await writeFile(owner, "unconfirmed owner");
  const result = await port.switchToCandidate(
    {
      home,
      applications: { local: join(home, "local.app"), official: join(home, "official.app") },
    },
    async () => writeFile(resultFile, "unsafe switch"),
  );
  expect(result).toEqual({ kind: "blocked", reason: "unknown" });
  await expect(stat(resultFile)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(owner, "utf8")).toBe("unconfirmed owner");
});

it.skipIf(process.platform !== "darwin")(
  "abort切换只处理完全匹配且无进程的switching owner",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "local-abort-switch-"));
    const owner = join(home, ".zcode/local/launch-owner.json");
    const applications = {
      local: join(home, "local.app"),
      official: join(home, "official.app"),
    };
    await mkdir(join(home, ".zcode/local"), { recursive: true });
    const switching = {
      version: 1,
      token: "switch-token",
      edition: "local",
      launcherPid: process.pid,
      phase: "switching",
    };
    await writeFile(owner, JSON.stringify(switching));

    let restored = 0;
    await expect(
      port.abortSwitch({ home, applications }, "other-token", async () => {
        restored += 1;
      }),
    ).resolves.toEqual({ kind: "blocked", reason: "unconfirmed" });
    expect(restored).toBe(0);
    expect(JSON.parse(await readFile(owner, "utf8"))).toEqual(switching);

    await expect(
      port.abortSwitch({ home, applications }, "switch-token", async () => {
        restored += 1;
      }),
    ).resolves.toEqual({ kind: "completed", value: undefined });
    expect(restored).toBe(1);
    await expect(stat(owner)).rejects.toMatchObject({ code: "ENOENT" });
  },
);
