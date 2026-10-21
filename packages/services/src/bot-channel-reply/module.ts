export const botChannelReplyModule = {
  id: "bot-channel-reply",
  requires: ["shared", "services"],
  provides: ["bot-channel-reply"],
  publicEntrypoints: ["index.ts", "contract.ts", "../bots/channelReply.ts"],
} as const;
