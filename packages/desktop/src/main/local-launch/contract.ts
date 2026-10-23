/** 共用数据的受控启动边界；原始应用若绕过此入口，不在保护范围内。 */
export type LocalLaunchEdition = "official" | "local";

export interface LocalLaunchInput {
  edition: LocalLaunchEdition;
  applications: Readonly<Record<LocalLaunchEdition, string>>;
  /** home 参与占用，保留原设置与凭据上下文；不改变既有 v2 存储格式。 */
  home: string;
  /** 显式选择实际业务根，默认 home；必须与 home 设置中的 dataBaseDir 一致。 */
  dataRoot?: string;
  applicationArguments?: readonly string[];
}

export type LocalLaunchResult =
  | { kind: "exited"; code: number | null; signal: NodeJS.Signals | null }
  | { kind: "unconfirmed"; edition: LocalLaunchEdition }
  | {
      kind: "blocked";
      reason: "occupied" | "unconfirmed" | "data-root-mismatch";
      edition?: LocalLaunchEdition;
    };

export type LocalMaintenanceInput = Pick<LocalLaunchInput, "home" | "dataRoot" | "applications">;
export type LocalMaintenanceResult<T> =
  | { kind: "completed"; value: T }
  | Extract<LocalLaunchResult, { kind: "blocked" }>;

export interface LocalSwitchInput extends LocalMaintenanceInput {
  /** 请求旧应用响应退出；超时只返回未知，不据此释放 owner。 */
  requestTimeoutMs?: number;
}

export interface LocalSwitchCompletionInput extends LocalMaintenanceInput {
  /** 仅清理已经在本次 takeover 中登记的切换门。 */
  expectedVersion?: string;
}

export type LocalSwitchBlockedReason =
  | "occupied"
  | "busy"
  | "unknown"
  | "exit-unconfirmed"
  | "data-root-mismatch";

export type LocalSwitchResult<T> =
  | {
      kind: "completed";
      /** 后续 launcher 仅此 token 可接管；普通 run 不得使用。 */
      takeoverToken: string;
      value: T;
    }
  | {
      kind: "blocked";
      reason: LocalSwitchBlockedReason;
      edition?: LocalLaunchEdition;
      runningTaskCount?: number;
    }
  | {
      /** 回调失败时仍保留 switching owner 与切换门，调用方必须先恢复目标再 abort。 */
      kind: "failed";
      takeoverToken: string;
      error: unknown;
    };

export interface LocalLaunchContract {
  /** 同一 owner 锁内确认静止后操作；不启动应用、不解除异常占用。 */
  withMaintenance<T>(
    input: LocalMaintenanceInput,
    operation: (roots: { home: string; dataRoot: string }) => Promise<T>,
  ): Promise<LocalMaintenanceResult<T>>;
  /**
   * 先让当前 Local 按运行时门禁正常退出，再写 switching owner 并把锁交给回调。
   * 回调成功后 token 可交给 `run(..., { takeoverToken })`；回调失败保留 switching owner。
   */
  switchToCandidate<T>(
    input: LocalSwitchInput,
    operation: (roots: { home: string; dataRoot: string }) => Promise<T>,
  ): Promise<LocalSwitchResult<T>>;
  /**
   * 新应用 ready 且切换结果落盘后，以 takeover token 清理本次切换门。
   * 任一新 owner、runtime 或版本不符都保留门，避免并发安装覆盖证据。
   */
  completeSwitch(
    input: LocalSwitchCompletionInput,
    takeoverToken: string,
  ): Promise<LocalMaintenanceResult<undefined>>;
  /**
   * 只撤销尚未产生新应用 PID 的 switching owner。
   * 恢复目标仍在同一跨根锁内执行，任何新 owner 或运行进程都拒绝。
   * 数据恢复中 setting.json 可暂时缺失；以显式根及匹配 owner/gate token 寻址。
   */
  abortSwitch<T>(
    input: LocalSwitchInput,
    takeoverToken: string,
    operation: (roots: { home: string; dataRoot: string }) => Promise<T>,
  ): Promise<LocalMaintenanceResult<T>>;
  /** 持久化占用后才启动；等正常退出及进程结束才释放，异常状态不自动接管。 */
  run(input: LocalLaunchInput, options?: { takeoverToken?: string }): Promise<LocalLaunchResult>;
}
