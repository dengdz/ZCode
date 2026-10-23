import {
  collaborationSnapshotSchema,
  collaborationUserId,
  isFeishuBotProvider,
  type CollaborationConfig,
  type CollaborationScope,
} from "@zcode/shared";
import type { BotCollaborationPort } from "./contract.js";
import type { Ledger } from "./ledger.js";

export function createCollaborationReads(port: BotCollaborationPort) {
  const key = (scope: CollaborationScope) => JSON.stringify([scope.provider, scope.chatId]);
  const userKey = collaborationUserId;
  const source = async (ledger: Ledger) => {
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
    // 已经授权的群即使成员全部移除也必须保留撤销入口，不能依赖当前候选仍存在。
    for (const saved of ledger.groups) {
      if (saved.config && !groups.has(key(saved)))
        groups.set(key(saved), {
          provider: saved.provider,
          chatId: saved.chatId,
          name: saved.name ?? saved.chatId,
        });
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
    const current = await source(ledger);
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
  return { key, userKey, source, idle, snapshot };
}
