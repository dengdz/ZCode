import { expect, it } from "vitest";
import type { TurnInputIntentMetadata } from "@zcode/contracts";
import { withConversationQuotes } from "./index.js";

it("模型投影不能改写已冻结的 canonical 来源与原生提及位置", () => {
  const source: NonNullable<TurnInputIntentMetadata["botGroupSource"]> = {
    provider: "feishu",
    botId: "executor",
    chatId: "oc_synthetic",
    senderId: "ou_synthetic",
    senderName: "PM",
    messageId: "om_synthetic",
    contentParts: [
      { type: "text", text: "Read " },
      {
        type: "channelMention",
        refId: "m1",
        name: "Executor",
        targetId: "ou_executor",
        idType: "open_id",
        entityType: "unknown",
        channel: "feishu",
      },
    ],
  };
  const before = structuredClone(source);
  source.contentParts!.forEach(Object.freeze);
  Object.freeze(source.contentParts);
  Object.freeze(source);
  const routing = { requirementId: "synthetic", role: "executor" as const, readOnly: true };
  const first = withConversationQuotes("Read the fixture", [], source, routing);
  expect(withConversationQuotes("Read the fixture", [], source, routing)).toBe(first);
  expect(source).toEqual(before);
  expect(first).toContain("collaboration report");
});
