import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { fixture } from "./fixtures.js";

it("停止 ACK、detached 工作和 held 队列都不能冒充 owned work 已结束，已有文件保留", async () => {
  const f = await fixture();
  const session = await f.create();
  const file = join(f.home, "existing-result.txt");
  await writeFile(file, "preserve existing work");
  const scope = { projectId: "fixed", workspaceKey: f.home };
  await f.command(session, "sendText", { text: "First work", projectExecutionScope: scope });
  await expect.poll(() => f.started.length).toBe(1);
  let finishSidecar!: () => void;
  const sidecar = f.apps.get(session)!.runtime.trackResidencyBlockingWork(
    new Promise<void>((resolve) => {
      finishSidecar = resolve;
    }),
  );
  try {
    await f.command(session, "sendText", { text: "Queued work", projectExecutionScope: scope });
    const snapshot = await f.snapshot(session);
    expect(
      await f.command(
        session,
        "setAutoDrain",
        { autoDrain: false },
        { baseRevision: snapshot.revision },
      ),
    ).toMatchObject({ status: "accepted" });
    const executionId = snapshot.control.activeWorks.find(
      (work) => work.foregroundExecutionId,
    )!.foregroundExecutionId!;
    expect(
      await f.command(session, "stop", { expectedForegroundExecutionId: executionId }),
    ).toMatchObject({ status: "accepted" });
    expect(await f.command(session, "inspectOwnedWork", {})).toMatchObject({
      status: "accepted",
      result: { type: "ownedWorkState", state: "busy" },
    });
    f.releases.shift()!();
    await expect
      .poll(() => f.apps.get(session)!.runtime.getActiveForegroundExecutionId())
      .toBeUndefined();
    expect(await f.command(session, "inspectOwnedWork", {})).toMatchObject({
      status: "accepted",
      result: { type: "ownedWorkState", state: "busy" },
    });
    const held = await f.snapshot(session);
    expect(
      await f.command(
        session,
        "deleteQueueItem",
        { queueItemId: held.queue.items[0]!.queueItemId },
        { baseRevision: held.revision },
      ),
    ).toMatchObject({ status: "accepted" });
    expect(await f.command(session, "inspectOwnedWork", {})).toMatchObject({
      status: "accepted",
      result: { type: "ownedWorkState", state: "busy" },
    });
    expect(f.started).toHaveLength(1);
    expect(await readFile(file, "utf8")).toBe("preserve existing work");
  } finally {
    finishSidecar();
    await sidecar;
  }
  await expect
    .poll(async () => await f.command(session, "inspectOwnedWork", {}))
    .toMatchObject({ status: "accepted", result: { type: "ownedWorkState", state: "idle" } });
});

it("冷加载 record 没有 live lease 时，不把旧 Host 的持久执行租约当成已停止", async () => {
  const f = await fixture();
  const session = await f.create();
  await f.command(session, "sendText", {
    text: "Original host work",
    projectExecutionScope: { projectId: "fixed", workspaceKey: f.home },
  });
  await expect.poll(() => f.started.length).toBe(1);
  const cold = f.otherClient();
  await cold.snapshot(session, "web-remote-replayable");
  expect(await cold.command(session, "inspectOwnedWork", {})).toMatchObject({
    status: "accepted",
    result: { type: "ownedWorkState", state: "unknown" },
  });
  f.releases.shift()!();
  await expect
    .poll(async () => cold.command(session, "inspectOwnedWork", {}))
    .toMatchObject({ status: "accepted", result: { type: "ownedWorkState", state: "idle" } });
});

it("同项目两机器人任务实际模型执行不重叠，原队列在前一项结束后续跑", async () => {
  const f = await fixture();
  const pm = await f.create();
  const executor = await f.create();
  const projectExecutionScope = { projectId: "project-fixed", workspaceKey: f.home };
  const first = await f.command(pm, "sendText", {
    text: "First work",
    requestedDelivery: "queue",
    projectExecutionScope,
  });
  expect(first).toMatchObject({ status: "accepted", result: { delivery: "startNow" } });
  await expect.poll(() => f.started.length).toBe(1);
  const second = await f.command(executor, "sendText", {
    text: "Second work",
    requestedDelivery: "queue",
    projectExecutionScope,
  });
  expect(second).toMatchObject({ status: "accepted", result: { delivery: "queue" } });
  expect(f.started).toHaveLength(1);
  f.releases.shift()!();
  await expect.poll(() => f.started.at(-1)).toBe(executor);
  expect(f.maximumActive()).toBe(1);
});

it("原运行时仍有 detached 工作时不释放项目租约", async () => {
  const f = await fixture();
  const pm = await f.create();
  const other = await f.create();
  const projectExecutionScope = { projectId: "project-fixed", workspaceKey: f.home };
  await f.command(pm, "sendText", { text: "Start work", projectExecutionScope });
  await expect.poll(() => f.started.length).toBe(1);
  let finishSidecar!: () => void;
  const sidecar = f.apps.get(pm)!.runtime.trackResidencyBlockingWork(
    new Promise<void>((resolve) => {
      finishSidecar = resolve;
    }),
  );
  try {
    await f.command(other, "sendText", { text: "Wait for all work", projectExecutionScope });
    f.releases.shift()!();
    // 覆盖两次既有 100ms 队列重评，确认 future work 不越过仍在运行的 sidecar。
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(f.started).toHaveLength(1);
  } finally {
    finishSidecar();
    await sidecar;
  }
  await expect.poll(() => f.started.at(-1)).toBe(other);
});

it("两个独立 Host 在同工作区共享执行互斥，项目别名不能绕过", async () => {
  const f = await fixture();
  const otherHost = f.otherClient();
  const first = await f.create();
  const second = await otherHost.create();
  await f.command(first, "sendText", {
    text: "PM work",
    projectExecutionScope: { projectId: "project-a", workspaceKey: f.home },
  });
  await expect.poll(() => f.started.at(-1)).toBe(first);
  expect(
    await otherHost.command(second, "sendText", {
      text: "Other bot work",
      projectExecutionScope: { projectId: "project-alias", workspaceKey: f.home },
    }),
  ).toMatchObject({ status: "accepted", result: { delivery: "queue" } });
  const snapshot = await otherHost.snapshot(second, "web-remote-replayable");
  expect(snapshot.queue.items).toHaveLength(1);
  expect(snapshot.queue.items[0]).toMatchObject({
    text: "Other bot work",
    dispatch: { state: "queued" },
  });
  expect(f.started).toEqual([first]);
  f.releases.shift()!();
  await expect.poll(() => f.started.at(-1)).toBe(second);
  expect(f.maximumActive()).toBe(1);
});

it("不同工作区的 Local 项目互不阻塞", async () => {
  const f = await fixture();
  const otherWorkspace = join(f.home, "other");
  const first = await f.create();
  const second = await f.create(otherWorkspace);
  await f.command(first, "sendText", {
    text: "A",
    projectExecutionScope: { projectId: "same-display", workspaceKey: f.home },
  });
  await expect.poll(() => f.started.length).toBe(1);
  expect(
    await f.command(second, "sendText", {
      text: "B",
      projectExecutionScope: { projectId: "same-display", workspaceKey: otherWorkspace },
    }),
  ).toMatchObject({ result: { delivery: "startNow" } });
  await expect.poll(() => f.started.length).toBe(2);
  expect(f.maximumActive()).toBe(2);
});

it("普通未绑定会话保留原有并发行为", async () => {
  const f = await fixture();
  const first = await f.create();
  const second = await f.create();
  await f.command(first, "sendText", { text: "Ordinary first" });
  await expect.poll(() => f.started.length).toBe(1);
  await f.command(second, "sendText", { text: "Ordinary second" });
  await expect.poll(() => f.started.length).toBe(2);
  expect(f.maximumActive()).toBe(2);
});

it("重复提交同一排队命令不重复续跑", async () => {
  const f = await fixture();
  const first = await f.create();
  const second = await f.create();
  const projectExecutionScope = { projectId: "fixed", workspaceKey: f.home };
  await f.command(first, "sendText", { text: "A", projectExecutionScope });
  await expect.poll(() => f.started.length).toBe(1);
  const payload = { text: "B", projectExecutionScope };
  const key = { commandId: "stable-queued" };
  expect(await f.command(second, "sendText", payload, key)).toMatchObject({
    status: "accepted",
    result: { delivery: "queue" },
  });
  expect(await f.command(second, "sendText", payload, key)).toMatchObject({
    status: "duplicate",
    result: { delivery: "queue" },
  });
  expect((await f.snapshot(second)).queue.items).toHaveLength(1);
  f.releases.shift()!();
  await expect.poll(() => f.started.at(-1)).toBe(second);
  f.releases.shift()!();
  await expect.poll(() => f.apps.get(second)!.runtime.hasResidencyBlockingWork()).toBe(false);
  expect(f.started).toEqual([first, second]);
});

it("取消原队列项后不会执行，其他机器人仍可续跑", async () => {
  const f = await fixture();
  const first = await f.create();
  const cancelled = await f.create();
  const last = await f.create();
  const projectExecutionScope = { projectId: "fixed", workspaceKey: f.home };
  await f.command(first, "sendText", { text: "A", projectExecutionScope });
  await expect.poll(() => f.started.length).toBe(1);
  await f.command(cancelled, "sendText", { text: "Cancel this", projectExecutionScope });
  const snapshot = await f.snapshot(cancelled);
  expect(
    await f.command(
      cancelled,
      "deleteQueueItem",
      { queueItemId: snapshot.queue.items[0]!.queueItemId },
      { baseRevision: snapshot.revision, baseLogEpoch: snapshot.logEpoch },
    ),
  ).toMatchObject({ status: "accepted" });
  await f.command(last, "sendText", { text: "C", projectExecutionScope });
  f.releases.shift()!();
  await expect.poll(() => f.started.at(-1)).toBe(last);
  expect(f.started).toEqual([first, last]);
  expect((await f.snapshot(cancelled)).queue.items).toHaveLength(0);
});

it("停止 ACK 不提前释放实际尚未结束的执行", async () => {
  const f = await fixture();
  const first = await f.create();
  const second = await f.create();
  const projectExecutionScope = { projectId: "fixed", workspaceKey: f.home };
  await f.command(first, "sendText", { text: "A", projectExecutionScope });
  await expect.poll(() => f.started.length).toBe(1);
  expect(await f.command(first, "stop", {})).toMatchObject({ status: "accepted" });
  expect(await f.command(second, "sendText", { text: "B", projectExecutionScope })).toMatchObject({
    result: { delivery: "queue" },
  });
  expect(f.started).toEqual([first]);
  f.releases.shift()!();
  await expect.poll(() => f.started.at(-1)).toBe(second);
  expect(f.maximumActive()).toBe(1);
});

it("两个 Host 同时提交时只启动一个，另一个由原队列等待", async () => {
  const f = await fixture();
  const other = f.otherClient();
  const a = await f.create();
  const b = await other.create();
  const projectExecutionScope = { projectId: "fixed", workspaceKey: f.home };
  const receipts = await Promise.all([
    f.command(a, "sendText", { text: "A", projectExecutionScope }),
    other.command(b, "sendText", { text: "B", projectExecutionScope }),
  ]);
  expect(
    receipts
      .map((receipt) =>
        receipt.result?.type === "inputAccepted" ? receipt.result.delivery : "invalid",
      )
      .sort(),
  ).toEqual(["queue", "startNow"]);
  await expect.poll(() => f.started.length).toBe(1);
  f.releases.shift()!();
  await expect.poll(() => f.started.length).toBe(2);
  expect(new Set(f.started).size).toBe(2);
  expect(f.maximumActive()).toBe(1);
});

it("冷恢复会话的新输入仍读取固定项目绑定，不绕过另一 Host 在办租约", async () => {
  const f = await fixture();
  const oldHost = f.otherClient();
  const b = await oldHost.create();
  const projectExecutionScope = { projectId: "fixed", workspaceKey: f.home };
  await oldHost.command(b, "sendText", { text: "Bind B", projectExecutionScope });
  await expect.poll(() => f.started.at(-1)).toBe(b);
  f.releases.shift()!();
  await expect.poll(() => f.apps.get(b)!.runtime.hasResidencyBlockingWork()).toBe(false);
  const a = await f.create();
  await f.command(a, "sendText", { text: "A", projectExecutionScope });
  await expect.poll(() => f.started.at(-1)).toBe(a);
  await oldHost.server.shutdown();
  oldHost.server.disposeProjections();
  const newHost = f.otherClient();
  await newHost.snapshot(b, "web-remote-replayable");
  const queued = await newHost.command(b, "sendText", { text: "B after resume" });
  expect(queued).toMatchObject({ status: "accepted", result: { delivery: "queue" } });
  expect((await newHost.snapshot(b)).queue.items).toHaveLength(1);
  expect(f.started).toEqual([b, a]);
  f.releases.shift()!();
  await expect.poll(() => f.started).toEqual([b, a, b]);
  expect(f.maximumActive()).toBe(1);
});

it("固定项目材料与真实工作区不符时，不接受或执行输入", async () => {
  const f = await fixture();
  const session = await f.create();
  const result = await f.command(session, "sendText", {
    text: "Wrong route",
    projectExecutionScope: { projectId: "fixed", workspaceKey: "foreign-workspace" },
  });
  expect(result).toMatchObject({
    status: "failed",
    reasonCode: "guard.projectExecution.workspaceMismatch",
  });
  expect(f.started).toHaveLength(0);
  expect((await f.snapshot(session)).queue.items).toHaveLength(0);
});

it("已绑定会话不能被后续输入换到另一个项目", async () => {
  const f = await fixture();
  const session = await f.create();
  await f.command(session, "sendText", {
    text: "Work",
    projectExecutionScope: { projectId: "original", workspaceKey: f.home },
  });
  await expect.poll(() => f.started.length).toBe(1);
  const rebound = await f.command(session, "sendText", {
    text: "Rebind",
    projectExecutionScope: { projectId: "replacement", workspaceKey: f.home },
  });
  expect(rebound).toMatchObject({
    status: "failed",
    reasonCode: "guard.projectExecution.bindingChanged",
  });
  expect((await f.snapshot(session)).queue.items).toHaveLength(0);
});

it("协议拒绝不完整或夹带未知字段的项目范围", async () => {
  const f = await fixture();
  const session = await f.create();
  for (const projectExecutionScope of [
    { projectId: "fixed" },
    { projectId: "fixed", workspaceKey: f.home, role: "admin" },
  ]) {
    expect(
      (await f.command(session, "sendText", { text: "Invalid scope", projectExecutionScope }))
        .status,
    ).toBe("rejected");
  }
  expect(f.started).toHaveLength(0);
});

it("同一会话排队续跑能替换自身旧租约，不阻塞第二项", async () => {
  const f = await fixture();
  const session = await f.create();
  const projectExecutionScope = { projectId: "fixed", workspaceKey: f.home };
  await f.command(session, "sendText", { text: "First in same session", projectExecutionScope });
  await expect.poll(() => f.started.length).toBe(1);
  expect(
    await f.command(session, "sendText", { text: "Second in same session", projectExecutionScope }),
  ).toMatchObject({ result: { delivery: "queue" } });
  f.releases.shift()!();
  await expect.poll(() => f.started.length).toBe(2);
  expect(f.maximumActive()).toBe(1);
  f.releases.shift()!();
  await expect.poll(() => f.apps.get(session)!.runtime.hasResidencyBlockingWork()).toBe(false);
});

it("12 重启查询原受理记录而不重放模型，未知 commandId 仍为 unknown", async () => {
  const f = await fixture();
  const session = await f.create();
  const result = join(f.home, "preserved-before-recovery.txt");
  await writeFile(result, "original result");
  const accepted = await f.command(session, "sendText", {
    text: "Original accepted work",
    projectExecutionScope: { projectId: "fixed", workspaceKey: f.home },
  });
  await expect.poll(() => f.started.length).toBe(1);
  f.releases.shift()!();
  await expect
    .poll(() => f.command(session, "inspectOwnedWork", {}))
    .toMatchObject({ result: { type: "ownedWorkState", state: "idle" } });
  await f.server.shutdown();
  f.server.disposeProjections();
  const restored = f.otherClient();
  expect(await restored.query(session, accepted.commandId)).toMatchObject({
    results: [
      {
        key: { sessionId: session, commandId: accepted.commandId },
        result: { result: { type: "inputAccepted", inputId: accepted.commandId } },
      },
    ],
  });
  await restored.snapshot(session, "web-remote-replayable");
  expect(await restored.command(session, "inspectOwnedWork", {})).toMatchObject({
    result: { type: "ownedWorkState", state: "idle" },
  });
  expect(await restored.query(session, "never-observed-command")).toMatchObject({
    results: [{ result: "unknown" }],
  });
  expect(f.started).toHaveLength(1);
  expect(await readFile(result, "utf8")).toBe("original result");
});
