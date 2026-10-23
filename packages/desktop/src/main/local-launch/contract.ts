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

export interface LocalLaunchContract {
  /** 同一 owner 锁内确认静止后操作；不启动应用、不解除异常占用。 */
  withMaintenance<T>(
    input: LocalMaintenanceInput,
    operation: (roots: { home: string; dataRoot: string }) => Promise<T>,
  ): Promise<LocalMaintenanceResult<T>>;
  /** 持久化占用后才启动；等正常退出及进程结束才释放，异常状态不自动接管。 */
  run(input: LocalLaunchInput): Promise<LocalLaunchResult>;
}
