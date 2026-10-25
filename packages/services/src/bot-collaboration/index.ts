import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { atomicWritePrivateTextFile, withFileLock } from "@zcode/shared/node";
import {
  collaborationScopeSchema,
  collaborationConfigSchema,
  collaborationSaveSchema,
  collaborationVerificationSchema,
  LOCAL_READONLY_REQUEST_HEADER,
  hasLocalReadOnlyHeader,
  isFeishuBotProvider,
  type BotGroupDelivery,
  type CollaborationScope,
  type CollaborationConfig,
} from "@zcode/shared";
import type { BotCollaborationContract, BotCollaborationPort } from "./contract.js";
import { createReplyRouting, SELECTION_CARD_PREFIX } from "./replyRouting.js";
import { createRecoveryControl, RECOVERY_STATUS_PREFIX } from "./recoveryControl.js";
import { createStopControl, STOP_STATUS_PREFIX } from "./stopControl.js";
import { ledgerSchema, inputSchema, proofSchema, type Ledger } from "./ledger.js";
import { createCollaborationReads } from "./reads.js";
import { collaborationRoleContext } from "./roleContext.js";

export { SELECTION_CARD_PREFIX };

type BotCollaborationService = BotCollaborationContract & {
  recordReplySent(
    scope: CollaborationScope & { botId: string; threadId?: string },
    delivery: BotGroupDelivery,
  ): Promise<void>;
};
function fail(reason: string): never {
  throw new Error(`collaboration.${reason}`);
}

/** 私有配置只有此所有者写入；官网 Repo 不感知 Local 格式。 */
export function createBotCollaboration(port: BotCollaborationPort): BotCollaborationService {
  const read = async (): Promise<Ledger> => {
    try {
      return ledgerSchema.parse(JSON.parse(await readFile(port.file, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return {
          version: 1,
          groups: [],
          admissions: [],
          requirements: [],
          inputs: [],
          handoffs: [],
          stopRequests: [],
          selections: [],
        };
      throw error;
    }
  };
  const write = (ledger: Ledger) =>
    atomicWritePrivateTextFile(port.file, JSON.stringify(ledgerSchema.parse(ledger)));
  const { key, userKey, source, idle, snapshot } = createCollaborationReads(port);
  const enabledConfig = (ledger: Ledger, scope: CollaborationScope) =>
    ledger.groups.find((item) => key(item) === key(scope))?.config;
  const validMember = async (config: CollaborationConfig, botId: string) => {
    const member = [config.pm, ...config.executors].find((item) => item.botId === botId);
    const bot = (await port.readConfig()).bots.find(
      (bot) => bot.id === botId && bot.provider === config.provider,
    );
    const workspace = (await port.listWorkspaces()).some(
      (item) =>
        item.id === config.workspace.id &&
        item.hostId === "local" &&
        !item.workspaceIdentity &&
        item.projectId === config.workspace.projectId &&
        item.workspacePath === config.workspace.workspacePath,
    );
    return member &&
      workspace &&
      bot?.enabled &&
      bot.feishuAppId === member.appId &&
      bot.providerUserId === member.ownerOpenId &&
      port.canUseWorkspace(bot, config.workspace.id)
      ? { member, bot }
      : undefined;
  };
  const connectedTarget = async (config: CollaborationConfig, botId: string, threadId?: string) => {
    const target = await validMember(config, botId);
    if (!target) return undefined;
    const states = (await port.readStates()).filter(
      (state) => state.botId === botId && state.group?.chatId === config.chatId,
    );
    const parent = states.find((state) => !state.group?.threadId);
    const topic = threadId ? states.find((state) => state.group?.threadId === threadId) : undefined;
    return parent?.group?.enabled &&
      parent.group.ownerId === target.member.ownerOpenId &&
      (!topic || (topic.group?.enabled && topic.group.ownerId === target.member.ownerOpenId))
      ? target
      : undefined;
  };
  const incomingHandoff = async (
    ledger: Ledger,
    message: import("@zcode/shared").BotInboundMessage,
    config: CollaborationConfig,
  ) => {
    if (
      message.senderType !== "app" ||
      !message.actor.providerUserId ||
      message.mentionedBot !== true ||
      message.groupCardAction ||
      message.elicitationResponse
    )
      return undefined;
    const states = await port.readStates();
    for (const handoff of ledger.handoffs) {
      if (
        ledger.requirements.some(
          (item) =>
            item.id === handoff.requirementId && (item.stopRequested || item.status === "closed"),
        )
      )
        continue;
      if (
        key(handoff) !== key(config) ||
        handoff.revision !== config.revision ||
        handoff.toBotId !== message.botId ||
        handoff.threadId !== message.actor.threadId
      )
        continue;
      const sender = await validMember(config, handoff.fromBotId);
      // 真实派单在接收端的 sender open_id 与发出端保存的 bot openId 不同。
      // 来源继续由下方原投递 owner 的精确平台消息回执绑定，不能跨应用直接等同 open_id。
      if (!sender) continue;
      if (
        handoff.fromBotId === config.pm.botId &&
        !config.executors.some(
          (member) => member.botId === handoff.toBotId && member.duty === handoff.requiredDuty,
        )
      )
        continue;
      if (
        handoff.fromBotId === config.pm.botId
          ? !config.executors.some((item) => item.botId === handoff.toBotId)
          : handoff.toBotId !== config.pm.botId
      )
        continue;
      const context = states.find(
        (state) =>
          state.botId === handoff.fromBotId &&
          state.group?.chatId === config.chatId &&
          state.group.threadId === handoff.threadId,
      );
      const delivery = context?.group?.deliveries?.[handoff.id];
      const input = context?.group?.inputs?.[handoff.fromInputId];
      // 原生发送者仍不足以代表派单；必须绑定原投递 owner 确认的消息，而非正文自报来源。
      if (
        context?.group?.enabled &&
        context.activeTaskId === handoff.fromTaskId &&
        delivery?.status === "sent" &&
        delivery.providerMessageId === message.actor.providerMessageId &&
        delivery.authorizationId === context.group.authorizationId &&
        delivery.sourceCommandId === handoff.fromInputId &&
        input?.admission === "accepted" &&
        input.taskId === handoff.fromTaskId &&
        !["cancelled", "discarded", "stopped"].includes(input.progress?.status ?? "")
      )
        return handoff;
    }
    return undefined;
  };
  const decision = async (ledger: Ledger, message: import("@zcode/shared").BotInboundMessage) => {
    const config = enabledConfig(ledger, message.actor as CollaborationScope);
    if (!config?.enabled) return "legacy" as const;
    const current = await validMember(config, message.botId);
    if (!current || message.actor.botId !== current.member.botId) return "deny" as const;
    if (message.senderType === "app")
      return (await incomingHandoff(ledger, message, config))
        ? ("allow" as const)
        : ("deny" as const);
    if (
      message.actor.providerUserId !== current.member.ownerOpenId ||
      message.senderUnionId !== config.authorizedUser.unionId ||
      message.tenantKey !== config.authorizedUser.tenantKey
    )
      return "deny" as const;
    return current.member.botId === config.pm.botId ? ("allow" as const) : ("redirect" as const);
  };
  const routing = createReplyRouting({ port, read, write, validMember, connectedTarget });
  const stop = createStopControl({ port, read, write, authorize: decision, validMember });
  const recover = createRecoveryControl({
    port,
    read,
    write,
    validMember,
    recoverSelections: routing.recoverSelections,
  });
  const service: BotCollaborationService = {
    async control(command) {
      if (command.kind === "recover") return recover(command.scope, command.notify);
      const state = await stop(command.message);
      return state ? { kind: "stop", state } : undefined;
    },
    async authorize(message) {
      if (
        message.actor.chatType !== "group" ||
        !message.actor.chatId ||
        !isFeishuBotProvider(message.actor.provider)
      )
        return "legacy";
      return withFileLock(port.file, async () => {
        const outcome = await decision(await read(), message);
        if (outcome !== "legacy")
          port.diagnose?.({
            provider: message.actor.provider as "feishu" | "lark",
            chatId: message.actor.chatId!,
            botId: message.botId,
            action: "admission",
            outcome,
          });
        return outcome;
      });
    },
    async bindInput(message, execution) {
      if (
        message.actor.chatType !== "group" ||
        !message.actor.chatId ||
        !isFeishuBotProvider(message.actor.provider)
      )
        return undefined;
      return withFileLock(port.file, async () => {
        const ledger = await read();
        const scope = {
          provider: message.actor.provider as "feishu" | "lark",
          chatId: message.actor.chatId!,
        };
        const config = enabledConfig(ledger, scope);
        if (!config?.enabled) return undefined;
        if ((await decision(ledger, message)) !== "allow") fail("unauthorized");
        const prior = ledger.inputs.findLast(
          (item) =>
            key(item) === key(scope) &&
            item.botId === message.botId &&
            item.taskId === execution.taskId &&
            item.revision === config.revision,
        );
        const replay = ledger.inputs.find(
          (item) =>
            key(item) === key(scope) &&
            item.botId === message.botId &&
            item.inputId === execution.inputId,
        );
        if (
          replay &&
          ledger.requirements.some((item) => item.id === replay.requirementId && item.stopRequested)
        )
          fail("stopped");
        const priorRequirement = ledger.requirements.find(
          (item) => item.id === prior?.requirementId,
        );
        if (
          message.senderType !== "app" &&
          priorRequirement?.stopRequested &&
          !priorRequirement.stopConfirmed
        )
          fail("stopping");
        const handoff = await incomingHandoff(ledger, message, config);
        const command = (message.commandText ?? message.text).trim();
        // 原 Provider 对真人省略 senderType；decision 已核对授权用户的 union/tenant，不能因此漏掉只读命令。
        const explicitReadOnly =
          message.senderType !== "app" &&
          message.botId === config.pm.botId &&
          hasLocalReadOnlyHeader(command);
        // 活跃话题允许无 @ 的真人后续消息；新验收命令仍须在 owner 核对原生唤醒，不能借旧话题授权启用。
        if (explicitReadOnly && message.mentionedBot !== true)
          fail("readonly_native_mention_required");
        if (
          explicitReadOnly &&
          !/^\r?\n\s*\S/u.test(command.slice(LOCAL_READONLY_REQUEST_HEADER.length))
        )
          fail("readonly_invalid_command");
        // 显式命令创建独立新需求，不能把旧需求的活动状态当作空闲或重放许可。
        if (explicitReadOnly && !replay) {
          const admissions = ledger.admissions.filter((entry) => key(entry) === key(scope));
          // 只承认当前唯一接收调用；同 PID/消息的遗留令牌也可能是未知旧工作，不能自动抢占。
          if (
            admissions.length !== 1 ||
            admissions[0]!.ownerPid !== process.pid ||
            admissions[0]!.botId !== message.botId ||
            admissions[0]!.messageId !== message.actor.providerMessageId ||
            !(await port.isIdle(scope, config, {
              botId: message.botId,
              messageId: message.actor.providerMessageId,
              senderId: message.actor.providerUserId,
            }))
          )
            fail("readonly_busy");
        }
        const requirementId =
          replay?.requirementId ??
          handoff?.requirementId ??
          (explicitReadOnly ||
          priorRequirement?.stopRequested ||
          priorRequirement?.status === "closed"
            ? undefined
            : prior?.requirementId) ??
          createHash("sha256")
            .update(JSON.stringify([scope.provider, scope.chatId, message.actor.providerMessageId]))
            .digest("hex");
        if (priorRequirement?.stopConfirmed && requirementId !== priorRequirement.id) {
          const oldInputs = ledger.inputs.filter(
            (item) =>
              item.requirementId === priorRequirement.id &&
              item.botId === message.botId &&
              item.taskId === execution.taskId,
          );
          if (
            !(await port.resumeTask?.({
              ...scope,
              botId: message.botId,
              threadId: message.actor.threadId,
              taskId: execution.taskId,
              workspacePath: execution.workspacePath,
              ...(execution.workspaceIdentity
                ? { workspaceIdentity: execution.workspaceIdentity }
                : {}),
              inputIds: oldInputs.map((item) => item.inputId),
            }))
          )
            fail("stop_unavailable");
        }
        if (!ledger.requirements.some((item) => item.id === requirementId))
          ledger.requirements.push({
            ...scope,
            id: requirementId,
            revision: config.revision,
            ...config.authorizedUser,
            name: message.actor.displayName ?? "Original user",
            ...(explicitReadOnly ? { readOnly: true as const } : {}),
            status: "active",
            stageDeliveries: [],
          });
        // 两端先按同一 schema 规范字段顺序；JSON 持久化重读后不能因顺序误判重放。
        const input = inputSchema.parse({
          ...scope,
          ...execution,
          botId: message.botId,
          // 原 Provider 对真人省略类型，须在上方 owner/union/tenant 授权后明确保存，供 accept 核对。
          // 13 以前的缺字段记录也可能来自机器人；重放保留旧缺省，不回填或授予验收权限。
          senderType:
            message.senderType ?? (replay && replay.senderType === undefined ? undefined : "user"),
          requirementId,
          revision: config.revision,
        });
        const previous = ledger.inputs.find(
          (item) =>
            key(item) === key(scope) &&
            item.botId === message.botId &&
            item.inputId === execution.inputId,
        );
        if (previous && JSON.stringify(previous) !== JSON.stringify(input)) fail("stale");
        if (!previous) ledger.inputs.push(input);
        for (const admission of ledger.admissions) {
          if (
            key(admission) === key(scope) &&
            admission.ownerPid === process.pid &&
            admission.botId === message.botId &&
            admission.messageId === message.actor.providerMessageId &&
            admission.revision === config.revision
          )
            admission.inputId = execution.inputId;
        }
        await write(ledger);
        port.diagnose?.({
          ...scope,
          botId: message.botId,
          action: "input",
          outcome: "linked",
          inputId: execution.inputId,
          requirementId,
          revision: config.revision,
        });
        const bots = await port.readConfig();
        const role = message.botId === config.pm.botId ? "PM" : "executor";
        const requirement = ledger.requirements.find((item) => item.id === requirementId)!;
        return {
          turn: { requirementId, role, readOnly: requirement.readOnly === true },
          context: collaborationRoleContext({
            role,
            requirement: ledger.requirements.find((item) => item.id === requirementId)!,
            participants: [config.pm, ...config.executors].map((member) => ({
              botId: member.botId,
              name: bots.bots.find((bot) => bot.id === member.botId)?.name,
              duty: "duty" in member ? String(member.duty) : "PM",
            })),
          }),
        };
      });
    },
    prepareReply: routing.prepareReply,
    recipientSelection: routing.recipientSelection,
    recordReplySent: routing.recordReplySent,
    async authorizeDelivery(scope, delivery) {
      return withFileLock(port.file, async () => {
        const ledger = await read();
        const config = enabledConfig(ledger, scope);
        const input = ledger.inputs.find(
          (item) =>
            key(item) === key(scope) &&
            item.botId === scope.botId &&
            item.inputId === delivery.sourceCommandId &&
            item.taskId === delivery.taskId,
        );
        if (!input && !config?.enabled) return true;
        if (!config?.enabled || !input || input.revision !== config.revision) return false;
        const current = await validMember(config, scope.botId);
        const original = ledger.requirements.find(
          (item) =>
            item.id === input.requirementId &&
            item.revision === config.revision &&
            item.unionId === config.authorizedUser.unionId &&
            item.tenantKey === config.authorizedUser.tenantKey,
        );
        if (!current || !original) return false;
        if (delivery.id.startsWith(RECOVERY_STATUS_PREFIX))
          return (
            scope.botId === config.pm.botId &&
            Boolean(input.recoveryNoticeIds?.includes(delivery.id)) &&
            delivery.mentionedUserIds?.length === 1 &&
            delivery.mentionedUserIds[0] === current.member.ownerOpenId
          );
        if (delivery.id.startsWith(STOP_STATUS_PREFIX))
          return (
            scope.botId === config.pm.botId &&
            Boolean(
              ledger.stopRequests.find(
                (item) =>
                  item.deliveryIds.includes(delivery.id) &&
                  item.requirementId === original.id &&
                  item.revision === config.revision &&
                  item.botId === scope.botId &&
                  item.threadId === scope.threadId &&
                  item.taskId === delivery.taskId &&
                  item.inputId === delivery.sourceCommandId &&
                  item.authorizationId === delivery.authorizationId &&
                  item.ownerId === current.member.ownerOpenId &&
                  delivery.mentionedUserIds?.length === 1 &&
                  delivery.mentionedUserIds[0] === item.ownerId,
              ),
            )
          );
        if (original.stopRequested) return false;
        if (delivery.id.startsWith(SELECTION_CARD_PREFIX))
          return routing.authorizeCard(ledger, scope, delivery);
        if (!delivery.channelReplyRequestHash) return true;
        const mentions =
          delivery.contentParts?.filter((part) => part.type === "channelMention") ?? [];
        if (mentions.length !== 1) return false;
        const mention = mentions[0]!;
        if (mention.channel !== scope.provider || mention.idType !== "open_id") return false;
        if (mention.entityType === "user")
          return scope.botId === config.pm.botId && mention.targetId === current.member.ownerOpenId;
        const handoff = ledger.handoffs.find(
          (item) =>
            item.id === delivery.id &&
            key(item) === key(scope) &&
            item.fromBotId === scope.botId &&
            item.fromTaskId === delivery.taskId &&
            item.fromInputId === delivery.sourceCommandId &&
            item.requirementId === original.id &&
            item.revision === config.revision &&
            item.threadId === scope.threadId,
        );
        if (!handoff) return false;
        const direction =
          scope.botId === config.pm.botId
            ? config.executors.some((item) => item.botId === handoff.toBotId)
            : handoff.toBotId === config.pm.botId;
        const target = direction
          ? await connectedTarget(config, handoff.toBotId, scope.threadId)
          : undefined;
        return Boolean(
          target &&
          mention.targetId === target.member.openId &&
          (scope.botId !== config.pm.botId ||
            ("duty" in target.member && handoff.requiredDuty === target.member.duty)),
        );
      });
    },
    async inputOrigin(scope, inputId, taskId) {
      return withFileLock(port.file, async () => {
        const ledger = await read();
        const config = enabledConfig(ledger, scope);
        if (!config?.enabled) return undefined;
        const current = await validMember(config, scope.botId);
        const input = ledger.inputs.find(
          (item) =>
            key(item) === key(scope) &&
            item.botId === scope.botId &&
            item.inputId === inputId &&
            item.taskId === taskId &&
            item.revision === config.revision,
        );
        if (
          !current ||
          !input ||
          !ledger.requirements.some((item) => item.id === input.requirementId)
        )
          return undefined;
        return {
          initiatorId: current.member.ownerOpenId,
          mentionedUserIds: scope.botId === config.pm.botId ? [current.member.ownerOpenId] : [],
          silent:
            input.replyIntent === "silent" ||
            input.replyIntent === "selection" ||
            ledger.requirements.some(
              (item) => item.id === input.requirementId && item.stopRequested,
            ),
        };
      });
    },
    readSettings: (query) =>
      withFileLock(port.file, async () =>
        query.kind === "binding"
          ? {
              kind: "binding" as const,
              binding: (await read()).groups.find(
                (item) => key(item) === key(collaborationScopeSchema.parse(query.scope)),
              )?.config,
            }
          : { kind: "snapshot" as const, snapshot: await snapshot(await read()) },
      ),
    async beginVerification(request) {
      const input = collaborationVerificationSchema.parse(request);
      return withFileLock(port.file, async () => {
        const ledger = await read();
        const current = await source(ledger);
        if (!current.groups.has(key(input))) fail("groupUnavailable");
        const bot = current.config.bots.find(
          (bot) =>
            bot.id === input.botId &&
            bot.provider === input.provider &&
            bot.enabled &&
            bot.feishuAppId &&
            bot.providerUserId,
        );
        if (!bot) fail("identityUnavailable");
        let group = ledger.groups.find((item) => key(item) === key(input));
        if (!group) {
          group = {
            provider: input.provider,
            chatId: input.chatId,
            identities: [],
            challenges: [],
          };
          ledger.groups.push(group);
        }
        const challenge = {
          botId: bot.id,
          appId: bot.feishuAppId!,
          ownerId: bot.providerUserId!,
          nonce: randomUUID(),
          expiresAt: Date.now() + 10 * 60_000,
        };
        group.challenges = [
          ...group.challenges.filter(
            (item) => item.botId !== bot.id && item.expiresAt > Date.now(),
          ),
          challenge,
        ];
        await write(ledger);
        return {
          command: `/collaboration-verify ${challenge.nonce}`,
          expiresAt: challenge.expiresAt,
        };
      });
    },
    async observeInbound(message) {
      if (
        message.actor.chatType !== "group" ||
        !message.actor.chatId ||
        !isFeishuBotProvider(message.actor.provider)
      )
        return null;
      const command = message.commandText ?? message.text;
      const verifying = /^\/collaboration-verify(?:\s|$)/.test(command);
      return withFileLock(port.file, async () => {
        const scope = {
          provider: message.actor.provider as "feishu" | "lark",
          chatId: message.actor.chatId!,
        };
        const ledger = await read();
        const current = await source(ledger);
        const bot = current.config.bots.find(
          (bot) =>
            bot.id === message.botId &&
            bot.id === message.actor.botId &&
            bot.provider === scope.provider,
        );
        if (
          !current.groups.has(key(scope)) ||
          !bot?.enabled ||
          !bot.feishuAppId ||
          !bot.providerUserId
        )
          return verifying ? { kind: "rejected" } : null;
        let group = ledger.groups.find((item) => key(item) === key(scope));
        const challenge = group?.challenges.find(
          (item) =>
            item.botId === bot.id &&
            item.appId === bot.feishuAppId &&
            item.ownerId === bot.providerUserId &&
            item.expiresAt > Date.now() &&
            command.trim() === `/collaboration-verify ${item.nonce}`,
        );
        const valid =
          message.senderType !== "app" &&
          message.mentionedBot === true &&
          message.actor.providerUserId === bot.providerUserId &&
          /^ou_[\w-]+$/.test(message.botOpenId ?? "") &&
          /^on_[\w-]+$/.test(message.senderUnionId ?? "") &&
          Boolean(message.tenantKey);
        if (!valid || (verifying && !challenge)) return verifying ? { kind: "rejected" } : null;
        if (!group) {
          group = { ...scope, identities: [], challenges: [] };
          ledger.groups.push(group);
        }
        const proof = proofSchema.parse({
          botId: bot.id,
          appId: bot.feishuAppId,
          openId: message.botOpenId,
          ownerOpenId: bot.providerUserId,
          unionId: message.senderUnionId,
          tenantKey: message.tenantKey,
          name: message.actor.displayName || "Bound user",
        });
        group.identities = [...group.identities.filter((item) => item.botId !== bot.id), proof];
        if (verifying) group.challenges = group.challenges.filter((item) => item !== challenge);
        await write(ledger);
        return verifying ? { kind: "verified" } : null;
      });
    },
    async save(request) {
      const input = collaborationSaveSchema.parse(request);
      return withFileLock(port.file, async () => {
        const ledger = await read();
        const group = ledger.groups.find((item) => key(item) === key(input));
        const current = await source(ledger);
        if (!current.groups.has(key(input))) fail("groupUnavailable");
        if (!group) fail("identityUnavailable");
        const previous = group.config;
        if ((previous?.revision ?? 0) !== input.expectedRevision) fail("stale");
        if (previous?.enabled && !input.enabled) {
          if (!(await idle(ledger, input, previous))) fail("busy");
          // 撤销不授予任何新权限，故不要求已经失效的成员/项目恢复，也不采纳请求中的其他字段。
          group.config = { ...previous, enabled: false, revision: previous.revision + 1 };
          await write(ledger);
          return snapshot(ledger);
        }
        const ids = [input.pmBotId, ...input.executors.map((item) => item.botId)];
        if (new Set(ids).size !== ids.length) fail("duplicateRole");
        const identity = (botId: string) => {
          const bot = current.config.bots.find(
            (bot) => bot.id === botId && bot.provider === input.provider && bot.enabled,
          );
          const proof = group.identities.find(
            (proof) =>
              proof.botId === botId &&
              proof.appId === bot?.feishuAppId &&
              proof.ownerOpenId === bot?.providerUserId,
          );
          if (
            !bot ||
            !proof ||
            (input.enabled && !current.connected(botId, input)) ||
            userKey(proof) !== input.authorizedUserId ||
            !port.canUseWorkspace(bot, input.workspaceId)
          )
            fail("identityUnavailable");
          return {
            botId: proof.botId,
            appId: proof.appId,
            openId: proof.openId,
            ownerOpenId: proof.ownerOpenId,
          };
        };
        const workspace = current.workspaces.find((item) => item.id === input.workspaceId);
        if (!workspace) fail("workspaceUnavailable");
        const user = group.identities.find((proof) => userKey(proof) === input.authorizedUserId);
        if (!user) fail("identityUnavailable");
        const next = collaborationConfigSchema.parse({
          provider: input.provider,
          chatId: input.chatId,
          enabled: input.enabled,
          revision: previous?.revision ?? 1,
          pm: identity(input.pmBotId),
          executors: input.executors.map((item) => ({ ...identity(item.botId), duty: item.duty })),
          authorizedUser: { unionId: user.unionId, tenantKey: user.tenantKey },
          workspace,
        });
        if (
          new Set([next.pm.appId, ...next.executors.map((member) => member.appId)]).size !==
          ids.length
        )
          fail("duplicateRole");
        if (previous && JSON.stringify(previous) === JSON.stringify(next)) return snapshot(ledger);
        if (!(await idle(ledger, input, previous))) fail("busy");
        group.config = { ...next, revision: (previous?.revision ?? 0) + 1 };
        group.name = current.groups.get(key(input))!.name;
        await write(ledger);
        return snapshot(ledger);
      });
    },
    async withInbound(message, receive) {
      if (!("actor" in message))
        return withFileLock(port.file, async () => {
          const ledger = await read();
          const input = ledger.inputs.find((item) => item.inputId === message.inputId);
          if (
            !input ||
            ledger.requirements.some(
              (item) => item.id === input.requirementId && item.stopRequested,
            )
          )
            fail("stopped");
          return receive();
        });
      if (
        message.actor.chatType !== "group" ||
        !message.actor.chatId ||
        !isFeishuBotProvider(message.actor.provider)
      )
        return receive();
      const scope = { provider: message.actor.provider, chatId: message.actor.chatId };
      const admission = {
        ...scope,
        id: randomUUID(),
        ownerPid: process.pid,
        botId: message.botId,
        messageId: message.actor.providerMessageId,
        threadId: message.actor.threadId,
        revision: undefined as number | undefined,
      };
      await withFileLock(port.file, async () => {
        const ledger = await read();
        admission.revision = enabledConfig(ledger, scope)?.revision;
        ledger.admissions.push(admission);
        await write(ledger);
      });
      try {
        return await receive();
      } finally {
        await withFileLock(port.file, async () => {
          const ledger = await read();
          ledger.admissions = ledger.admissions.filter((item) => item.id !== admission.id);
          await write(ledger);
        });
      }
    },
  };
  return service;
}
