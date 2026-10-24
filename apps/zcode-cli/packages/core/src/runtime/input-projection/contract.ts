import type { TurnInputIntentMetadata, ModelToolContract } from "@zcode/contracts";
import type { AgentRuntimeInternal } from "../internal.js";
import type { RegularTurnLoopState } from "../methods/turn-loop-state.js";

/** CLI 内部只读投影；唯一执行状态仍由 Runtime 持有。无 IO、事件或缓存。 */
export interface CliInputProjectionContract {
  /** 仅模型边界附加引用/路由指导，不改 canonical 正文及来源对象。 */
  withConversationQuotes(
    text: string,
    quotes: TurnInputIntentMetadata["conversationQuotes"],
    botSource?: TurnInputIntentMetadata["botGroupSource"],
    localCollaboration?: TurnInputIntentMetadata["localCollaboration"],
  ): string;
  /** 从原 Runtime 和 ActiveTurn 读取本轮工具面；最终执行仍须原 executor 校验。 */
  getTurnTools(runtime: AgentRuntimeInternal, state: RegularTurnLoopState): ModelToolContract[];
}
