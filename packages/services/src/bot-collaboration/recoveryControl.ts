import { createHash } from "node:crypto";
import { STOP_STATUS_PREFIX } from "./stopControl.js";
import { withFileLock } from "@zcode/shared/node";
import type { CollaborationConfig, CollaborationScope } from "@zcode/shared";
import type { BotCollaborationPort, CollaborationStopTarget } from "./port.js";
import type { CollaborationRecovery } from "./contract.js";
import type { Ledger } from "./ledger.js";

export const RECOVERY_STATUS_PREFIX = "local-recovery-status:";
interface Dependencies {
  port: BotCollaborationPort;
  read(): Promise<Ledger>;
  write(ledger: Ledger): Promise<void>;
  validMember(config: CollaborationConfig, botId: string): Promise<unknown>;
  recoverSelections(
    ledger: Ledger,
    scope: CollaborationScope & { threadId?: string },
  ): Promise<Pick<CollaborationRecovery, "cards" | "requests" | "blockers">>;
}
/** 恢复只核对原 owner 事实；不保存运行状态，也不提交输入。 */
export function createRecoveryControl({
  port,
  read,
  write,
  validMember,
  recoverSelections,
}: Dependencies) {
  return async (
    scope: CollaborationScope & { threadId?: string },
    notify = false,
  ): Promise<CollaborationRecovery | undefined> => {
    let notice: Parameters<NonNullable<BotCollaborationPort["publishRecovery"]>>[0] | undefined;
    const recovery = await withFileLock(
      port.file,
      async (): Promise<CollaborationRecovery | undefined> => {
        const ledger = await read();
        const config = ledger.groups.find(
          (item) => item.provider === scope.provider && item.chatId === scope.chatId,
        )?.config;
        if (!config?.enabled) return undefined;
        const states = await port.readStates();
        const blockers = new Set<string>();
        const targets = new Map<string, CollaborationStopTarget & { requirementId: string }>();
        const requirements = new Map<string, Ledger["requirements"][number]>();
        const unresolved = new Set<string>();
        const stoppedInputIds: string[] = [];
        let newlyStopped = false;
        const confirmedInputs = new Set<string>();
        for (const input of ledger.inputs.filter(
          (item) =>
            item.provider === scope.provider &&
            item.chatId === scope.chatId &&
            item.revision === config.revision,
        )) {
          const matches = states.filter(
            (state) =>
              state.botId === input.botId &&
              state.group?.chatId === scope.chatId &&
              state.group.inputs?.[input.inputId]?.taskId === input.taskId,
          );
          if (matches.length !== 1) {
            blockers.add("input_binding_unknown");
            unresolved.add(input.requirementId);
            continue;
          }
          const context = matches[0]!;
          if (context.group!.threadId !== scope.threadId) continue;
          const requirement = ledger.requirements.find((item) => item.id === input.requirementId);
          if (!requirement) {
            blockers.add("requirement_unknown");
            continue;
          }
          requirements.set(requirement.id, requirement);
          if (requirement.stopRequested) stoppedInputIds.push(input.inputId);
          if (requirement.stopConfirmed) continue;
          const native = context.group!.inputs![input.inputId]!;
          const workspace = context.group!.taskWorkspaces?.[input.taskId] ?? context;
          if (
            !context.group!.enabled ||
            native.source.authorizationId !== context.group!.authorizationId ||
            (workspace.workspaceIdentity?.trim() || workspace.workspacePath) !==
              (input.workspaceIdentity?.trim() || input.workspacePath) ||
            !(await validMember(config, input.botId))
          ) {
            blockers.add("input_binding_unknown");
            unresolved.add(input.requirementId);
            continue;
          }
          const id = JSON.stringify([
            input.requirementId,
            input.botId,
            input.taskId,
            input.workspaceIdentity?.trim() || input.workspacePath,
          ]);
          const target = targets.get(id) ?? {
            requirementId: input.requirementId,
            ...scope,
            botId: input.botId,
            taskId: input.taskId,
            workspacePath: input.workspacePath,
            ...(input.workspaceIdentity ? { workspaceIdentity: input.workspaceIdentity } : {}),
            inputIds: [],
          };
          target.inputIds.push(input.inputId);
          targets.set(id, target);
        }
        for (const target of targets.values()) {
          if (requirements.get(target.requirementId)?.stopRequested) continue;
          try {
            const evidence = await port.readTask?.(target);
            if (!evidence || evidence.ownedWork === "unknown") {
              blockers.add("runtime_unknown");
              continue;
            }
            const state = (await port.readStates()).find(
              (item) =>
                item.botId === target.botId &&
                item.group?.chatId === scope.chatId &&
                item.group.threadId === scope.threadId,
            );
            for (const inputId of target.inputIds) {
              const native = state?.group?.inputs?.[inputId];
              if (!native || native.admission === "pending")
                blockers.add("input_admission_unknown");
              else if (native.admission === "accepted") confirmedInputs.add(inputId);
            }
          } catch {
            blockers.add("runtime_unknown");
          }
        }
        for (const requirement of requirements.values()) {
          if (!requirement.stopRequested || requirement.stopConfirmed) continue;
          const originalTargets = [...targets.values()]
            .filter((item) => item.requirementId === requirement.id)
            .map(({ requirementId: _id, ...target }) => target);
          let state = "unavailable";
          try {
            if (originalTargets.length)
              state = (await port.stopTasks?.(originalTargets)) ?? "unavailable";
          } catch {
            /* 同一旧停止保持未确认，不能恢复队列。 */
          }
          if (state === "stopped" && !unresolved.has(requirement.id)) {
            requirement.stopConfirmed = true;
            newlyStopped = true;
          } else blockers.add(state === "stopping" ? "stop_pending" : "stop_unknown");
        }
        for (const context of states.filter(
          (item) => item.group?.chatId === scope.chatId && item.group.threadId === scope.threadId,
        )) {
          const member = [config.pm, ...config.executors].find(
            (item) => item.botId === context.botId,
          );
          if (!member) continue;
          for (const delivery of Object.values(context.group!.deliveries ?? {})) {
            if (
              delivery.id.startsWith(STOP_STATUS_PREFIX) ||
              delivery.id.startsWith(RECOVERY_STATUS_PREFIX)
            )
              continue;
            if (delivery.status !== "unknown" && delivery.status !== "pending") continue;
            const linked = ledger.inputs.find(
              (item) =>
                item.botId === context.botId &&
                item.inputId === delivery.sourceCommandId &&
                item.taskId === delivery.taskId &&
                item.provider === scope.provider &&
                item.chatId === scope.chatId &&
                item.revision === config.revision,
            );
            if (!linked || context.group!.authorizationId !== delivery.authorizationId) continue;
            try {
              if (
                delivery.status !== "unknown" ||
                !delivery.providerMessageId ||
                (await port.confirmDelivery?.(
                  { ...scope, botId: context.botId, senderId: member.openId },
                  delivery,
                )) !== "sent"
              )
                blockers.add("delivery_unknown");
            } catch {
              blockers.add("delivery_unknown");
            }
          }
        }
        const freshStates = await port.readStates();
        const released = new Set<string>();
        for (const admission of ledger.admissions.filter(
          (item) =>
            item.provider === scope.provider &&
            item.chatId === scope.chatId &&
            (!item.botId || item.threadId === scope.threadId),
        )) {
          const alive = await port.isAdmissionOwnerAlive?.(admission.ownerPid);
          if (alive === true) continue;
          if (alive !== false) {
            blockers.add("admission_owner_unknown");
            continue;
          }
          const linked = ledger.inputs.find(
            (item) =>
              item.provider === scope.provider &&
              item.chatId === scope.chatId &&
              item.botId === admission.botId &&
              item.inputId === admission.inputId &&
              item.revision === admission.revision,
          );
          const native =
            linked &&
            freshStates.find(
              (state) =>
                state.botId === linked.botId &&
                state.group?.chatId === scope.chatId &&
                state.group.threadId === scope.threadId,
            )?.group?.inputs?.[linked.inputId];
          const stopped =
            linked &&
            ledger.requirements.some(
              (item) => item.id === linked.requirementId && item.stopConfirmed,
            );
          // 进程退出只证明协调调用不再持锁；仍须有原受理或停止事实，绝不能据此释放执行租约。
          if (
            linked &&
            native?.taskId === linked.taskId &&
            native.source.messageId === admission.messageId &&
            native.admission === "accepted" &&
            (confirmedInputs.has(linked.inputId) || stopped)
          )
            released.add(admission.id);
          else blockers.add("admission_unknown");
        }
        if (released.size)
          ledger.admissions = ledger.admissions.filter((item) => !released.has(item.id));
        const selection = await recoverSelections(ledger, scope);
        for (const blocker of selection.blockers) blockers.add(blocker);
        const state =
          blockers.size === 1 && blockers.has("stop_pending")
            ? "stopping"
            : blockers.size
              ? "unknown"
              : "ready";
        if (notify && (state !== "ready" || newlyStopped)) {
          const context = freshStates.find(
            (item) =>
              item.botId === config.pm.botId &&
              item.group?.enabled &&
              item.group.chatId === scope.chatId &&
              item.group.threadId === scope.threadId &&
              item.group.ownerId === config.pm.ownerOpenId,
          );
          const input =
            context &&
            ledger.inputs.findLast(
              (item) =>
                item.provider === scope.provider &&
                item.chatId === scope.chatId &&
                item.botId === context.botId &&
                item.taskId === context.activeTaskId &&
                item.revision === config.revision,
            );
          const native = input && context?.group?.inputs?.[input.inputId];
          const requirement = input && requirements.get(input.requirementId);
          if (
            input &&
            native &&
            context?.group &&
            requirement?.unionId === config.authorizedUser.unionId &&
            requirement.tenantKey === config.authorizedUser.tenantKey &&
            native.source.senderId === config.pm.ownerOpenId &&
            native.source.botId === config.pm.botId &&
            native.source.provider === scope.provider &&
            native.source.appId === config.pm.appId &&
            native.source.chatId === scope.chatId &&
            native.source.threadId === scope.threadId &&
            native.source.authorizationId === context.group.authorizationId &&
            (await validMember(config, config.pm.botId))
          ) {
            const noticeState = state === "ready" ? "stopped" : state;
            const deliveryId =
              RECOVERY_STATUS_PREFIX +
              createHash("sha256")
                .update(
                  JSON.stringify([
                    scope,
                    config.revision,
                    input.taskId,
                    input.inputId,
                    context.group.authorizationId,
                    noticeState,
                  ]),
                )
                .digest("hex");
            if (!input.recoveryNoticeIds?.includes(deliveryId)) {
              (input.recoveryNoticeIds ??= []).push(deliveryId);
              notice = {
                ...scope,
                botId: config.pm.botId,
                taskId: input.taskId,
                inputId: input.inputId,
                authorizationId: context.group.authorizationId!,
                messageId: native.source.messageId,
                ownerId: config.pm.ownerOpenId,
                deliveryId,
                state: noticeState,
              };
            }
          }
        }
        // 领取先于外部发送；崩溃或收据不明不重新领取，真实结果继续归原 delivery owner。
        await write(ledger);
        return {
          kind: "recovery",
          state,
          ...(notice ? { noticeClaimed: true } : {}),
          stoppedInputIds,
          stoppedAll:
            requirements.size > 0 &&
            [...requirements.values()].every((item) => item.stopConfirmed === true),
          blockers: [...blockers].sort(),
          cards: selection.cards,
          requests: selection.requests,
        };
      },
    );
    if (notice) {
      try {
        await port.publishRecovery?.(notice);
      } catch {
        /* 原投递 owner 保留 unknown；不能盲目重发通知。 */
      }
    }
    return recovery;
  };
}
