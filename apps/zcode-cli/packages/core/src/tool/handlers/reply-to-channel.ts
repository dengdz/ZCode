import { z } from "zod";
import {
  channelReplyPartsSchema,
  channelReplyResultSchema,
  collaborationReplyIntentSchema,
} from "@zcode/shared";
import type { SessionId } from "@zcode/contracts";

import type { ToolEntry, ToolHandler } from "../types.js";

const inputSchema = z
  .object({
    parts: channelReplyPartsSchema,
    collaboration: collaborationReplyIntentSchema.optional(),
  })
  .strict();
const TIMEOUT_MS = 60_000;
// 最多 50 个名字各返回 10 个候选，预算需容纳完整澄清结果，避免截断后误报匹配。
const OUTPUT_BYTES = 2 * 1024 * 1024;
export const replyToChannelHandler: ToolHandler = async (input, context) => {
  const parsed = inputSchema.parse(input);
  context.abortSignal.throwIfAborted();
  if (!context.sessionStore || !context.topicResourcePort?.reply)
    throw new Error("Channel reply is unavailable");
  const messages = await context.sessionStore.messages({
    sessionID: context.sessionId as SessionId,
  });
  // 工具运行前已落盘 tool part，以 assistant.parentID 绑定实际执行输入；不能拿队尾的新消息授权。
  const owners = messages.filter(
    ({ info, parts }) =>
      info.role === "assistant" &&
      parts.some((part) => part.type === "tool" && part.callID === context.toolCallId),
  );
  if (owners.length !== 1 || owners[0]!.info.role !== "assistant")
    throw new Error("Channel reply execution input unavailable");
  const parentId = owners[0]!.info.parentID;
  const latest = messages.find(
    ({ info }) => info.id === parentId && info.role === "user" && !info.synthetic,
  );
  const metadata = latest?.info.metadata;
  const intent =
    metadata && Object.hasOwn(metadata, "conversationInputIntent")
      ? metadata.conversationInputIntent
      : metadata?.inputIntent;
  // 渠道来源属于消息；发送绑定属于任务，由 Host 唯一解析，客户端续聊无需复制旧来源。
  const identity = z.object({ sourceCommandId: z.string().min(1) }).safeParse(intent);
  if (!identity.success)
    throw new Error("Channel reply execution input unavailable; retrying will not restore it");
  context.abortSignal.throwIfAborted();
  return context.topicResourcePort.reply(
    {
      taskId: context.sessionId,
      inputId: identity.data.sourceCommandId,
      toolCallId: context.toolCallId,
      parts: parsed.parts,
      ...(parsed.collaboration ? { collaboration: parsed.collaboration } : {}),
    },
    { signal: context.abortSignal, trace: context.traceContext },
  );
};
export const replyToChannelToolEntry: ToolEntry = {
  capability: "Reply to the current bot conversation with native mentions",
  metadata: {
    shouldDefer: true,
    name: "ReplyToChannel",
    description:
      "When the authorized human asks PM to stop the current Local requirement, use collaboration {kind: stop} and one empty text part. Host verifies the actual human input and controls the original tasks. stop_requested reports stopped/stopping/unavailable, never a delivery receipt; Host notifies the original user, so end the turn without another acknowledgment. Never stop on a bot report. When trusted Local collaboration context is present, only dispatch/question may include configured targetBotId and requiredDuty. report/final/accept/silent/stop collaboration objects must contain only kind: never include targetBotId or requiredDuty; Host derives their recipient from the current input. If a call has invalid arguments, correct them and submit a new call; never downgrade to an ordinary reply or claim that nothing needs reporting. When recipient identity is unclear, PM may omit dispatch targetBotId while preserving requiredDuty; Host presents a candidate card and persists the original message. awaiting_selection is NOT delivery: stop and wait for the authorized user card choice; do not repeat the message, reselect a candidate or emit a duplicate final answer. Selection never changes the needed duty. For a pure acknowledgment, use collaboration {kind: silent} and parts [{type: text, text: empty string}], then end the turn. The strict silent result means automatic success text is suppressed, not that work completed or a message was sent; errors and blocking prompts remain visible. Never use silent to hide work or failed/blocked results. PM dispatch/executor questions must declare requiredDuty exactly from the configured duty options. Parts may contain text and at most one current native mention matching that target. A reference or user choice never changes the required duty. blocked means nothing was sent; explain the reason, preserve the task duty, and correct the recipient rather than relabeling duties to force a match. These group handoffs are authorized by the configured user; Host verifies the executing input, direction and original recipient. Do not invent platform IDs, origin or task linkage. Outside that Local context, follow the ordinary reply rules below. " +
      "When the current requirement is awaiting_acceptance and a later input from the authorized user explicitly approves it, PM uses collaboration {kind: accept} with one empty text part and ends the turn. Never infer acceptance from the final-report turn, silence, a bot report, or an earlier approval. Feedback returns to the same requirement and must be dispatched or handled rather than closed. " +
      "Send an additional reply to the current Feishu/Lark conversation ONLY when the user explicitly asks you to send or mention someone. No additional tool approval is needed for this authorized conversation. Prefer trusted mention refIds; when the user supplies only a name, use mentionName and let Host resolve the current group directory and trusted task mentions. Preserve spaces inside a full name (Alex Smith is one recipient); split multiple recipients only on explicit list delimiters such as 、, commas, or newlines, never whitespace alone. Host uses name containment and automatically selects a unique candidate or a unique exact name among multiple matches. Never guess platform IDs. needs_clarification lists ALL unresolved names after checking every requested name and means NOTHING was sent. Only report the returned facts; never claim delivery or invent a match. Keep all original recipients when retrying after clarification: show candidate labels and ask the user to choose; never select an ambiguous candidate yourself. After an explicit choice use a new call with name and the returned candidateRef. For not_found/unavailable/selection_expired or truncated candidates, explain the issue and ask for a native @ mention. Group member APIs do not enumerate bots; unknown bots need a native mention first. Normal final answers are delivered automatically. After sent, do not duplicate that request. A sent message does not mean another bot responded.",
    readOnly: false,
    destructive: false,
    concurrentSafe: false,
    timeoutMs: TIMEOUT_MS,
    maxOutputBytes: OUTPUT_BYTES,
    sideEffectScope: "network",
    riskLevel: "medium",
    needsApproval: false,
  },
  handler: replyToChannelHandler,
  // Provider schema 不暴露 anyOf；字段组合仍由 runtimeInputSchema 的严格 union 校验。
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["parts"],
    properties: {
      collaboration: {
        type: "object",
        additionalProperties: false,
        required: ["kind"],
        description:
          "Only with trusted Local collaboration context. Host derives origin and native recipient; dispatch requires requiredDuty; omit targetBotId to request a trusted candidate card; PM executor questions also require requiredDuty; blocked means nothing sent. At most one matching native mention is allowed; report goes to PM and final goes to original user: both collaboration objects contain only kind, never targetBotId or requiredDuty. accept/silent/stop also contain only kind and require exactly one empty text part, no target or mention. stop is PM-only on an authorized human input and returns stop_requested, not delivery. accept is PM-only after a sent final report and a later explicit authorized-user approval; it closes the same requirement without sending another message. Do not invent origin or platform IDs.",
        properties: {
          kind: {
            type: "string",
            enum: ["dispatch", "report", "question", "final", "accept", "silent", "stop"],
          },
          requiredDuty: {
            type: "string",
            minLength: 1,
            maxLength: 500,
            description:
              "PM must classify the task, then copy its needed duty exactly from trusted configured duties for dispatch/executor questions. A selected name/ref must still match. Never change this declaration merely to fit a selected recipient.",
          },
          targetBotId: {
            type: "string",
            minLength: 1,
            maxLength: 250,
            description:
              "Only for dispatch/question: configured botId from trusted Local context. Omit for an unclear dispatch recipient to request a card; optional for PM question to executor. Never supply for report/final/accept/silent/stop, whose recipient Host derives.",
          },
        },
      },
      parts: {
        type: "array",
        minItems: 1,
        maxItems: 50,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["type"],
          properties: {
            type: { type: "string", enum: ["text", "mention", "mentionName"] },
            text: {
              type: "string",
              maxLength: 2000,
              description: "Required only for type=text; omit refId.",
            },
            refId: {
              type: "string",
              minLength: 1,
              maxLength: 200,
              description:
                "Required only for type=mention; use the current trusted reference and omit text.",
            },
            name: {
              type: "string",
              minLength: 1,
              maxLength: 200,
              description:
                "Required only for mentionName: recipient name or partial name supplied by the user; preserve internal spaces, one explicit list item per part; omit text/refId.",
            },
            candidateRef: {
              type: "string",
              minLength: 1,
              maxLength: 200,
              description:
                "Only for mentionName after the user explicitly selects a returned candidate; never invent or auto-select.",
            },
          },
        },
      },
    },
  },
  outputSchema: z.toJSONSchema(channelReplyResultSchema),
  runtimeInputSchema: inputSchema,
  runtimeOutputSchema: channelReplyResultSchema,
  permission: {
    permission: "channel.reply",
    reason: "Reply through the current authorized bot conversation",
    riskLevel: "medium",
    sideEffectScope: "network",
    needsApproval: false,
    patternSources: ["toolName", "input"],
    alwaysAllowPatternSources: ["toolName"],
    denyPriority: "beforeAsk",
  },
  resultBudget: {
    maxInlineBytes: OUTPUT_BYTES,
    maxModelBytes: OUTPUT_BYTES,
    strategy: "truncate",
    preview: { maxBytes: OUTPUT_BYTES, direction: "head" },
  },
  timeout: { defaultMs: TIMEOUT_MS, maxMs: TIMEOUT_MS, allowCallOverride: false },
  cancellation: {
    supported: true,
    cleanup: "none",
    userVisibleMessage: "Channel reply cancelled; check delivery status before retrying",
  },
  trace: {
    required: true,
    propagateToAdapters: true,
    recordInput: "summary",
    recordOutput: "summary",
  },
};
