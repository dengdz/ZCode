# 渠道提及与回复协议

登记现有 channel-mention.ts，保留公开路径与普通群兼容。严格 schema 校验原生 mention 引用、工具 parts、Host 请求、结果与澄清。模型不能提供平台 ID；普通 ref 只在 Host 的可信输入内解析。

Local collaboration 意图为可选扩展；原请求没有该字段时仍按原契约解析。意图中的 targetBotId 是本机已配置选项，不是平台身份；最终目标及原需求用户由 Host 选择。该协议不改变官网 Bot v3 来源或数据库格式。

06：channelReplyResultSchema 接受严格 blocked 未发送结果，区别于投递和候选澄清。collaboration 的 requiredDuty 由 PM 声明，引用和用户选择不能替代角色校验。

07：严格 silent 结果只有 status，不携带投递编号或完成含义。silent 意图禁止目标字段；空 text part 由 Host 校验为唯一内容，普通群拒绝该意图。

08：候选选择按 08-recipient-selection 工单合同执行。Local sidecar 是原待发请求与选择领取的唯一 owner，Bot 投递记录仍为唯一外部送达事实；awaiting_selection 不表示送达。recipientSelection 的 present/render/respond 命令分别领取卡片、投影原卡和核对原生选择，属于同一能力，不新建状态服务。
