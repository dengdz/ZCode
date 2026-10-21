# 渠道提及与回复协议

登记现有 channel-mention.ts，保留公开路径与普通群兼容。严格 schema 校验原生 mention 引用、工具 parts、Host 请求、结果与澄清。模型不能提供平台 ID；普通 ref 只在 Host 的可信输入内解析。

Local collaboration 意图为可选扩展；原请求没有该字段时仍按原契约解析。意图中的 targetBotId 是本机已配置选项，不是平台身份；最终目标及原需求用户由 Host 选择。该协议不改变官网 Bot v3 来源或数据库格式。
