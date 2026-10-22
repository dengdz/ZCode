import { createHash, randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { atomicWritePrivateTextFile, withFileLock } from "@zcode/shared/node";
import type { ProjectExecutionOwner } from "./contract.js";

const scopeSchema = z
  .object({ projectId: z.string().min(1), workspaceKey: z.string().min(1) })
  .strict();
const leaseSchema = z
  .object({
    token: z.string().min(1),
    sessionId: z.string().min(1),
    inputId: z.string().min(1),
    pid: z.number().int().positive(),
    workspaceKey: z.string().min(1),
  })
  .strict();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
async function readOptional(file: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** 竞争结果不是执行收据；队列提升遇到竞争只能保留原项。 */
export class ProjectExecutionBusyError extends Error {
  readonly reasonCode = "guard.projectExecutionBusy";
  constructor() {
    super("Project execution is occupied or requires reconciliation");
    this.name = "ProjectExecutionBusyError";
  }
}

/** 运行时拒绝变更固定 scope，稳定错误码沿现有 failed ACK 返回。 */
export class ProjectExecutionScopeError extends Error {
  readonly reasonCode: string;
  constructor(reason: "storageUnavailable" | "workspaceMismatch" | "bindingChanged") {
    super(`Local project execution scope: ${reason}`);
    this.name = "ProjectExecutionScopeError";
    this.reasonCode = `guard.projectExecution.${reason}`;
  }
}

/** Local 扩展文件只保存 scope/当前租约，不接管 CommandInbox 或 Core 队列。 */
export function createProjectExecutionOwner(directory?: string): ProjectExecutionOwner {
  return {
    async acquire(input) {
      if (!directory) {
        if (input.scope) throw new ProjectExecutionScopeError("storageUnavailable");
        return { kind: "unscoped" };
      }
      const bindingFile = join(
        directory,
        `session-${hash(JSON.stringify([input.workspaceKey, input.sessionId]))}.json`,
      );
      const scope = await withFileLock(bindingFile, async () => {
        const raw = await readOptional(bindingFile);
        const saved = raw === undefined ? undefined : scopeSchema.parse(raw);
        const requested = input.scope ? scopeSchema.parse(input.scope) : undefined;
        if (requested && requested.workspaceKey !== input.workspaceKey)
          throw new ProjectExecutionScopeError("workspaceMismatch");
        if (
          saved &&
          (saved.workspaceKey !== input.workspaceKey ||
            (requested && saved.projectId !== requested.projectId))
        )
          throw new ProjectExecutionScopeError("bindingChanged");
        if (!saved && requested)
          await atomicWritePrivateTextFile(bindingFile, JSON.stringify(requested));
        return saved ?? requested;
      });
      if (!scope) return { kind: "unscoped" };
      const file = join(directory, `execution-${hash(scope.workspaceKey)}.json`);
      return withFileLock(file, async () => {
        const existing = await readOptional(file);
        if (existing !== undefined) {
          leaseSchema.parse(existing);
          // 进程退出不证明副作用已结束；未知租约留给恢复核对，绝不按 TTL 抢占。
          return { kind: "busy" };
        }
        const token = randomUUID();
        await atomicWritePrivateTextFile(
          file,
          JSON.stringify({
            token,
            pid: process.pid,
            sessionId: input.sessionId,
            inputId: input.inputId,
            workspaceKey: scope.workspaceKey,
          }),
        );
        return {
          kind: "acquired",
          release: () =>
            withFileLock(file, async () => {
              const raw = await readOptional(file);
              if (raw !== undefined && leaseSchema.parse(raw).token === token) await rm(file);
            }),
        };
      });
    },
  };
}
