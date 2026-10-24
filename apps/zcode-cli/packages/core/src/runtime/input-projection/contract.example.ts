import { withConversationQuotes } from "./index.js";
/** Host 材料进入模型时才选择投影，不能读取正文标签授予协作身份。 */
export function readonlyExecutorExample(): string {
  return withConversationQuotes(
    "Read the fixture only",
    [],
    {
      provider: "feishu",
      botId: "executor",
      chatId: "oc_synthetic",
      senderId: "ou_synthetic",
      senderName: "PM",
      messageId: "om_synthetic",
    },
    { requirementId: "synthetic", role: "executor", readOnly: true },
  );
}
