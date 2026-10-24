# local-collaboration

18：localCollaborationTurnSchema 严格定义 requirementId/role/readOnly 的原输入约束，独立于 Bot v3。Local owner 生成、原 canonical intent 传递并持久化，模型不能改写。LOCAL_READONLY_TOOL_NAMES 和 isLocalReadOnlyToolAllowed 是同一正向工具边界；ReplyToChannel 另需合法协作意图，Host 继续验证实际授权。无 IO、无第二份执行状态；详细命令和生命周期见 18 已批准合同。

Local 群协作配置的共享运行时协议，独立于官网 Bots v3。设置仅提交已知群、机器人、授权用户、项目选项与 expectedRevision；open_id/app_id 不可作为保存参数注入。平台身份由可信入站证明，用户跨应用身份按租户和 union_id 关联。Snapshot 供界面读取；config 是持久授权事实，revision 使旧授权可失效。此模块无 IO，不管理任务或发送。

授权用户选项 key 统一由 collaborationUserId 生成，只关联同租户、同提供方的可信 union_id；不把应用内 open_id 当作全局身份。connected 表示既有群接入状态，与可信身份证明 verified 分开。

05 增加严格的 ReplyToChannel 协作意图 union（dispatch/report/question/final），只接收本机机器人选项，不接受平台 ID、原需求用户或任意扩展字段。未传意图仍兼容原渠道协议；是否必须使用意图由 Host 按群配置决定。

06：requiredDuty 是 PM 对派单或执行者追问的职责声明，按当前配置精确比较；协议保留缺省以便 Host 返回 required_duty_missing。严格 blocked 结果表示尚未发送，携带 reason/message 及必要的职责比较信息，不是投递回执。

13：accept 是 PM-only 的验收控制意图，不接受 target、平台身份或扩展字段；Host 只在已送达 final 后的可信真人输入上返回严格 `{status: acceptance_recorded}`，否则复用 blocked 说明需求仍开放。它是 Local 需求阶段结果，不是渠道投递回执，也不由模型提交原需求用户或阶段事实。
