# Local 群项目执行互斥

Status: in-progress

需求与状态：[09 工单](../../../../../docs/issues/zcode-local/09-project-serial-execution.md)。只扩展 Local 群的原运行时受理，不改普通会话行为。

Host 在 V4 sendText 的可选严格 projectExecutionScope 字段提交已核对的 projectId/workspaceKey；该字段不是模型工具参数、不进入原 botGroupSource/intent/Bot v3/SQLite。CLI 在配置 storage root 的 local/v1/project-execution 保存 session→scope 绑定，跨 Host 的租约按 workspaceKey 定位，保留原路径/identity 规则。无绑定的普通 session 不使用项目租约；已绑定 session 的队列提升与冷恢复读取同一 Local 绑定，不能因字段未再次携带而绕过。

项目租约是互斥元数据：session/input/token/pid，不保存 accepted queue 或正文。admission 前尝试取得；忙碌交原 Core requireQueue，queue ACK 与 snapshot 均来自原所有者。sendQueuedNow 启动前重新竞争，失败原项保留，自动提升复用既有 retry，不另造排序器。会话 FIFO 不变，不承诺跨会话全局 FIFO。

租约覆盖真实前台和关联后台工作；停止请求不能释放。实际 completion 已收口且 Core 无 active/queued work、后台任务才释放唯一 token。未知/崩溃/损坏记录保持阻塞，由 12 核对恢复；不靠 TTL 抢占。文件 IO 沿 shared/node 私有原子写入和文件锁，scope 与 lease 均是 Local 扩展，不改变官网数据格式。

测试从真实 V4 server→App/Core→受控模型端口观察开始/结束与原队列投影；Bot 集成补固定 scope、话题默认队列及普通群兼容。desktop-continuous/web-remote-replayable 原帧与 owner/lease不变；合成测试不能代替18真实群验收。
