import { Emitter } from "@zcode/rpc";
import { expect } from "vitest";
import { resolveWorkspaceKey } from "@zcode/shared";
import {
  sessionsIndexTopic,
  type SessionsIndexTopicWireFrame,
} from "@zcode/shared/zcode-protocol-v4";
import type { IZCodeAgentService } from "../../src/zcode-agent/zcodeAgent.js";
import { TaskIndexRepo } from "../../src/session/taskIndexRepo.js";
import { createZCodeTaskIndexSyncer } from "../../src/zcode-agent/zcodeTaskIndexSyncer.js";
import { createZCodeTaskServiceAdapter } from "../../src/zcode-agent/zcodeTaskServiceAdapter.js";

/** 真实 sessions-index / adapter 发现纯内存草稿；不接模型或真实工作区。 */
export async function workspaceDraftFixture(target: {
  workspacePath: string;
  workspaceIdentity?: string;
}) {
  const frames = new Emitter<SessionsIndexTopicWireFrame>();
  const key = resolveWorkspaceKey(target);
  const topic = sessionsIndexTopic(key);
  const agent = {
    subscribeSessionsIndexV4: async () => {
      frames.fire({
        wireVersion: 3,
        kind: "complete",
        logicalFrameId: "draft-fixture",
        logicalFrameOrdinal: 1,
        deliveryKind: "initial",
        topic,
        subscriptionId: "draft-index",
        frame: {
          topic,
          subscriptionId: "draft-index",
          fromSeq: 0,
          toSeq: 1,
          sentAt: 1,
          payload: {
            kind: "snapshot",
            snapshot: {
              protocolVersion: 1,
              workspaceId: key,
              logEpoch: "draft-fixture",
              sessions: [
                {
                  sessionId: "untouched-draft",
                  workspaceId: key,
                  title: "",
                  phase: "draft",
                  hasBackgroundWork: false,
                  sessionEnded: false,
                  lastActivityAt: 1,
                  createdAt: 1,
                },
              ],
            },
          },
        },
      });
      return {
        ack: { subscriptionId: "draft-index", mode: "snapshot", logEpoch: "draft-fixture" },
      };
    },
    subscribeWorkspaceConfigV4: async () => ({
      ack: { subscriptionId: "draft-config", mode: "snapshot", logEpoch: "draft-config" },
    }),
    onDynamicSessionsIndexFrame: () => frames.event,
    onDynamicWorkspaceConfigFrame: () => new Emitter().event,
    unsubscribeSessionsIndexV4: async () => {},
    unsubscribeWorkspaceConfigV4: async () => {},
    disposeAll() {},
  } as unknown as IZCodeAgentService;
  const repo = new TaskIndexRepo();
  const syncer = createZCodeTaskIndexSyncer({ agentService: agent, taskIndexRepo: repo });
  syncer.ensureWorkspaceSubscription(target);
  // 同步 initial 在 ACK 之前到达，沿真实 syncer staging 收口。
  await expect
    .poll(() =>
      syncer
        .activeTaskRefs()
        .some(
          (ref) =>
            ref.taskId === "untouched-draft" &&
            ref.workspacePath === target.workspacePath &&
            ref.workspaceIdentity === target.workspaceIdentity,
        ),
    )
    .toBe(true);
  const service = createZCodeTaskServiceAdapter({
    zcodeAgentService: agent,
    taskIndexRepo: repo,
    taskIndexSyncer: syncer,
  });
  return {
    service,
    dispose() {
      (service as typeof service & { disposeAll(): void }).disposeAll();
      frames.dispose();
    },
  };
}
