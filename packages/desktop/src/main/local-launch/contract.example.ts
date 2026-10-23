import type { LocalLaunchContract, LocalLaunchInput } from "./contract.js";

/** 用户选择 Local；blocked 表示未启动另一应用，不能解释为已完成切换。 */
export async function exampleLocalLaunch(port: LocalLaunchContract, input: LocalLaunchInput) {
  return port.run(input);
}

/** 维护方只在静止临界区读取文件，备份清单仍由维护入口所有。 */
export async function exampleLocalMaintenance(port: LocalLaunchContract, input: LocalLaunchInput) {
  return port.withMaintenance(input, async ({ dataRoot }) => dataRoot);
}
