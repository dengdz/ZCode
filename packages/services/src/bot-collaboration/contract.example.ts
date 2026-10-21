import type { BotCollaborationContract } from "./contract.js";
/** 设置读取权威快照；保存需携带该快照的 revision。 */
export function exampleBotCollaboration(contract: BotCollaborationContract) {
  return contract.getSettings();
}
