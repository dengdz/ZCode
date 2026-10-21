import type {
  BotConfig,
  BotContextState,
  BotInboundMessage,
  BotWorkspaceRef,
  BotsConfigFile,
  CollaborationChallenge,
  CollaborationConfig,
  CollaborationSave,
  CollaborationScope,
  CollaborationSnapshot,
  CollaborationVerification,
} from "@zcode/shared";
export interface BotCollaborationPort {
  file: string;
  readConfig(): Promise<BotsConfigFile>;
  readStates(): Promise<BotContextState[]>;
  listWorkspaces(): Promise<BotWorkspaceRef[]>;
  canUseWorkspace(bot: BotConfig, workspaceId: string): boolean;
  /** 向实际运行时核对；状态不可确认须返回 false 或抛出，不能按历史 status 推断。 */
  isIdle(scope: CollaborationScope, current: CollaborationConfig | undefined): Promise<boolean>;
}
export interface BotCollaborationContract {
  getSettings(): Promise<CollaborationSnapshot>;
  save(request: CollaborationSave): Promise<CollaborationSnapshot>;
  beginVerification(request: CollaborationVerification): Promise<CollaborationChallenge>;
  /** 仅 Bot 服务的可信 Provider 入站调用；不通过设置 RPC 暴露。返回核验回复或 null。 */
  observeInbound(message: BotInboundMessage): Promise<{ kind: "verified" | "rejected" } | null>;
  readBinding(scope: CollaborationScope): Promise<CollaborationConfig | undefined>;
  /** 只协调配置变更与输入登记，不拥有执行队列；原处理函数只调用一次。 */
  withInbound<T>(message: BotInboundMessage, receive: () => Promise<T>): Promise<T>;
}
