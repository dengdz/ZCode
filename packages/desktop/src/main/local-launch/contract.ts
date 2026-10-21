/** 共用数据的受控启动边界；原始应用若绕过此入口，不在保护范围内。 */
export type LocalLaunchEdition = "official" | "local";

export interface LocalLaunchInput {
  edition: LocalLaunchEdition;
  applications: Readonly<Record<LocalLaunchEdition, string>>;
  /** 同一 home 的 realpath 对应同一占用域；不改变既有 v2 存储格式。 */
  home: string;
  applicationArguments?: readonly string[];
}

export type LocalLaunchResult =
  | { kind: "exited"; code: number | null; signal: NodeJS.Signals | null }
  | { kind: "unconfirmed"; edition: LocalLaunchEdition }
  | { kind: "blocked"; reason: "occupied" | "unconfirmed"; edition?: LocalLaunchEdition };

export interface LocalLaunchContract {
  /** 持久化占用后才启动；等正常退出及进程结束才释放，异常状态不自动接管。 */
  run(input: LocalLaunchInput): Promise<LocalLaunchResult>;
}
