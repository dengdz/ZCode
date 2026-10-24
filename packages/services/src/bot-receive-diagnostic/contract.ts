export const receiveDiagnosticStages = [
  "connection",
  "transport",
  "native",
  "callback-auth",
  "prepare",
  "parse",
  "dedupe",
  "authorization",
  "guard",
  "binding",
  "admission",
  "complete",
] as const;
export const receiveDiagnosticOutcomes = [
  "received",
  "invalid-token",
  "ready",
  "failed",
  "provider-response",
  "parsed",
  "empty",
  "duplicate",
  "allow",
  "deny",
  "redirect",
  "legacy",
  "scope-exempt",
  "missing-id",
  "disabled",
  "owner-mismatch",
  "legacy-limit",
  "unmentioned",
  "linked",
  "accepted",
  "rejected",
  "unknown",
] as const;
export interface ReceiveDiagnosticFacts {
  senderType?: "user" | "bot" | "app" | "other";
  messageType?: "text" | "post" | "interactive" | "other";
  senderIdPresent?: boolean;
  threadPresent?: boolean;
  mentionCount?: number;
  botIdentityResolved?: boolean;
  selfSender?: boolean;
  nativeMentionMatched?: boolean;
  ignoredInteraction?: boolean;
  parsedCount?: number;
  guardCount?: number;
}
/** 有限本机观察，不拥有业务状态，不向接收链路返回判定。 */
export interface LocalReceiveDiagnostic {
  record(
    scope: {
      provider?: string;
      botId?: string;
      chatId?: string;
      messageId?: string;
      senderId?: string;
    },
    observation: {
      stage: (typeof receiveDiagnosticStages)[number];
      outcome: (typeof receiveDiagnosticOutcomes)[number];
      facts?: ReceiveDiagnosticFacts;
    },
  ): void;
  dispose(): Promise<void>;
}
