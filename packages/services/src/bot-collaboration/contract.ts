import type {
  BotInboundMessage,
  CollaborationChallenge,
  CollaborationConfig,
  CollaborationSave,
  CollaborationScope,
  CollaborationSnapshot,
  CollaborationVerification,
  ChannelReplyHostRequest,
  ChannelContentPart,
  BotGroupDelivery,
  CollaborationBlockedResult,
  ChannelSilentResult,
  ChannelSelectionResult,
  BotOutboundMessage,
  Locale,
  ChannelAcceptanceResult,
} from "@zcode/shared";
import type { CollaborationStopState } from "./port.js";
export type {
  BotCollaborationPort,
  CollaborationStopState,
  CollaborationStopTarget,
  CollaborationStopNotice,
} from "./port.js";
export type RecipientSelectionCommand = (
  | { kind: "present"; selectionId: string }
  | {
      kind: "render";
      scope: CollaborationScope & { botId: string; threadId?: string };
      deliveryId: string;
    }
  | { kind: "respond"; message: BotInboundMessage }
) & { locale?: Locale };
export type RecipientSelectionNotice =
  | "recipientSelectionTooLong"
  | "recipientSelectionInvalid"
  | "recipientSelectionUnauthorized"
  | "recipientSelectionClosed"
  | "recipientSelectionExpired"
  | "recipientSelectionTaken"
  | "recipientSelectionCancelled"
  | "recipientSelectionCandidateInvalid"
  | "recipientSelectionRoleMismatch";
export type RecipientSelectionOutcome =
  | { kind: "card"; botId: string; chatId: string; threadId?: string; delivery: BotGroupDelivery }
  | { kind: "render"; message: BotOutboundMessage }
  | { kind: "resume"; request: ChannelReplyHostRequest }
  | { kind: "notice"; message: RecipientSelectionNotice; update: boolean };
export type CollaborationControlCommand =
  | { kind: "stop"; message: BotInboundMessage | ChannelReplyHostRequest }
  | { kind: "recover"; scope: CollaborationScope & { threadId?: string }; notify?: boolean };
export interface CollaborationRecovery {
  kind: "recovery";
  state: "ready" | "stopping" | "unknown";
  noticeClaimed?: boolean;
  stoppedInputIds: string[];
  stoppedAll: boolean;
  blockers: string[];
  cards: string[];
  requests: ChannelReplyHostRequest[];
}
export interface BotCollaborationContract {
  /** 可信真人向 PM 叫停原需求；先持久屏障，状态只取原运行时核对结果。 */
  control(
    command: CollaborationControlCommand,
  ): Promise<{ kind: "stop"; state: CollaborationStopState } | CollaborationRecovery | undefined>;
  /** 群的可信入站方向；其他真人和未关联机器人不能触发运行时。 */
  authorize(message: BotInboundMessage): Promise<"legacy" | "allow" | "redirect" | "deny">;
  /** 在既有运行时受理前关联原需求；只返回模型材料，不修改官网来源结构。 */
  bindInput(
    message: BotInboundMessage,
    execution: {
      taskId: string;
      inputId: string;
      workspacePath: string;
      workspaceIdentity?: string;
    },
  ): Promise<string | undefined>;
  /** Host 已核对实际执行输入，协作所有者再校验方向并生成唯一原生目标或验收结果。 */
  prepareReply(
    request: ChannelReplyHostRequest,
    scope: CollaborationScope & { botId: string; threadId?: string },
    deliveryId: string,
    trusted: readonly ChannelContentPart[],
  ): Promise<
    | ChannelContentPart[]
    | CollaborationBlockedResult
    | ChannelSilentResult
    | ChannelAcceptanceResult
    | ChannelSelectionResult
    | undefined
  >;
  /** 既有投递 owner 的最后检查；等待期间变更配置或收件人授权必须失效。 */
  authorizeDelivery(
    scope: CollaborationScope & { botId: string; threadId?: string },
    delivery: BotGroupDelivery,
  ): Promise<boolean>;
  /** 普通终答保留原需求用户；执行者需明确 report 意图才创建新的机器人交接。 */
  inputOrigin(
    scope: CollaborationScope & { botId: string },
    inputId: string,
    taskId: string,
  ): Promise<{ initiatorId: string; mentionedUserIds: string[]; silent: boolean } | undefined>;
  /** 同一待发消息的卡片领取、投影及原生选择，不拥有外部发送结果。 */
  recipientSelection(
    command: RecipientSelectionCommand,
  ): Promise<RecipientSelectionOutcome | undefined>;
  /** 同一配置读取能力：界面概览含运行时状态，原生入站只读指定群绑定。 */
  readSettings(
    query: { kind: "snapshot" } | { kind: "binding"; scope: CollaborationScope },
  ): Promise<
    | { kind: "snapshot"; snapshot: CollaborationSnapshot }
    | { kind: "binding"; binding: CollaborationConfig | undefined }
  >;
  save(request: CollaborationSave): Promise<CollaborationSnapshot>;
  beginVerification(request: CollaborationVerification): Promise<CollaborationChallenge>;
  /** 仅 Bot 服务的可信 Provider 入站调用；不通过设置 RPC 暴露。返回核验回复或 null。 */
  observeInbound(message: BotInboundMessage): Promise<{ kind: "verified" | "rejected" } | null>;
  /** 原生入站协调配置；已关联 inputId 的最终 admission 与停止互斥，回调仅提交并保存原 ACK。 */
  withInbound<T>(
    message: BotInboundMessage | { inputId: string },
    receive: () => Promise<T>,
  ): Promise<T>;
}
