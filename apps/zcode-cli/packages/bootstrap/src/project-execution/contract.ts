/** 绑定由可信 Host 从固定协作配置生成，不接收正文自报身份。 */
export interface ProjectExecutionScope {
  projectId: string;
  workspaceKey: string;
}
export type ProjectExecutionClaim =
  | { kind: "unscoped" }
  | { kind: "busy" }
  | { kind: "acquired"; release(): Promise<void> };

/** 只拥有 Local scope 与当前执行租约，不拥有已受理输入、队列或外部结果。 */
export interface ProjectExecutionOwner {
  /** 只读该工作区持久租约是否仍归指定 session；损坏/读取失败不可判为空闲。 */
  isSessionLeaseHeld(input: { sessionId: string; workspaceKey: string }): Promise<boolean>;
  /** 原子绑定/复核会话后尝试领取。busy 包含未知租约；失败不自动释放旧 owner。 */
  acquire(input: {
    sessionId: string;
    inputId: string;
    workspaceKey: string;
    scope?: ProjectExecutionScope;
  }): Promise<ProjectExecutionClaim>;
}
