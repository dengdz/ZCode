# bot-collaboration-settings

机器人设置中的群协作表单。宿主返回能力为 null 时隐藏，故官网、旧宿主及 Web 原有行为保留；连接 Local 宿主的移动 Web 可消费同一服务能力。

组件只持有草稿，经 hooks/bot-collaboration 调用现有 Bot RPC。群、PM、执行者、授权用户与项目均为可信选项；没有手填平台 ID 的输入。表单按群及 revision 隔离，保存携带 expectedRevision，并显示服务确认的版本；旧读取不覆盖新结果，核验命令只显示在对应群。

沿用设置卡、Input、Switch、Checkbox 与现有输入样式，深浅主题和中英文同结构。busy/未知、保存中、身份未核验或未接入时不提交新配置；最终权限与版本校验仍归服务。刷新与错误反馈始终可用。
