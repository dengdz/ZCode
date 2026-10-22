import type { ProjectExecutionOwner } from "./contract.js";

/** 核对持久占用，不以读取过程释放未知 owner。 */
export function exampleInspectProjectExecution(
  owner: ProjectExecutionOwner,
  sessionId: string,
  workspaceKey: string,
) {
  return owner.isSessionLeaseHeld({ sessionId, workspaceKey });
}

/** 只在实际执行收口后释放；busy 时调用方将输入交回原 Core 队列。 */
export async function exampleProjectExecution(
  owner: ProjectExecutionOwner,
  run: () => Promise<void>,
) {
  const claim = await owner.acquire({
    sessionId: "session-a",
    inputId: "input-a",
    workspaceKey: "/synthetic/project",
    scope: { projectId: "project-a", workspaceKey: "/synthetic/project" },
  });
  if (claim.kind !== "acquired") return claim.kind;
  try {
    await run();
  } finally {
    await claim.release();
  }
  return "finished";
}
