import { getUnavailableReplyFallback } from "#src/bots/groupReply.js";
import { setTimeout as sleep } from "node:timers/promises";
import type { BotGroupDelivery } from "@zcode/shared";

interface GroupDeliveryDependencies {
  read(id: string): Promise<BotGroupDelivery | undefined>;
  write(result: BotGroupDelivery): Promise<void>;
  authorized(result: BotGroupDelivery): Promise<boolean>;
  send(result: BotGroupDelivery): Promise<void | { providerMessageId: string }>;
  onSettled?(): Promise<void>;
  delay?(milliseconds: number): Promise<void>;
}

/** 只保存和发送已生成结果；不持有任务执行或输入队列。 */
export function createGroupResultDelivery(deps: GroupDeliveryDependencies) {
  const inFlight = new Map<string, Promise<void>>();
  const deliver = (result: BotGroupDelivery, retry = false): Promise<void> => {
    const existing = inFlight.get(result.id);
    if (existing) return existing;
    const operation = (async () => {
      const saved = await deps.read(result.id);
      const current = saved ?? result;
      if (saved && (saved.status !== "failed" || !retry)) return;
      let attemptResult = current;
      let retries = 0;
      for (;;) {
        if (!(await deps.authorized(attemptResult))) {
          await deps.write({ ...attemptResult, status: "invalidated", updatedAt: Date.now() });
          return;
        }
        // 请求前落盘 unknown，进程中断后不得把不确定结果当作未发送。
        await deps.write({ ...attemptResult, status: "unknown", updatedAt: Date.now() });
        try {
          const sent = await deps.send(attemptResult);
          await deps.write({
            ...attemptResult,
            ...(sent ? { providerMessageId: sent.providerMessageId } : {}),
            status: "sent",
            lastError: undefined,
            updatedAt: Date.now(),
          });
          return;
        } catch (error) {
          const details = error as {
            deliveryRejected?: boolean;
            deliveryInvalidated?: boolean;
            deliveryReplyUnavailable?: boolean;
            retryAfterMs?: number;
          } | null;
          const rejected = details?.deliveryRejected === true;
          await deps.write({
            ...attemptResult,
            // 最后一次授权复核失败属于撤销，不是可手动重试的网络失败。
            status: details?.deliveryInvalidated ? "invalidated" : rejected ? "failed" : "unknown",
            lastError: error instanceof Error ? error.message : String(error),
            updatedAt: Date.now(),
          });
          if (details?.deliveryInvalidated) return;
          // 只有明确拒绝才降级；普通群去掉引用，话题最多退到根锚点，群目标仍由闭包固定。
          if (rejected && details?.deliveryReplyUnavailable) {
            const fallback = getUnavailableReplyFallback(attemptResult);
            if (fallback) {
              attemptResult = { ...attemptResult, ...fallback };
              continue;
            }
          }
          if (
            rejected &&
            typeof details?.retryAfterMs === "number" &&
            Number.isFinite(details.retryAfterMs) &&
            retries < 2
          ) {
            retries += 1;
            await (deps.delay ?? sleep)(
              Math.max(250, Math.min(30_000, details.retryAfterMs * retries)),
            );
            continue;
          }
          return;
        }
      }
    })().finally(async () => {
      inFlight.delete(result.id);
      await deps.onSettled?.();
    });
    inFlight.set(result.id, operation);
    return operation;
  };
  return Object.assign(deliver, {
    isInFlight: (id: string) => inFlight.has(id),
    /** 只核对原 unknown 的外部事实；与发送共用在途和写入路径，不产生重发。 */
    async confirm(id: string, observe: (saved: BotGroupDelivery) => Promise<boolean>) {
      const existing = inFlight.get(id);
      // 恢复调用可能持有 Local 授权锁；不能等待同一发送回头取得此锁。
      // 活跃发送继续由原 owner 完成，本次观察只保留未知。
      if (!existing) {
        const operation = (async () => {
          const saved = await deps.read(id);
          if (saved?.status !== "unknown" || !(await observe(saved))) return;
          const fresh = await deps.read(id);
          if (
            fresh?.status === "unknown" &&
            fresh.taskId === saved.taskId &&
            fresh.authorizationId === saved.authorizationId &&
            fresh.providerMessageId === saved.providerMessageId
          )
            await deps.write({
              ...fresh,
              status: "sent",
              lastError: undefined,
              updatedAt: Date.now(),
            });
        })().finally(() => inFlight.delete(id));
        inFlight.set(id, operation);
        await operation;
      }
      return (await deps.read(id))?.status === "sent" ? ("sent" as const) : ("unknown" as const);
    },
    // Bug 原因：崩溃恢复用的 unknown 曾直接触发 UI 告警；活跃发送只投影 pending，不能改写恢复记录。
    project: (result: BotGroupDelivery): BotGroupDelivery =>
      inFlight.has(result.id) ? { ...result, status: "pending" } : result,
  });
}
