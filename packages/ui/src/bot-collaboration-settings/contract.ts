import type { CollaborationScope } from "@zcode/shared";
/** 设置入口按当前机器人的 Provider 筛选群，权威能力由宿主服务返回。 */
export interface BotCollaborationSettingsProps {
  provider: CollaborationScope["provider"];
}
