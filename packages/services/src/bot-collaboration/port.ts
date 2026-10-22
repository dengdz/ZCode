import type {
  BotConfig,
  BotContextState,
  BotWorkspaceRef,
  BotsConfigFile,
  CollaborationConfig,
  CollaborationScope,
} from "@zcode/shared";
export type CollaborationStopState = "stopped" | "stopping" | "unavailable";
export interface CollaborationStopTarget extends CollaborationScope {
  botId: string;
  threadId?: string;
  taskId: string;
  workspacePath: string;
  workspaceIdentity?: string;
  inputIds: string[];
}
export interface CollaborationStopNotice extends CollaborationScope {
  botId: string;
  threadId?: string;
  taskId: string;
  inputId: string;
  authorizationId: string;
  messageId: string;
  ownerId: string;
  deliveryId: string;
  state: CollaborationStopState;
}

/** 构造依赖端口，不是协作服务提供给调用方的业务能力。 */
export interface BotCollaborationPort {
  /** 只控制已关联的原任务，先 hold 所有队列再 stop；不把 ACK 当作已停止。 */
  stopTasks?(targets: CollaborationStopTarget[]): Promise<CollaborationStopState>;
  publishStop?(notice: CollaborationStopNotice): Promise<void>;
  resumeTask?(target: CollaborationStopTarget): Promise<boolean>;
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
