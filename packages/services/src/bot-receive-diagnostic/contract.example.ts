import type { LocalReceiveDiagnostic } from "./contract.js";
/** scope 仅供本机精确匹配；输出由观察器重新挑选字段，不记录原始身份或消息 ID。 */
export function exampleReceiveDiagnostic(diagnostic: LocalReceiveDiagnostic) {
  diagnostic.record(
    {
      provider: "feishu",
      botId: "synthetic-bot",
      chatId: "synthetic-chat",
      messageId: "synthetic-id",
    },
    { stage: "native", outcome: "received", facts: { senderType: "bot", mentionCount: 1 } },
  );
}
