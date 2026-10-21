import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { atomicWritePrivateTextFile, withFileLock } from "@zcode/shared/node";
import {
  collaborationScopeSchema,
  collaborationConfigSchema,
  collaborationSaveSchema,
  collaborationSnapshotSchema,
  collaborationVerificationSchema,
  collaborationUserId,
  isFeishuBotProvider,
  type CollaborationScope,
  type CollaborationConfig,
} from "@zcode/shared";
import type { BotCollaborationContract, BotCollaborationPort } from "./contract.js";

const proofSchema = z
  .object({
    botId: z.string(),
    appId: z.string(),
    openId: z.string().regex(/^ou_[\w-]+$/),
    ownerOpenId: z.string(),
    unionId: z.string().regex(/^on_[\w-]+$/),
    tenantKey: z.string().min(1),
    name: z.string().min(1),
  })
  .strict();
const challengeSchema = z
  .object({
    botId: z.string(),
    appId: z.string(),
    ownerId: z.string(),
    nonce: z.string(),
    expiresAt: z.number(),
  })
  .strict();
const groupSchema = collaborationScopeSchema
  .extend({
    config: collaborationConfigSchema.optional(),
    identities: z.array(proofSchema),
    challenges: z.array(challengeSchema),
  })
  .strict();
const ledgerSchema = z
  .object({
    version: z.literal(1),
    groups: z.array(groupSchema).max(400),
    admissions: z
      .array(
        collaborationScopeSchema
          .extend({ id: z.string(), ownerPid: z.number().int().positive() })
          .strict(),
      )
      .default([]),
  })
  .strict();
type Ledger = z.infer<typeof ledgerSchema>;
const key = (scope: CollaborationScope) => JSON.stringify([scope.provider, scope.chatId]);
const userKey = collaborationUserId;
function fail(reason: string): never {
  throw new Error(`collaboration.${reason}`);
}

/** 私有配置只有此所有者写入；官网 Repo 不感知 Local 格式。 */
export function createBotCollaboration(port: BotCollaborationPort): BotCollaborationContract {
  const read = async (): Promise<Ledger> => {
    try {
      return ledgerSchema.parse(JSON.parse(await readFile(port.file, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { version: 1, groups: [], admissions: [] };
      throw error;
    }
  };
  const write = (ledger: Ledger) =>
    atomicWritePrivateTextFile(port.file, JSON.stringify(ledgerSchema.parse(ledger)));
  const source = async () => {
    const config = await port.readConfig();
    const states = await port.readStates();
    const groups = new Map<string, CollaborationScope & { name: string }>();
    for (const state of states) {
      const bot = config.bots.find((item) => item.id === state.botId);
      if (
        bot &&
        isFeishuBotProvider(bot.provider) &&
        state.group &&
        !state.group.threadId &&
        state.group.ownerId === bot.providerUserId
      ) {
        const scope = { provider: bot.provider, chatId: state.group.chatId };
        groups.set(key(scope), { ...scope, name: state.group.name });
      }
    }
    const workspaces = (await port.listWorkspaces())
      .filter(
        (item) =>
          item.hostId === "local" &&
          item.projectId &&
          item.workspacePath &&
          !item.workspaceIdentity,
      )
      .map(({ id, label, projectId, workspacePath }) => ({
        id,
        label,
        projectId: projectId!,
        workspacePath,
        hostId: "local" as const,
      }));
    const connected = (botId: string, scope: CollaborationScope) =>
      states.some(
        (state) =>
          state.botId === botId &&
          state.group?.chatId === scope.chatId &&
          !state.group.threadId &&
          state.group.enabled &&
          state.group.ownerId ===
            config.bots.find((bot) => bot.id === botId && bot.provider === scope.provider)
              ?.providerUserId,
      );
    return { config, groups, workspaces, connected };
  };
  const idle = async (ledger: Ledger, scope: CollaborationScope, current?: CollaborationConfig) => {
    if (ledger.admissions.some((admission) => key(admission) === key(scope))) return false;
    try {
      return await port.isIdle(scope, current);
    } catch {
      // 运行时断线或查询失败不能变成“空闲”，保留原授权并让界面明确显示未确认。
      return false;
    }
  };
  const snapshot = async (ledger: Ledger) => {
    const current = await source();
    return collaborationSnapshotSchema.parse({
      groups: await Promise.all(
        [...current.groups.values()].map(async (group) => {
          const saved = ledger.groups.find((item) => key(item) === key(group));
          const candidates = current.config.bots.filter(
            (bot) =>
              bot.provider === group.provider &&
              bot.enabled &&
              bot.providerUserId &&
              bot.feishuAppId,
          );
          const proofs = (saved?.identities ?? []).filter((proof) =>
            candidates.some(
              (bot) =>
                bot.id === proof.botId &&
                bot.feishuAppId === proof.appId &&
                bot.providerUserId === proof.ownerOpenId,
            ),
          );
          return {
            ...group,
            config: saved?.config ?? null,
            busy: !(await idle(ledger, group, saved?.config)),
            bots: candidates.map((bot) => ({
              id: bot.id,
              name: bot.name,
              verified: proofs.some((proof) => proof.botId === bot.id),
              connected: current.connected(bot.id, group),
            })),
            users: [
              ...new Map(
                proofs.map((proof) => [userKey(proof), { id: userKey(proof), name: proof.name }]),
              ).values(),
            ],
            workspaces: current.workspaces,
          };
        }),
      ),
    });
  };
  const service: BotCollaborationContract = {
    getSettings: () => withFileLock(port.file, async () => snapshot(await read())),
    readBinding: (scope) =>
      withFileLock(
        port.file,
        async () =>
          (await read()).groups.find(
            (item) => key(item) === key(collaborationScopeSchema.parse(scope)),
          )?.config,
      ),
    async beginVerification(request) {
      const input = collaborationVerificationSchema.parse(request);
      return withFileLock(port.file, async () => {
        const current = await source();
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
        const ledger = await read();
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
        const current = await source();
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
        const ledger = await read();
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
        const current = await source();
        if (!current.groups.has(key(input))) fail("groupUnavailable");
        const ledger = await read();
        const group = ledger.groups.find((item) => key(item) === key(input));
        if (!group) fail("identityUnavailable");
        const previous = group.config;
        if ((previous?.revision ?? 0) !== input.expectedRevision) fail("stale");
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
        await write(ledger);
        return snapshot(ledger);
      });
    },
    async withInbound(message, receive) {
      if (
        message.actor.chatType !== "group" ||
        !message.actor.chatId ||
        !isFeishuBotProvider(message.actor.provider)
      )
        return receive();
      const scope = { provider: message.actor.provider, chatId: message.actor.chatId };
      const admission = { ...scope, id: randomUUID(), ownerPid: process.pid };
      await withFileLock(port.file, async () => {
        const ledger = await read();
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
