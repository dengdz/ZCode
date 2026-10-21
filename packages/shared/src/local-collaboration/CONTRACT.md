# local-collaboration

Local 群协作配置的共享运行时协议，独立于官网 Bots v3。设置仅提交已知群、机器人、授权用户、项目选项与 expectedRevision；open_id/app_id 不可作为保存参数注入。平台身份由可信入站证明，用户跨应用身份按租户和 union_id 关联。Snapshot 供界面读取；config 是持久授权事实，revision 使旧授权可失效。此模块无 IO，不管理任务或发送。

授权用户选项 key 统一由 collaborationUserId 生成，只关联同租户、同提供方的可信 union_id；不把应用内 open_id 当作全局身份。connected 表示既有群接入状态，与可信身份证明 verified 分开。
