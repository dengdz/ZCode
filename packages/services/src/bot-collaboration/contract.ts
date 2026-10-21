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
} from "@zcode/shared";
export type { BotCollaborationPort } from "./port.js";
export interface BotCollaborationContract {
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
  /** Host 已核对实际执行输入，协作所有者再校验方向并生成唯一原生目标。 */
  prepareReply(
    request: ChannelReplyHostRequest,
    scope: CollaborationScope & { botId: string; threadId?: string },
    deliveryId: string,
  ): Promise<ChannelContentPart[] | undefined>;
  /** 普通终答保留原需求用户；执行者需明确 report 意图才创建新的机器人交接。 */
  inputOrigin(
    scope: CollaborationScope & { botId: string },
    inputId: string,
    taskId: string,
  ): Promise<{ initiatorId: string; mentionedUserIds: string[] } | undefined>;
  getSettings(): Promise<CollaborationSnapshot>;
  save(request: CollaborationSave): Promise<CollaborationSnapshot>;
  beginVerification(request: CollaborationVerification): Promise<CollaborationChallenge>;
  /** 仅 Bot 服务的可信 Provider 入站调用；不通过设置 RPC 暴露。返回核验回复或 null。 */
  observeInbound(message: BotInboundMessage): Promise<{ kind: "verified" | "rejected" } | null>;
  readBinding(scope: CollaborationScope): Promise<CollaborationConfig | undefined>;
  /** 只协调配置变更与输入登记，不拥有执行队列；原处理函数只调用一次。 */
  withInbound<T>(message: BotInboundMessage, receive: () => Promise<T>): Promise<T>;
}
