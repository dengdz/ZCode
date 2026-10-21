import {
  resolveChannelReplyParts,
  type ChannelContentPart,
  type ChannelReplyHostRequest,
  type CollaborationBlockedResult,
  type CollaborationScope,
} from "@zcode/shared";

type RecipientValidation = {
  intent: NonNullable<ChannelReplyHostRequest["collaboration"]>;
  isPm: boolean;
  targetBotId?: string;
  actualDuty?: string;
  expectedTargetId: string;
  provider: CollaborationScope["provider"];
  parts: ChannelReplyHostRequest["parts"];
  trusted: readonly ChannelContentPart[];
};

/** 只核对声明与可信身份；不分析任务正文，不保存配置，也不执行发送。 */
export function validateDispatchRecipient({
  intent,
  isPm,
  targetBotId,
  actualDuty,
  expectedTargetId,
  provider,
  parts,
  trusted,
}: RecipientValidation): CollaborationBlockedResult | undefined {
  if (
    isPm &&
    targetBotId &&
    (intent.kind === "dispatch" || intent.kind === "question") &&
    !intent.requiredDuty
  ) {
    return {
      status: "blocked",
      reason: "required_duty_missing",
      targetBotId,
      message:
        "Nothing sent. Declare requiredDuty from the configured executor duties before dispatching or asking an executor. PM must classify the task; never change duties to fit a selected recipient.",
    };
  }
  if (
    isPm &&
    targetBotId &&
    (intent.kind === "dispatch" || intent.kind === "question") &&
    intent.requiredDuty !== actualDuty
  ) {
    return {
      status: "blocked",
      reason: "role_mismatch",
      targetBotId,
      requiredDuty: intent.requiredDuty,
      actualDuty,
      message:
        "Nothing sent. Required duty differs from this recipient's configured duty. Select a matching executor; do not change the task's required duty or the recipient's configuration just to pass validation.",
    };
  }
  const refs = parts.filter((part) => part.type !== "text");
  if (refs.length > 1 || refs.some((part) => part.type !== "mention"))
    return {
      status: "blocked",
      reason: "reference_unavailable",
      message:
        "Nothing sent. Use one native mention from the executing input or the configured targetBotId. Unresolved names and candidate choices require clarification; they cannot authorize a recipient.",
    };
  if (refs.length) {
    let resolved;
    try {
      resolved = resolveChannelReplyParts(refs, trusted);
    } catch {
      return {
        status: "blocked",
        reason: "reference_unavailable",
        message:
          "Nothing sent. This reference is missing or conflicting in the executing conversation. Obtain a current native mention; do not guess an identity.",
      };
    }
    const ref = resolved[0];
    if (
      ref?.type !== "channelMention" ||
      ref.channel !== provider ||
      ref.targetId !== expectedTargetId
    )
      return {
        status: "blocked",
        reason: "recipient_mismatch",
        targetBotId,
        message:
          "Nothing sent. The native reference does not identify the configured recipient. Correct the recipient/reference while preserving the task's required duty.",
      };
  }
}
