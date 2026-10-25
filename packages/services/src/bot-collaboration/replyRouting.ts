import { createHash, randomUUID } from "node:crypto";
import { withFileLock } from "@zcode/shared/node";
import type {
  BotConfig,
  BotContextState,
  BotGroupDelivery,
  ChannelReplyHostRequest,
  CollaborationConfig,
  CollaborationScope,
} from "@zcode/shared";
import type {
  BotCollaborationContract,
  BotCollaborationPort,
  RecipientSelectionOutcome,
} from "./contract.js";
import {
  handoffSchema,
  recipientSelectionSchema,
  type Ledger,
  type RecipientSelection,
} from "./ledger.js";
import { validateDispatchRecipient } from "./dispatchValidation.js";

export const SELECTION_CARD_PREFIX = "local-selection-card:";
const SELECTION_LIFETIME_MS = 15 * 60_000;
type Scope = CollaborationScope & { botId: string; threadId?: string };
type Member = {
  member: CollaborationConfig["pm"] | CollaborationConfig["executors"][number];
  bot: BotConfig;
};
interface Dependencies {
  port: BotCollaborationPort;
  read(): Promise<Ledger>;
  write(ledger: Ledger): Promise<void>;
  validMember(config: CollaborationConfig, botId: string): Promise<Member | undefined>;
  connectedTarget(
    config: CollaborationConfig,
    botId: string,
    threadId?: string,
  ): Promise<Member | undefined>;
}
type RecordReplySent = (scope: Scope, delivery: BotGroupDelivery) => Promise<void>;
const key = (scope: CollaborationScope) => JSON.stringify([scope.provider, scope.chatId]);
function fail(reason: string): never {
  throw new Error(`collaboration.${reason}`);
}
const fingerprint = (request: ChannelReplyHostRequest) =>
  createHash("sha256")
    .update(JSON.stringify([request.parts, request.collaboration]))
    .digest("hex");
const selectionResult = (p: RecipientSelection) => ({
  status: "awaiting_selection" as const,
  selectionId: p.token,
  state:
    p.status === "awaiting"
      ? ("awaiting" as const)
      : p.status === "selected" || p.status === "claimed"
        ? ("resuming" as const)
        : ("closed" as const),
});

/** 同一协作 owner 的路由与卡片操作；所有数据仍由注入的原 Local ledger 读写。 */
export function createReplyRouting(deps: Dependencies) {
  const { port, read, write, validMember, connectedTarget } = deps;
  const enabledConfig = (ledger: Ledger, scope: CollaborationScope) =>
    ledger.groups.find((item) => key(item) === key(scope))?.config;
  const sourceState = (p: RecipientSelection, states: BotContextState[]) =>
    states.find(
      (state) =>
        state.botId === p.botId &&
        state.activeTaskId === p.request.taskId &&
        state.group?.chatId === p.chatId &&
        state.group.threadId === p.threadId &&
        state.group.enabled &&
        state.group.topicActive !== false &&
        state.group.authorizationId === p.authorizationId &&
        (state.workspaceIdentity?.trim() || state.workspacePath) ===
          (p.request.workspaceIdentity?.trim() || p.request.workspacePath) &&
        state.group.inputs?.[p.request.inputId]?.taskId === p.request.taskId &&
        state.group.inputs[p.request.inputId]?.admission === "accepted" &&
        state.group.inputs[p.request.inputId]?.source.authorizationId === p.authorizationId &&
        !["stopped", "cancelled", "discarded"].includes(
          state.group.inputs[p.request.inputId]?.progress?.status ?? "",
        ),
    );
  const currentSelection = async (ledger: Ledger, p: RecipientSelection) => {
    const config = enabledConfig(ledger, p);
    const input = ledger.inputs.find(
      (item) =>
        item.botId === p.botId &&
        item.taskId === p.request.taskId &&
        item.inputId === p.request.inputId &&
        key(item) === key(p),
    );
    if (
      !input ||
      ledger.requirements.some((item) => item.id === input.requirementId && item.stopRequested)
    )
      return undefined;
    const member =
      config?.enabled && config.revision === p.revision
        ? await validMember(config, p.botId)
        : undefined;
    const state = sourceState(p, await port.readStates());
    return config &&
      member &&
      input?.selectionId === p.token &&
      state?.group?.ownerId === member.member.ownerOpenId &&
      state.projectId === config.workspace.projectId
      ? { config, member, state }
      : undefined;
  };
  const createPending = async (
    ledger: Ledger,
    config: CollaborationConfig,
    scope: Scope,
    request: ChannelReplyHostRequest,
    deliveryId: string,
    originalName: string,
  ) => {
    const current = await validMember(config, scope.botId);
    const state = (await port.readStates()).find(
      (item) =>
        item.botId === scope.botId &&
        item.activeTaskId === request.taskId &&
        item.group?.chatId === scope.chatId &&
        item.group.threadId === scope.threadId,
    );
    if (!state?.group?.authorizationId || !current) fail("stale");
    const isPm = scope.botId === config.pm.botId;
    const intent = request.collaboration!;
    const botTargets =
      isPm &&
      (intent.kind === "dispatch" ||
        (intent.kind === "question" && (intent.targetBotId || intent.requiredDuty)))
        ? config.executors
        : !isPm
          ? [config.pm]
          : [];
    const candidates: RecipientSelection["candidates"] = [];
    for (const member of botTargets) {
      const target = await connectedTarget(config, member.botId, scope.threadId);
      if (target)
        candidates.push({
          botId: member.botId,
          openId: target.member.openId,
          name: target.bot.name,
          duty: config.executors.find((item) => item.botId === member.botId)?.duty ?? "PM",
          kind: "bot",
        });
    }
    if (!botTargets.length && isPm)
      candidates.push({
        openId: current.member.ownerOpenId,
        name: originalName,
        duty: "需求用户",
        kind: "user",
      });
    if (!candidates.length)
      return {
        status: "blocked" as const,
        reason: "reference_unavailable" as const,
        message: "Nothing sent. No currently verified, connected candidate is available.",
      };
    const p = recipientSelectionSchema.parse({
      ...scope,
      id: deliveryId,
      token: randomUUID(),
      request: { ...request, authorizationId: state.group.authorizationId },
      requestHash: fingerprint(request),
      revision: config.revision,
      authorizationId: state.group.authorizationId,
      expiresAt: Date.now() + SELECTION_LIFETIME_MS,
      cardClaimed: false,
      status: "awaiting",
      candidates,
    });
    ledger.selections.push(p);
    const input = ledger.inputs.find(
      (item) =>
        item.botId === scope.botId &&
        item.taskId === request.taskId &&
        item.inputId === request.inputId &&
        key(item) === key(scope),
    )!;
    input.selectionId = p.token;
    input.replyIntent = "selection";
    await write(ledger);
    return selectionResult(p);
  };
  const prepareReply: BotCollaborationContract["prepareReply"] = async (
    request,
    scope,
    deliveryId,
    trusted,
  ) => {
    return withFileLock(port.file, async () => {
      const ledger = await read();
      const config = enabledConfig(ledger, scope);
      if (!config?.enabled) {
        if (request.collaboration) fail("unavailable");
        return undefined;
      }
      let intent = request.collaboration;
      if (!intent) fail("intentRequired");
      const current = await validMember(config, scope.botId);
      const input = ledger.inputs.find(
        (item) =>
          key(item) === key(scope) &&
          item.botId === scope.botId &&
          item.inputId === request.inputId &&
          item.taskId === request.taskId &&
          item.workspacePath === request.workspacePath &&
          // 与渠道绑定使用同一身份 key，空串及首尾空白不能使合法本地请求失效。
          (item.workspaceIdentity?.trim() || item.workspacePath) ===
            (request.workspaceIdentity?.trim() || request.workspacePath) &&
          item.revision === config.revision,
      );
      const original = ledger.requirements.find(
        (item) =>
          item.id === input?.requirementId &&
          item.revision === config.revision &&
          item.unionId === config.authorizedUser.unionId &&
          item.tenantKey === config.authorizedUser.tenantKey,
      );
      if (!current || !input || !original) fail("stale");
      if (original.stopRequested) fail("stopped");
      if (intent.kind === "accept") {
        if (scope.botId !== config.pm.botId) fail("direction");
        if (
          request.parts.length !== 1 ||
          request.parts[0]?.type !== "text" ||
          request.parts[0].text !== ""
        )
          fail("acceptContent");
        if (
          original.status === "closed" &&
          original.acceptedByInputId === request.inputId &&
          original.acceptedByToolCallId === request.toolCallId
        )
          return { status: "acceptance_recorded" as const };
        if (
          original.status !== "awaiting_acceptance" ||
          !original.acceptancePendingInputId ||
          !original.acceptancePendingDeliveryId
        )
          return {
            status: "blocked",
            reason: "acceptance_not_ready",
            message:
              "Requirement remains open. A sent final report is required before user acceptance.",
          };
        if (original.acceptancePendingInputId === request.inputId)
          return {
            status: "blocked",
            reason: "acceptance_same_turn",
            message:
              "Requirement remains open. The user must reply after the final report before acceptance.",
          };
        if (input.senderType !== "user")
          return {
            status: "blocked",
            reason: "acceptance_requires_user",
            message:
              "Requirement remains open. Acceptance requires a later input from the authorized user.",
          };
        original.status = "closed";
        original.acceptedByInputId = request.inputId;
        original.acceptedByToolCallId = request.toolCallId;
        input.replyIntent = "silent";
        input.silentCalls = [...(input.silentCalls ?? []), `accept:${request.toolCallId}`];
        await write(ledger);
        return { status: "acceptance_recorded" as const };
      }
      if (original.status === "closed") fail("accepted");
      const pending = ledger.selections.find(
        (item) => item.id === deliveryId && item.botId === scope.botId && key(item) === key(scope),
      );
      if (pending) {
        if (pending.requestHash !== fingerprint(request)) fail("idempotencyConflict");
        if (pending.status !== "selected") return selectionResult(pending);
        if (!(await currentSelection(ledger, pending)) || pending.expiresAt <= Date.now()) {
          pending.status = "invalidated";
          await write(ledger);
          return selectionResult(pending);
        }
        const selected = pending.candidates[pending.selectedIndex!];
        if (!selected) fail("stale");
        if (intent.kind === "dispatch" || intent.kind === "question")
          intent = { ...intent, targetBotId: selected.botId };
      }
      if (intent.kind === "silent") {
        if (
          request.parts.length !== 1 ||
          request.parts[0]?.type !== "text" ||
          request.parts[0].text !== ""
        )
          fail("silentContent");
        // 同参重放只返回原接受事实，不能重新覆盖其后正式工作产生的 visible 意图。
        if (input.silentCalls?.includes(deliveryId)) return { status: "silent" as const };
        // 正式发送或拦截已有可核查事实，不能再把这一轮宣称为纯确认。
        if (input.replyIntent === "visible" || input.replyIntent === "selection")
          fail("outputVisible");
        input.replyIntent = "silent";
        input.silentCalls = [...(input.silentCalls ?? []), deliveryId];
        await write(ledger);
        return { status: "silent" as const };
      }
      if (input.silentCalls?.includes(deliveryId)) fail("idempotencyConflict");
      if (!pending) {
        if (input.selectionId) {
          const old = ledger.selections.find((item) => item.token === input.selectionId);
          if (old?.status === "awaiting") old.status = "invalidated";
          input.selectionId = undefined;
        }
        input.replyIntent = "visible";
        await write(ledger);
      }
      if (!request.parts.some((part) => part.type === "text" && part.text.trim()))
        fail("untrustedRecipient");
      if (
        scope.botId === config.pm.botId &&
        (intent.kind === "dispatch" || (intent.kind === "question" && intent.requiredDuty)) &&
        !intent.targetBotId
      ) {
        if (!intent.requiredDuty)
          return {
            status: "blocked",
            reason: "required_duty_missing",
            message: "Nothing sent. Declare the task requiredDuty before choosing a recipient.",
          };
        return createPending(ledger, config, scope, request, deliveryId, original.name);
      }
      let targetBotId: string | undefined;
      if (scope.botId === config.pm.botId) {
        if (intent.kind === "report") fail("direction");
        if (intent.kind === "dispatch" || (intent.kind === "question" && intent.targetBotId)) {
          if (!config.executors.some((item) => item.botId === intent.targetBotId))
            fail("direction");
          targetBotId = intent.targetBotId;
        }
      } else {
        if (intent.kind !== "report" && intent.kind !== "question") fail("direction");
        if (
          intent.kind === "question" &&
          intent.targetBotId &&
          intent.targetBotId !== config.pm.botId
        )
          fail("direction");
        targetBotId = config.pm.botId;
      }
      const target = targetBotId
        ? await connectedTarget(config, targetBotId, scope.threadId)
        : undefined;
      if (targetBotId && !target) fail("identityUnavailable");
      const blocked = validateDispatchRecipient({
        intent,
        isPm: scope.botId === config.pm.botId,
        targetBotId,
        actualDuty: config.executors.find((member) => member.botId === targetBotId)?.duty,
        expectedTargetId: target?.member.openId ?? current.member.ownerOpenId,
        provider: scope.provider,
        parts: pending ? request.parts.filter((part) => part.type === "text") : request.parts,
        trusted,
      });
      if (blocked) {
        if (
          !pending &&
          (blocked.reason === "reference_unavailable" || blocked.reason === "recipient_mismatch")
        )
          return createPending(ledger, config, scope, request, deliveryId, original.name);
        return blocked;
      }
      const bodyLength = request.parts.reduce(
        (size, part) => size + (part.type === "text" ? part.text.length : 0),
        0,
      );
      if (pending && bodyLength + (target?.bot.name ?? original.name).length + 1 > 2000) {
        pending.status = "rejected";
        await write(ledger);
        fail("messageTooLong");
      }
      if (pending) {
        pending.status = "claimed";
        await write(ledger);
      }
      if (intent.kind === "dispatch" || intent.kind === "question" || intent.kind === "final") {
        // 发送前先登记最小意图；外部结果 unknown 后仍可由原投递核对事实结算到正确需求阶段。
        const previous = original.stageDeliveries.find((item) => item.deliveryId === deliveryId);
        if (previous && (previous.inputId !== request.inputId || previous.kind !== intent.kind))
          fail("stale");
        if (!previous)
          original.stageDeliveries.push({
            deliveryId,
            inputId: request.inputId,
            kind: intent.kind,
            status: "prepared",
          });
        await write(ledger);
      }
      if (targetBotId) {
        const handoff = handoffSchema.parse({
          provider: scope.provider,
          chatId: scope.chatId,
          threadId: scope.threadId,
          id: deliveryId,
          fromBotId: scope.botId,
          toBotId: targetBotId,
          fromTaskId: request.taskId,
          fromInputId: request.inputId,
          requirementId: original.id,
          revision: config.revision,
          ...(scope.botId === config.pm.botId &&
          (intent.kind === "dispatch" || intent.kind === "question")
            ? { requiredDuty: intent.requiredDuty }
            : {}),
        });
        const previous = ledger.handoffs.find((item) => item.id === deliveryId);
        if (previous && JSON.stringify(previous) !== JSON.stringify(handoff)) fail("stale");
        if (!previous) ledger.handoffs.push(handoff);
        await write(ledger);
      }
      port.diagnose?.({
        provider: scope.provider,
        chatId: scope.chatId,
        botId: scope.botId,
        action: "send",
        outcome: "prepared",
        deliveryId,
        requirementId: original.id,
        revision: config.revision,
      });
      return [
        {
          type: "channelMention" as const,
          refId: `local:${deliveryId}`,
          name: target?.bot.name ?? original.name,
          channel: scope.provider,
          targetId: target?.member.openId ?? current.member.ownerOpenId,
          idType: "open_id" as const,
          entityType: target ? ("bot" as const) : ("user" as const),
        },
        ...request.parts.filter(
          (part): part is { type: "text"; text: string } => part.type === "text",
        ),
      ];
    });
  };
  const recordReplySent: RecordReplySent = async (scope, delivery) =>
    withFileLock(port.file, async () => {
      if (delivery.status !== "sent") return;
      const ledger = await read();
      const config = enabledConfig(ledger, scope);
      if (!config?.enabled) return;
      const input = ledger.inputs.find(
        (item) =>
          key(item) === key(scope) &&
          item.botId === scope.botId &&
          item.inputId === delivery.sourceCommandId &&
          item.taskId === delivery.taskId &&
          item.revision === config.revision,
      );
      const original = ledger.requirements.find(
        (item) => item.id === input?.requirementId && item.revision === config.revision,
      );
      if (!input || !original) fail("stale");
      const stageIndex = original.stageDeliveries.findIndex(
        (item) => item.deliveryId === delivery.id,
      );
      const stage = original.stageDeliveries[stageIndex];
      if (!stage || stage.status === "settled") return;
      const latestSettledIndex = original.stageDeliveries.findLastIndex(
        (item) => item.status === "settled",
      );
      // 旧投递可在新阶段之后才补齐收据；只按登记顺序接受最新已结算意图，不能回滚当前阶段。
      if (latestSettledIndex > stageIndex) return;
      stage.status = "settled";
      if (stage.kind === "final") {
        original.status = "awaiting_acceptance";
        original.acceptancePendingInputId = stage.inputId;
        original.acceptancePendingDeliveryId = delivery.id;
        delete original.acceptedByInputId;
        await write(ledger);
        return;
      }
      if (
        (stage.kind === "dispatch" || stage.kind === "question") &&
        scope.botId === config.pm.botId &&
        original.status === "awaiting_acceptance"
      ) {
        original.status = "active";
        delete original.acceptancePendingInputId;
        delete original.acceptancePendingDeliveryId;
      }
      // 无阶段跳转的 dispatch/question 也必须持久化 settled，供迟到 final 收据判断先后。
      await write(ledger);
    });
  const authorizeCard = async (ledger: Ledger, scope: Scope, delivery: BotGroupDelivery) => {
    const p = ledger.selections.find(
      (item) =>
        SELECTION_CARD_PREFIX + item.token === delivery.id &&
        item.botId === scope.botId &&
        key(item) === key(scope) &&
        item.threadId === scope.threadId,
    );
    return Boolean(
      p &&
      p.cardClaimed &&
      p.status === "awaiting" &&
      p.expiresAt > Date.now() &&
      (await currentSelection(ledger, p)),
    );
  };
  const recipientSelection: BotCollaborationContract["recipientSelection"] = (command) =>
    withFileLock(port.file, async (): Promise<RecipientSelectionOutcome | undefined> => {
      const ledger = await read();
      const text = (zh: string, en: string) => (command.locale === "en-US" ? en : zh);
      if (command.kind === "present") {
        const p = ledger.selections.find((item) => item.token === command.selectionId);
        if (
          !p ||
          p.cardClaimed ||
          p.status !== "awaiting" ||
          p.expiresAt <= Date.now() ||
          !(await currentSelection(ledger, p))
        )
          return undefined;
        // 卡片展示也必须持久领取；进程中断后不猜测是否已发送，更不另发第二张。
        p.cardClaimed = true;
        await write(ledger);
        return {
          kind: "card",
          botId: p.botId,
          chatId: p.chatId,
          threadId: p.threadId,
          delivery: {
            id: SELECTION_CARD_PREFIX + p.token,
            appId: (await validMember(enabledConfig(ledger, p)!, p.botId))!.bot.feishuAppId,
            authorizationId: p.authorizationId,
            taskId: p.request.taskId,
            sourceCommandId: p.request.inputId,
            text: text(
              "请选择收件人（原消息尚未发送）",
              "Choose a recipient (original message not sent)",
            ),
            threadId: p.threadId,
            replyToMessageId: sourceState(p, await port.readStates())!.group!.inputs![
              p.request.inputId
            ]!.source.messageId,
            status: "pending",
            updatedAt: Date.now(),
          },
        };
      }
      if (command.kind === "render") {
        const p = ledger.selections.find(
          (item) =>
            SELECTION_CARD_PREFIX + item.token === command.deliveryId &&
            key(item) === key(command.scope) &&
            item.botId === command.scope.botId &&
            item.threadId === command.scope.threadId,
        );
        if (
          !p ||
          p.status !== "awaiting" ||
          p.expiresAt <= Date.now() ||
          !(await currentSelection(ledger, p))
        )
          return undefined;
        return {
          kind: "render",
          message: {
            botId: p.botId,
            provider: p.provider,
            providerUserId: p.chatId,
            locale: command.locale,
            threadId: p.threadId,
            text: text(
              "请选择收件人（原消息尚未发送）；选择不会改变任务职责。",
              "Choose a recipient (original message not sent). Selection cannot change the task duty.",
            ),
            groupCard: {
              chatId: p.chatId,
              threadId: p.threadId,
              taskId: p.request.taskId,
              authorizationId: p.authorizationId,
            },
            selection: {
              id: p.token,
              title: text("请选择收件人", "Choose a recipient"),
              action: "channel.recipient",
              showCancel: false,
              options: [
                ...p.candidates.map((candidate, index) => ({
                  id: `/channel-recipient ${p.token} ${index}`,
                  label: `${candidate.name} · ${candidate.kind === "user" ? text("需求用户", "Requester") : candidate.duty}`,
                })),
                {
                  id: `/channel-recipient ${p.token} cancel`,
                  label: text("取消，不发送", "Cancel without sending"),
                },
              ],
            },
          },
        };
      }
      const m = command.message;
      const match = /^\/channel-recipient ([\w-]+) (cancel|\d+)$/.exec(m.text.trim());
      if (!match) return { kind: "notice", message: "recipientSelectionInvalid", update: false };
      const p = ledger.selections.find((item) => item.token === match[1]);
      const current = p ? await currentSelection(ledger, p) : undefined;
      const card = current?.state.group?.deliveries?.[SELECTION_CARD_PREFIX + p!.token];
      if (
        !p ||
        !m.groupCardAction ||
        m.senderType === "app" ||
        m.actor.provider !== p.provider ||
        m.botId !== p.botId ||
        m.actor.botId !== p.botId ||
        m.actor.chatType !== "group" ||
        m.actor.chatId !== p.chatId ||
        m.actor.threadId !== p.threadId ||
        !current ||
        m.actor.providerUserId !== current.member.member.ownerOpenId ||
        m.groupCard?.taskId !== p.request.taskId ||
        m.groupCard.authorizationId !== p.authorizationId ||
        m.groupCard.chatId !== p.chatId ||
        m.groupCard.threadId !== p.threadId ||
        !card?.providerMessageId ||
        m.groupCardMessageId !== card.providerMessageId ||
        card.status !== "sent"
      )
        return { kind: "notice", message: "recipientSelectionUnauthorized", update: false };
      if (p.status === "cancelled" || p.status === "invalidated" || p.status === "rejected")
        return { kind: "notice", message: "recipientSelectionClosed", update: true };
      if (p.status === "claimed" || (p.status === "selected" && p.expiresAt > Date.now())) {
        // 只能重读同一选择的原收据；不同选择不能更换已领取的收件人。
        if (String(p.selectedIndex) !== match[2])
          return { kind: "notice", message: "recipientSelectionTaken", update: false };
        return { kind: "resume", request: p.request };
      }
      // claimed 不再启动发送，只能读取原收据；已发送/未知事实不能被过期提示覆盖。
      if (p.expiresAt <= Date.now()) {
        p.status = "invalidated";
        await write(ledger);
        return { kind: "notice", message: "recipientSelectionExpired", update: true };
      }
      if (match[2] === "cancel") {
        p.status = "cancelled";
        await write(ledger);
        return { kind: "notice", message: "recipientSelectionCancelled", update: true };
      }
      const index = Number(match[2]);
      const selected = p.candidates[index];
      if (!selected)
        return { kind: "notice", message: "recipientSelectionCandidateInvalid", update: false };
      const actual = selected.botId
        ? await connectedTarget(current.config, selected.botId, p.threadId)
        : undefined;
      const intent = p.request.collaboration!;
      const needed =
        current.config.pm.botId === p.botId &&
        (intent.kind === "dispatch" || intent.kind === "question") &&
        selected.kind === "bot"
          ? intent.requiredDuty
          : undefined;
      if (
        (selected.botId && (!actual || actual.member.openId !== selected.openId)) ||
        (needed && (!actual || !("duty" in actual.member) || actual.member.duty !== needed))
      ) {
        p.status = "rejected";
        await write(ledger);
        return {
          kind: "notice",
          message: "recipientSelectionRoleMismatch",
          update: true,
        };
      }
      const bodyLength = p.request.parts.reduce(
        (size, part) => size + (part.type === "text" ? part.text.length : 0),
        0,
      );
      if (bodyLength + (actual?.bot.name ?? selected.name).length + 1 > 2000) {
        p.status = "rejected";
        await write(ledger);
        return { kind: "notice", message: "recipientSelectionTooLong", update: true };
      }
      p.selectedIndex = index;
      p.status = "selected";
      await write(ledger);
      return { kind: "resume", request: p.request };
    });
  const recoverSelections = async (
    ledger: Ledger,
    scope: CollaborationScope & { threadId?: string },
  ) => {
    const cards: string[] = [];
    const requests: ChannelReplyHostRequest[] = [];
    const blockers: string[] = [];
    for (const pending of ledger.selections.filter(
      (item) => key(item) === key(scope) && item.threadId === scope.threadId,
    )) {
      if (["cancelled", "invalidated", "rejected"].includes(pending.status)) continue;
      const current = await currentSelection(ledger, pending);
      if (!current || pending.expiresAt <= Date.now()) {
        pending.status = "invalidated";
        continue;
      }
      const sent = current.state.group!.deliveries?.[pending.id];
      if (pending.status === "selected") {
        if (
          !sent &&
          !ledger.handoffs.some((item) => item.id === pending.id && key(item) === key(scope))
        )
          requests.push(pending.request);
        else if (sent?.status !== "sent") blockers.push("selection_delivery_unknown");
      } else if (pending.status === "claimed") {
        if (sent?.status !== "sent" && sent?.status !== "invalidated")
          blockers.push("selection_delivery_unknown");
      } else if (!pending.cardClaimed) cards.push(pending.token);
      else if (
        current.state.group!.deliveries?.[SELECTION_CARD_PREFIX + pending.token]?.status !== "sent"
      )
        blockers.push("card_delivery_unknown");
    }
    return { cards, requests, blockers };
  };
  return {
    prepareReply,
    recipientSelection,
    authorizeCard,
    recoverSelections,
    recordReplySent,
  };
}
