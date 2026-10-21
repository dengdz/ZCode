export const channelMentionsModule = {
  id: "channel-mentions",
  requires: ["shared", "local-collaboration"],
  provides: ["channel-mentions"],
  publicEntrypoints: ["index.ts", "contract.ts", "../channel-mention.ts"],
} as const;
