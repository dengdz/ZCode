import { replyToBotChannel } from "./contract.js";
/** 已由 Host 注入工作区与执行输入；deps 来自同一投递所有者。 */
export const exampleBotChannelReply = (
  request: Parameters<typeof replyToBotChannel>[0],
  deps: Parameters<typeof replyToBotChannel>[1],
) => replyToBotChannel(request, deps);
