import { expect, it } from "vitest";
import { channelReplyRequestSchema } from "./contract.js";
it("旧请求兼容，Local协作意图不允许注入平台ID", () => {
  const legacy = {
    taskId: "task",
    inputId: "input",
    toolCallId: "call",
    parts: [{ type: "text", text: "Work" }],
  };
  expect(channelReplyRequestSchema.parse(legacy).parts).toHaveLength(1);
  expect(
    channelReplyRequestSchema.safeParse({
      ...legacy,
      collaboration: { kind: "dispatch", targetBotId: "app", openId: "ou_forged" },
    }).success,
  ).toBe(false);
});
