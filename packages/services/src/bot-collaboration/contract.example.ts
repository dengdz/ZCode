import type { BotCollaborationContract } from "./contract.js";
/** 设置读取权威快照；保存需携带该快照的 revision。 */
export function exampleBotCollaboration(contract: BotCollaborationContract) {
  return contract.getSettings();
}

/** 原生回调经过 Provider 验证后，沿同一选择能力处理。 */
export function exampleRecipientSelection(
  contract: BotCollaborationContract,
  message: import("@zcode/shared").BotInboundMessage,
) {
  return contract.recipientSelection({ kind: "respond", message });
}
