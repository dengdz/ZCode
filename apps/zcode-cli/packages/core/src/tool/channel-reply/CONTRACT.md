# 渠道回复工具入口

登记既有 `ReplyToChannel` 工具入口，保留公开导入路径。调用继续通过公共工具链进入同一个 handler；契约只引用原 ToolEntry 与共享输入、结果 schema。

- 以实际工具调用所属 assistant 的 parentID 绑定用户输入，不取后续排队消息的授权。
- 发送由现有 Host 端口执行；工具不新建渠道连接，不复制任务绑定。
- 继续保留 deferred 分类、非只读与非并发安全属性；取消、参数校验和权限语义不变。
- 澄清结果不表示已发送；恢复或重试不合成用户授权。

运行时回归位于 `tests/reply-to-channel.test.ts`。

Local 协作输入可声明 dispatch/report/question/final 意图，只有原 dispatch/question 形状允许本机目标 botId/requiredDuty；report/final/accept/silent/stop 的 collaboration 对象只有 kind。正文规则及真实原需求用户、平台目标和方向由 Host 重读 Local 归属与配置确认。没有 Local 能力的宿主拒绝该意图，不能降级为普通发送；普通群原接口不变。

只读 guard 仍在准备、Hook、权限和 handler 之前拒绝。原生 ReplyToChannel 的已提供但不合法协作参数返回固定的可修正参数错误，不发消息、不裁字段；修正后重新完整授权。缺少协作意图、其他工具和 MCP 同名仍按原权限拒绝，Provider flat schema 兼容边界保持。

06：Local 派单提供 requiredDuty；blocked 结果只说明未发送及纠正原因，不包装为成功，不自行更换职责或发送目标。

07：Local 上下文允许 silent 意图，parts 为单个空 text，不传目标；Host 保存当前执行输入静默状态并返回 {status: "silent"}。该结果不是投递或完成回报。错误与阻塞仍会显示，普通群不可使用。

08：候选选择按 08-recipient-selection 工单合同执行。Local sidecar 是原待发请求与选择领取的唯一 owner，Bot 投递记录仍为唯一外部送达事实；awaiting_selection 不表示送达。recipientSelection 的 present/render/respond 命令分别领取卡片、投影原卡和核对原生选择，属于同一能力，不新建状态服务。
