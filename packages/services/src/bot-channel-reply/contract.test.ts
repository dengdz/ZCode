import { expect, it, vi } from "vitest";
import { replyToBotChannel } from "./contract.js";
it("拒绝伪造的原用户声明，校验失败不访问存储或发送", async () => {
  const read = vi.fn(async () => {
    throw new Error("Unexpected I/O");
  });
  await expect(
    replyToBotChannel(
      {
        taskId: "task",
        inputId: "input",
        toolCallId: "call",
        workspacePath: "/project",
        parts: [{ type: "text", text: "Final" }],
        collaboration: { kind: "final", originalUserId: "forged" },
      } as never,
      { readState: read, readConfig: read, deliver: read },
    ),
  ).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
});
