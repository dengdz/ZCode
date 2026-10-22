import { createHash } from "node:crypto";
import { withFileLock } from "@zcode/shared/node";
import {
  channelReplyHostRequestSchema,
  isFeishuBotProvider,
  type BotInboundMessage,
  type ChannelReplyHostRequest,
  type CollaborationConfig,
} from "@zcode/shared";
import type { BotCollaborationPort } from "./port.js";
import type { CollaborationStopState, CollaborationStopTarget } from "./contract.js";
import type { Ledger } from "./ledger.js";

export const STOP_STATUS_PREFIX = "local-stop-status:";
interface Dependencies {
  port: BotCollaborationPort;
  read(): Promise<Ledger>;
  write(ledger: Ledger): Promise<void>;
  authorize(
    ledger: Ledger,
    message: BotInboundMessage,
  ): Promise<"legacy" | "allow" | "redirect" | "deny">;
  validMember(config: CollaborationConfig, botId: string): Promise<unknown>;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function reject(): never {
  throw new Error("collaboration.unauthorized");
}

/** 同一 Local owner 的停止屏障；只持有控制意图和已确认事实，不拥有执行状态。 */
export function createStopControl({ port, read, write, authorize, validMember }: Dependencies) {
  // 仅合并当前调用，不保存运行状态；跨进程仍由持久关联及 runtime token 防止错停。
  const pending = new Map<string, Promise<CollaborationStopState | undefined>>();
  const execute = async (value: BotInboundMessage | ChannelReplyHostRequest) => {
    const message = "actor" in value ? value : undefined;
    const request = message ? undefined : channelReplyHostRequestSchema.parse(value);
    if (
      message &&
      (message.actor.chatType !== "group" ||
        !message.actor.chatId ||
        !isFeishuBotProvider(message.actor.provider))
    )
      return undefined;
    const plan = await withFileLock(port.file, async () => {
      const ledger = await read();
      if (
        message &&
        !ledger.groups.some(
          (item) =>
            item.provider === message.actor.provider &&
            item.chatId === message.actor.chatId &&
            item.config?.enabled,
        )
      )
        return undefined;
      const states = await port.readStates();
      const matches = states.filter((state) =>
        message
          ? state.botId === message.botId &&
            state.group?.chatId === message.actor.chatId &&
            state.group?.threadId === message.actor.threadId
          : state.activeTaskId === request!.taskId &&
            (state.workspaceIdentity?.trim() || state.workspacePath) ===
              (request!.workspaceIdentity?.trim() || request!.workspacePath) &&
            state.workspacePath === request!.workspacePath &&
            state.group,
      );
      if (matches.length !== 1) reject();
      const context = matches[0]!;
      const group = context.group!;
      const config = ledger.groups.find(
        (item) =>
          item.chatId === group.chatId &&
          (message
            ? item.provider === message.actor.provider
            : item.config?.pm.botId === context.botId),
      )?.config;
      if (!config?.enabled) {
        if (message) return undefined;
        return reject();
      }
      if (
        context.botId !== config.pm.botId ||
        !group.enabled ||
        group.topicActive === false ||
        group.ownerId !== config.pm.ownerOpenId ||
        !group.authorizationId ||
        !(await validMember(config, context.botId))
      )
        reject();
      if (
        message &&
        (message.senderType === "app" ||
          !message.actor.providerMessageId ||
          (await authorize(ledger, message)) !== "allow")
      )
        reject();
      if (
        request &&
        (request.collaboration?.kind !== "stop" ||
          request.parts.length !== 1 ||
          request.parts[0]?.type !== "text" ||
          request.parts[0].text !== "" ||
          (request.authorizationId !== undefined &&
            request.authorizationId !== group.authorizationId))
      )
        reject();
      const id = hash(
        message
          ? [
              "native",
              message.botId,
              config.provider,
              group.chatId,
              group.threadId,
              message.actor.providerMessageId,
            ]
          : [
              "tool",
              context.botId,
              config.provider,
              group.chatId,
              group.threadId,
              request!.taskId,
              request!.inputId,
              request!.toolCallId,
            ],
      );
      const previous = ledger.stopRequests.find((item) => item.id === id);
      const input = ledger.inputs.findLast(
        (item) =>
          item.provider === config.provider &&
          item.chatId === config.chatId &&
          item.botId === context.botId &&
          item.taskId === context.activeTaskId &&
          item.revision === config.revision &&
          (!request || item.inputId === request.inputId),
      );
      const native = input && group.inputs?.[input.inputId];
      // 模型只能表达意图，不能用执行者回报或另一输入的真人身份获得叫停权。
      if (
        request &&
        (!input ||
          native?.admission !== "accepted" ||
          native.taskId !== request.taskId ||
          native.source.senderId !== config.pm.ownerOpenId ||
          native.source.authorizationId !== group.authorizationId ||
          native.source.appId !== config.pm.appId ||
          native.source.botId !== context.botId ||
          native.source.provider !== config.provider ||
          native.source.chatId !== config.chatId ||
          native.source.threadId !== group.threadId)
      )
        reject();
      const requirement = ledger.requirements.find(
        (item) => item.id === (previous?.requirementId ?? input?.requirementId),
      );
      if (
        !requirement ||
        !input ||
        !native ||
        requirement.revision !== config.revision ||
        requirement.unionId !== config.authorizedUser.unionId ||
        requirement.tenantKey !== config.authorizedUser.tenantKey ||
        (previous && previous.revision !== config.revision)
      )
        throw new Error("collaboration.stop_unavailable");
      const notice = previous ?? {
        provider: config.provider,
        chatId: config.chatId,
        botId: context.botId,
        threadId: group.threadId,
        id,
        requirementId: requirement.id,
        revision: config.revision,
        taskId: input.taskId,
        inputId: input.inputId,
        authorizationId: group.authorizationId,
        messageId: native.source.messageId,
        ownerId: config.pm.ownerOpenId,
        deliveryIds: [],
      };
      if (!previous) ledger.stopRequests.push(notice);
      requirement.stopRequested = true;
      const inputs = ledger.inputs.filter(
        (item) => item.requirementId === requirement.id && item.revision === config.revision,
      );
      const targets = new Map<string, CollaborationStopTarget>();
      let unresolved = false;
      for (const item of inputs) {
        const owner = states.find(
          (state) =>
            state.botId === item.botId &&
            state.group?.chatId === item.chatId &&
            state.group.inputs?.[item.inputId]?.taskId === item.taskId,
        );
        if (!owner?.group) {
          unresolved = true;
          continue;
        }
        const key = JSON.stringify([
          item.botId,
          item.workspaceIdentity?.trim() || item.workspacePath,
          item.taskId,
        ]);
        const target = targets.get(key) ?? {
          provider: item.provider,
          chatId: item.chatId,
          botId: item.botId,
          threadId: owner.group.threadId,
          taskId: item.taskId,
          workspacePath: item.workspacePath,
          ...(item.workspaceIdentity ? { workspaceIdentity: item.workspaceIdentity } : {}),
          inputIds: [],
        };
        target.inputIds.push(item.inputId);
        targets.set(key, target);
      }
      for (const selection of ledger.selections) {
        if (
          inputs.some(
            (item) =>
              item.botId === selection.botId &&
              item.taskId === selection.request.taskId &&
              item.inputId === selection.request.inputId,
          ) &&
          ["awaiting", "selected"].includes(selection.status)
        )
          selection.status = "invalidated";
      }
      // 屏障在任何取消 IO 前落盘；停止通知仍通过原投递 owner 保存结果。
      await write(ledger);
      return {
        id,
        requirementId: requirement.id,
        confirmed: requirement.stopConfirmed,
        unresolved,
        targets: [...targets.values()],
      };
    });
    if (!plan) return undefined;
    const notice = await withFileLock(port.file, async () => {
      const ledger = await read();
      const requirement = ledger.requirements.find((item) => item.id === plan.requirementId)!;
      const current = ledger.groups.find(
        (item) => item.provider === requirement.provider && item.chatId === requirement.chatId,
      )?.config;
      let state: CollaborationStopState = requirement.stopConfirmed ? "stopped" : "unavailable";
      // 控制与新需求恢复共用同一锁；旧计划即使跨 owner 延迟，也须先重读已确认事实。
      if (
        !requirement.stopConfirmed &&
        current?.enabled &&
        current.revision === requirement.revision
      ) {
        try {
          state = plan.targets.length
            ? ((await port.stopTasks?.(plan.targets)) ?? "unavailable")
            : "unavailable";
        } catch {
          /* 断线不能被解释为空闲；保留屏障和原调用关联。 */
        }
        if (plan.unresolved) state = "unavailable";
        if (state === "stopped") requirement.stopConfirmed = true;
      }
      const saved = ledger.stopRequests.find((item) => item.id === plan.id)!;
      const deliveryId = STOP_STATUS_PREFIX + hash([plan.id, state]);
      const publish = !saved.deliveryIds.includes(deliveryId);
      if (publish) saved.deliveryIds.push(deliveryId);
      await write(ledger);
      return { ...saved, deliveryId, state, publish };
    });
    if (notice.publish) await port.publishStop?.(notice);
    return notice.state;
  };
  return (value: BotInboundMessage | ChannelReplyHostRequest) => {
    const id = hash(value);
    const existing = pending.get(id);
    if (existing) return existing;
    const result = execute(value).finally(() => pending.delete(id));
    pending.set(id, result);
    return result;
  };
}
