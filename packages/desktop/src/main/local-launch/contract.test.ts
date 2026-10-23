import { mkdtemp, stat, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { LocalLaunchContract } from "./contract.js";
import { localLaunch } from "./index.js";
import {
  installLocalMaintenanceRuntime,
  readLocalMaintenanceResponse,
  writeLocalMaintenanceCommit,
  writeLocalMaintenanceRequest,
} from "./maintenance.js";

const port: LocalLaunchContract = localLaunch;
async function waitFor<T>(
  read: () => Promise<T | null>,
  predicate: (value: T) => boolean = () => true,
  timeoutMs = 2_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== null && predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for Local maintenance state");
}

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
    const failed = await port.switchToCandidate({ home, applications }, async () => {
      throw new Error("replacement failed");
    });
    if (failed.kind !== "failed") throw new Error("expected failed switch");
    const switching = JSON.parse(await readFile(owner, "utf8"));
    expect(switching.phase).toBe("switching");

    let restored = 0;
    await expect(
      port.abortSwitch({ home, applications }, "other-token", async () => {
        restored += 1;
      }),
    ).resolves.toEqual({ kind: "blocked", reason: "unconfirmed" });
    expect(restored).toBe(0);
    expect(JSON.parse(await readFile(owner, "utf8"))).toEqual(switching);

    await expect(
      port.abortSwitch({ home, applications }, failed.takeoverToken, async () => {
        restored += 1;
      }),
    ).resolves.toEqual({ kind: "completed", value: undefined });
    expect(restored).toBe(1);
    await expect(stat(owner)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.skipIf(process.platform !== "darwin")(
  "切换回调失败保留 owner，恢复失败时 abort 也不解除切换边界",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "local-switch-failure-"));
    const applications = {
      local: join(home, "local.app"),
      official: join(home, "official.app"),
    };
    const ownerPath = join(home, ".zcode/local/launch-owner.json");
    const restorePath = join(home, "restore-evidence");

    const switched = await port.switchToCandidate({ home, applications }, async () => {
      await writeFile(restorePath, "pending restore");
      throw new Error("replacement failed");
    });
    expect(switched.kind).toBe("failed");
    if (switched.kind !== "failed") throw new Error("expected failed switch");
    expect((switched.error as Error).message).toBe("replacement failed");

    const switching = JSON.parse(await readFile(ownerPath, "utf8"));
    expect(switching.phase).toBe("switching");
    expect(await readFile(restorePath, "utf8")).toBe("pending restore");

    await expect(
      port.abortSwitch({ home, applications }, switched.takeoverToken, async () => {
        throw new Error("restore failed");
      }),
    ).rejects.toThrow("restore failed");
    expect(JSON.parse(await readFile(ownerPath, "utf8"))).toEqual(switching);
  },
);

it.skipIf(process.platform !== "darwin")("并发切换只允许一个入口进入替换回调", async () => {
  const home = await mkdtemp(join(tmpdir(), "local-switch-gate-"));
  const applications = {
    local: join(home, "local.app"),
    official: join(home, "official.app"),
  };
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = port.switchToCandidate({ home, applications }, async () => {
    enter();
    await held;
    throw new Error("stop after gate check");
  });
  await entered;

  await expect(
    port.switchToCandidate({ home, applications }, async () => {
      throw new Error("second callback must not run");
    }),
  ).resolves.toEqual({ kind: "blocked", reason: "unknown" });

  release();
  const failed = await first;
  if (failed.kind !== "failed") throw new Error("expected failed switch");
  await expect(
    port.abortSwitch({ home, applications }, failed.takeoverToken, async () => {}),
  ).resolves.toEqual({ kind: "completed", value: undefined });
});

it.skipIf(process.platform !== "darwin")(
  "Main responds busy before commit and accepted only after a second gate check",
  async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "local-maintenance-runtime-"));
    const token = "launch-token";
    let taskState: { kind: "ready"; runningTaskCount: number } | { kind: "unknown" } = {
      kind: "ready",
      runningTaskCount: 1,
    };
    let accepted = 0;
    const runtime = installLocalMaintenanceRuntime({
      dataRoot,
      token,
      version: "3.16.2-local.2",
      getTaskState: () => taskState,
      onAccepted: () => {
        accepted += 1;
      },
    });

    try {
      await runtime.markHostReady();
      const busyRequest = await writeLocalMaintenanceRequest({
        dataRoot,
        token,
        appPid: process.pid,
      });
      process.emit("SIGUSR2");
      const busy = await waitFor(async () => readLocalMaintenanceResponse(dataRoot, busyRequest));
      expect(busy).toMatchObject({ status: "busy", runningTaskCount: 1 });
      expect(accepted).toBe(0);

      taskState = { kind: "ready", runningTaskCount: 0 };
      const idleRequest = await writeLocalMaintenanceRequest({
        dataRoot,
        token,
        appPid: process.pid,
      });
      process.emit("SIGUSR2");
      const idle = await waitFor(async () => readLocalMaintenanceResponse(dataRoot, idleRequest));
      expect(idle).toMatchObject({ status: "idle", runningTaskCount: 0 });
      expect(accepted).toBe(0);

      await writeLocalMaintenanceCommit(dataRoot, idleRequest);
      process.emit("SIGUSR2");
      const finish = await waitFor(
        async () => readLocalMaintenanceResponse(dataRoot, idleRequest),
        (response) => response.status === "accepted",
      );
      expect(finish).toMatchObject({ status: "accepted", runningTaskCount: 0 });
      await waitFor(async () => (accepted === 1 ? accepted : null));
      expect(accepted).toBe(1);

      const runtimeState = JSON.parse(
        await readFile(join(dataRoot, ".zcode/local/maintenance/runtime.json"), "utf8"),
      );
      expect(runtimeState).toMatchObject({
        token,
        appPid: process.pid,
        version: "3.16.2-local.2",
        state: "ready",
      });
    } finally {
      runtime.dispose();
      await rm(dataRoot, { recursive: true, force: true });
    }
  },
);

it.skipIf(process.platform !== "darwin")(
  "unconfirmed task state never grants maintenance exit",
  async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "local-maintenance-unknown-"));
    const token = "launch-token-unknown";
    let accepted = 0;
    const runtime = installLocalMaintenanceRuntime({
      dataRoot,
      token,
      version: "3.16.2-local.2",
      getTaskState: () => ({ kind: "unknown" }),
      onAccepted: () => {
        accepted += 1;
      },
    });

    try {
      await runtime.markHostReady();
      const request = await writeLocalMaintenanceRequest({
        dataRoot,
        token,
        appPid: process.pid,
      });
      process.emit("SIGUSR2");
      const response = await waitFor(async () => readLocalMaintenanceResponse(dataRoot, request));
      expect(response).toMatchObject({ status: "unknown", runningTaskCount: null });
      expect(accepted).toBe(0);
    } finally {
      runtime.dispose();
      await rm(dataRoot, { recursive: true, force: true });
    }
  },
);
