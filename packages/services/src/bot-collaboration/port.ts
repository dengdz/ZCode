import type {
  BotConfig,
  BotContextState,
  BotWorkspaceRef,
  BotsConfigFile,
  CollaborationConfig,
  CollaborationScope,
} from "@zcode/shared";

/** 构造依赖端口，不是协作服务提供给调用方的业务能力。 */
export interface BotCollaborationPort {
  /** 仅记录路由元信息；发送结果继续以既有投递记录为准，不写正文。 */
  diagnose?(
    event: CollaborationScope & {
      botId: string;
      action: "admission" | "input" | "send";
      outcome: string;
      inputId?: string;
      deliveryId?: string;
      requirementId?: string;
      revision?: number;
    },
  ): void;
  file: string;
  readConfig(): Promise<BotsConfigFile>;
  readStates(): Promise<BotContextState[]>;
  listWorkspaces(): Promise<BotWorkspaceRef[]>;
  canUseWorkspace(bot: BotConfig, workspaceId: string): boolean;
  /** 向实际运行时核对；状态不可确认须返回 false 或抛出，不能按历史 status 推断。 */
  isIdle(scope: CollaborationScope, current: CollaborationConfig | undefined): Promise<boolean>;
}
