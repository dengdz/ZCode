import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { Emitter } from "@zcode/rpc";
import {
  queueItemSchema,
  type ConversationSnapshot,
  type ConversationTopicWireCandidate,
  type CommandEnvelope,
} from "@zcode/shared/zcode-protocol-v4";
import { TaskIndexRepo } from "../src/session/taskIndexRepo.js";
import { createZCodeTaskIndexSyncer } from "../src/zcode-agent/zcodeTaskIndexSyncer.js";
import { createZCodeTaskServiceAdapter } from "../src/zcode-agent/zcodeTaskServiceAdapter.js";
import type { IZCodeAgentService } from "../src/zcode-agent/zcodeAgent.js";
import { setDataBaseDir } from "../src/paths.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup(options: { coldMcp?: boolean; workStartsOnSnapshot?: boolean } = {}) {
  const home = await mkdtemp(join(tmpdir(), "collaboration-stop-runtime-"));
  setDataBaseDir(home);
  const repo = new TaskIndexRepo(undefined, undefined, join(home, "tasks.db"));
  const wire = new Emitter<ConversationTopicWireCandidate>();
  const commands: CommandEnvelope[] = [];
  const routes: Record<string, unknown>[] = [];
  let rejectType: string | undefined;
  let ownedState: "idle" | "busy" | "unknown" = "busy";
  let subscription = 0;
  let inspectionStarted = false;
  let mcpInitializing = false;
  let receiptsKnown = true;
  let transformQuery: (value: unknown) => unknown = (value) => value;
  const queries: unknown[] = [];
  const snapshot: ConversationSnapshot = {
    protocolVersion: 1,
    sessionId: "original-task",
    logEpoch: "stop-test",
    seq: 1,
    revision: 1,
    control: {
      phase: "running",
      sessionEnded: false,
      canStop: true,
      stopState: "stoppable",
      stopTargetKind: "assistant",
      activeWorks: [
        {
          kind: "primaryTurn",
          sourceCommandId: "original-input",
          foregroundExecutionId: "original-execution",
          startedAt: 1,
        },
      ],
      lastError: null,
      apiRetry: null,
    },
    availability: {
      fork: { allowed: true },
      compact: { allowed: true },
      switchModelConfig: { allowed: true },
      setFollowupMode: { allowed: true },
      queueEdit: { allowed: true },
      sendQueuedNow: { allowed: true },
      pauseGoal: { allowed: false, reasonCode: "guard.noGoal" },
      resumeGoal: { allowed: false, reasonCode: "guard.noGoal" },
    },
    inputRouting: { mode: "enqueue" },
    meta: { title: "Original work", titleSource: "custom" },
    config: {
      provider: "test",
      model: "test",
      thought: "medium",
      thoughtLevels: [],
      followupMode: "queue",
      mode: "build",
    },
    modelTransition: null,
    usage: {
      contextWindow: null,
      cumulative: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    },
    queue: {
      items: [
        queueItemSchema.parse({
          sourceCommandId: "queued-input",
          queueItemId: "queued-input",
          clientId: "bot",
          kind: "sendText",
          text: "Do not run",
          delivery: { requested: "queue", admitted: "queue" },
          order: { admissionSeq: 2 },
          steer: { state: "notRequested" },
          dispatch: { state: "queued" },
          admittedAt: 1,
        }),
      ],
      autoDrain: true,
    },
    pendingInteractions: [],
    pendingCommands: [],
    backgroundWorks: [],
    workspaceHookAdmission: null,
    goal: null,
    plan: null,
    rows: { window: [], totalCount: 0, firstRowId: null },
  };
  const agent = {
    disposeAll: () => undefined,
    onDynamicConversationFrame: () => wire.event,
    subscribeConversationV4: async () => {
      if (options.coldMcp && !inspectionStarted) mcpInitializing = true;
      if (options.workStartsOnSnapshot) ownedState = "busy";
      const subscriptionId = `stop-${++subscription}`;
      const frame = {
        topic: "conversation/original-task",
        subscriptionId,
        fromSeq: 0,
        toSeq: snapshot.seq,
        sentAt: 1,
        payload: { kind: "snapshot" as const, snapshot: structuredClone(snapshot) },
      };
      setTimeout(
        () =>
          wire.fire({
            wireVersion: 1,
            kind: "complete",
            deliveryKind: "initial",
            logicalFrameId: subscriptionId,
            logicalFrameOrdinal: 1,
            topic: frame.topic,
            subscriptionId,
            frame,
          }),
        0,
      );
      return { ack: { subscriptionId, mode: "snapshot", logEpoch: snapshot.logEpoch } };
    },
    unsubscribeConversationV4: async () => undefined,
    queryConversationCommandsV4: async (params: {
      commands: Array<{ sessionId: string; commandId: string }>;
    }) => {
      queries.push(params);
      return transformQuery({
        results: params.commands.map((key) => ({
          key,
          result: receiptsKnown
            ? {
                commandId: key.commandId,
                status: "accepted",
                revisionAtDecision: 1,
                result: { type: "inputAccepted", inputId: key.commandId, delivery: "queue" },
              }
            : "unknown",
        })),
      });
    },
    sendConversationCommandV4: async ({ envelope, ...route }: { envelope: CommandEnvelope }) => {
      routes.push(route);
      commands.push(envelope);
      if (envelope.type === rejectType) throw new Error("Synthetic external command refusal");
      if (envelope.type === "inspectOwnedWork") {
        inspectionStarted = true;
        return {
          commandId: envelope.commandId,
          status: "accepted",
          revisionAtDecision: snapshot.revision,
          result: { type: "ownedWorkState", state: mcpInitializing ? "busy" : ownedState },
        };
      }
      if (envelope.type === "setAutoDrain")
        snapshot.queue.autoDrain = (envelope.payload as { autoDrain: boolean }).autoDrain;
      if (envelope.type === "deleteQueueItem")
        snapshot.queue.items = snapshot.queue.items.filter(
          (item) => item.queueItemId !== (envelope.payload as { queueItemId: string }).queueItemId,
        );
      if (envelope.type === "stop")
        snapshot.control = {
          ...snapshot.control,
          phase: "completedInterrupted",
          stopState: "idle",
          activeWorks: [],
        };
      if (envelope.type === "cancelBackgroundWork") snapshot.backgroundWorks = [];
      snapshot.revision += 1;
      snapshot.seq += 1;
      return {
        commandId: envelope.commandId,
        status: "accepted",
        revisionAtDecision: snapshot.revision,
      };
    },
  } as unknown as IZCodeAgentService;
  const syncer = createZCodeTaskIndexSyncer({ agentService: agent, taskIndexRepo: repo });
  const service = createZCodeTaskServiceAdapter({
    zcodeAgentService: agent,
    taskIndexRepo: repo,
    taskIndexSyncer: syncer,
  }) as ReturnType<typeof createZCodeTaskServiceAdapter> & { disposeAll(): void };
  cleanups.push(async () => {
    service.disposeAll();
    await repo.ensureReady();
    repo.close({ throwOnError: true });
    wire.dispose();
    setDataBaseDir(null);
    await rm(home, { recursive: true, force: true });
  });
  const target = {
    taskId: "original-task",
    workspacePath: "/original-workspace",
    inputIds: ["original-input", "queued-input"],
  };
  return {
    service,
    snapshot,
    commands,
    routes,
    target,
    queries,
    alterQuery: (transform: (value: unknown) => unknown) => {
      transformQuery = transform;
    },
    forgetReceipts: () => {
      receiptsKnown = false;
    },
    reject: (type: string) => {
      rejectType = type;
    },
    unknownOwnedWork: () => {
      ownedState = "unknown";
    },
    finishOwnedWork: () => {
      ownedState = "idle";
    },
  };
}

it("原任务停止先暂停原队列，取消原输入后按执行 token 停止；ACK 后仍有 owned work 时只报告正在停止", async () => {
  const f = await setup();
  await f.service.controlBotCollaborationTask!({ ...f.target, phase: "hold" });
  expect(f.commands.map((command) => command.type)).toEqual(["setAutoDrain"]);
  const result = await f.service.controlBotCollaborationTask!({ ...f.target, phase: "stop" });
  expect(result.state).toBe("stopping");
  expect(f.commands.map((command) => command.type)).toEqual([
    "setAutoDrain",
    "deleteQueueItem",
    "stop",
    "inspectOwnedWork",
  ]);
  expect(f.commands[2]!.payload).toEqual({ expectedForegroundExecutionId: "original-execution" });
  expect(f.snapshot.queue.items).toHaveLength(0);
  f.finishOwnedWork();
  expect((await f.service.controlBotCollaborationTask!({ ...f.target, phase: "stop" })).state).toBe(
    "stopped",
  );
});

it.each(["active", "queue", "missing-token"])(
  "不能因同一任务而停止其他来源或未知执行：%s",
  async (boundary) => {
    const f = await setup();
    if (boundary === "active")
      f.snapshot.control.activeWorks[0]!.sourceCommandId = "new-human-input";
    if (boundary === "queue") f.snapshot.queue.items[0]!.sourceCommandId = "other-requirement";
    if (boundary === "missing-token")
      f.snapshot.control.activeWorks[0]!.sourceCommandId = undefined;
    expect(
      (await f.service.controlBotCollaborationTask!({ ...f.target, phase: "hold" })).state,
    ).toBe("unavailable");
    expect(f.commands).toHaveLength(0);
  },
);

it.each([true, false])("后台可取消=%s；不可取消不能宣称已停止", async (cancellable) => {
  const f = await setup();
  f.snapshot.backgroundWorks = [
    {
      workId: "original-background",
      title: "Side work",
      kind: "bash",
      status: "running",
      startedAt: 1,
      cancellable,
      anchorRowId: null,
    },
  ];
  f.finishOwnedWork();
  await f.service.controlBotCollaborationTask!({ ...f.target, phase: "hold" });
  const result = await f.service.controlBotCollaborationTask!({ ...f.target, phase: "stop" });
  expect(result.state).toBe(cancellable ? "stopped" : "unavailable");
  expect(f.commands.some((command) => command.type === "cancelBackgroundWork")).toBe(cancellable);
});

it.each(["unknown", "old-cli", "stale-stop"])(
  "未知 owned work、旧 CLI 和执行代际拒绝不得冒充终态：%s",
  async (boundary) => {
    const f = await setup();
    await f.service.controlBotCollaborationTask!({ ...f.target, phase: "hold" });
    f.finishOwnedWork();
    if (boundary === "unknown") f.unknownOwnedWork();
    else f.reject(boundary === "old-cli" ? "inspectOwnedWork" : "stop");
    expect(
      (await f.service.controlBotCollaborationTask!({ ...f.target, phase: "stop" })).state,
    ).toBe("unavailable");
    expect(f.commands.filter((command) => command.type === "stop")).toHaveLength(1);
  },
);

it("新需求恢复仅在原 owned work 与原队列都空后开启 autoDrain，沿可信 Host scope", async () => {
  const f = await setup();
  await f.service.controlBotCollaborationTask!({ ...f.target, phase: "hold" });
  await f.service.controlBotCollaborationTask!({ ...f.target, phase: "stop" });
  expect(
    (await f.service.controlBotCollaborationTask!({ ...f.target, phase: "resume" })).state,
  ).toBe("unavailable");
  expect(f.snapshot.queue.autoDrain).toBe(false);
  f.finishOwnedWork();
  expect(
    (await f.service.controlBotCollaborationTask!({ ...f.target, phase: "resume" })).state,
  ).toBe("stopped");
  expect(f.snapshot.queue.autoDrain).toBe(true);
  expect(f.routes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        workspacePath: "/original-workspace",
        __zcodeTrustedV4Connection: expect.objectContaining({ clientMode: "desktop-continuous" }),
      }),
    ]),
  );
});

it("18 真实任务适配在冷快照之前检查工作，不把检查启动的 MCP 当成在办工作", async () => {
  const f = await setup({ coldMcp: true });
  f.finishOwnedWork();
  f.snapshot.control = {
    ...f.snapshot.control,
    phase: "completedInterrupted",
    stopState: "idle",
    activeWorks: [],
  };
  f.snapshot.queue.items = [];
  expect(await f.service.readBotCollaborationTask!(f.target)).toMatchObject({ ownedWork: "idle" });
});

it("12 只读核对原 commandId 的受理与 owned-work，不能因 UI 空闲或收据缺失重放", async () => {
  const f = await setup();
  expect(await f.service.readBotCollaborationTask!(f.target)).toEqual({
    ownedWork: "busy",
    inputs: [
      { inputId: "original-input", admission: "accepted" },
      { inputId: "queued-input", admission: "accepted" },
    ],
  });
  expect(f.queries).toEqual([
    expect.objectContaining({
      workspacePath: "/original-workspace",
      commands: [
        { sessionId: "original-task", commandId: "original-input" },
        { sessionId: "original-task", commandId: "queued-input" },
      ],
    }),
  ]);
  expect(f.commands.map((command) => command.type)).toEqual([
    "inspectOwnedWork",
    "inspectOwnedWork",
  ]);
  f.forgetReceipts();
  f.finishOwnedWork();
  f.snapshot.control = {
    ...f.snapshot.control,
    phase: "completedInterrupted",
    stopState: "idle",
    activeWorks: [],
  };
  f.snapshot.queue.items = [];
  expect(await f.service.readBotCollaborationTask!(f.target)).toEqual({
    ownedWork: "idle",
    inputs: [
      { inputId: "original-input", admission: "unknown" },
      { inputId: "queued-input", admission: "unknown" },
    ],
  });
  expect(f.commands.every((command) => command.type === "inspectOwnedWork")).toBe(true);
});

it("18 快照读取期间出现原 runtime 后台工作时，最终证明不能沿用此前 idle", async () => {
  const f = await setup({ workStartsOnSnapshot: true });
  f.finishOwnedWork();
  expect(await f.service.readBotCollaborationTask!(f.target)).toMatchObject({ ownedWork: "busy" });
});

it.each(["session", "command", "missing", "duplicate", "bare", "input-id", "disconnected"])(
  "12 外部查询证据不匹配或缺失不提升原输入：%s",
  async (boundary) => {
    const f = await setup();
    f.finishOwnedWork();
    f.snapshot.control = {
      ...f.snapshot.control,
      phase: "completed",
      stopState: "idle",
      activeWorks: [],
    };
    f.snapshot.queue.items = [];
    f.alterQuery((value) => {
      if (boundary === "disconnected") throw Error("Synthetic wire disconnected");
      const response = value as {
        results: Array<{
          key: { sessionId: string; commandId: string };
          result: {
            commandId: string;
            status: string;
            revisionAtDecision: number;
            result?: { type: string; inputId: string; delivery: string };
          };
        }>;
      };
      if (boundary === "session") response.results[0]!.key.sessionId = "another-session";
      if (boundary === "command") response.results[0]!.key.commandId = "another-command";
      if (boundary === "missing") response.results.pop();
      if (boundary === "duplicate") response.results[1] = response.results[0]!;
      if (boundary === "bare") for (const item of response.results) delete item.result.result;
      if (boundary === "input-id")
        for (const item of response.results) item.result.result!.inputId = "another-input";
      return response;
    });
    const evidence = await f.service.readBotCollaborationTask!(f.target);
    expect(evidence.inputs.every((item) => item.admission === "unknown")).toBe(true);
    expect(f.commands.every((command) => command.type === "inspectOwnedWork")).toBe(true);
  },
);
