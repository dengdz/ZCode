import { channelReplyRequestSchema } from "./contract.js";
export const exampleChannelReply = channelReplyRequestSchema.parse({
  taskId: "task",
  inputId: "input",
  toolCallId: "call",
  parts: [{ type: "text", text: "Implement the feature" }],
  collaboration: { kind: "dispatch", targetBotId: "app" },
});
