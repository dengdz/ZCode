# Local 协作停止核对

18 补正：原 inspectOwnedWork 在冷会话上沿 CommandInbox/READY 单飞恢复，并仅在该恢复来源延迟 MCP 预启动。Core 是内存延迟标记的唯一 owner，构造及历史上下文恢复均遵守它；原 initializeMcp 真实执行入口解除标记并幂等初始化，完成前不请求模型。正常创建/恢复默认不变，已有 runtime 不被重设为延迟模式。blocking work、finalization、后台与旧租约的 idle/busy/unknown 定义不变；不新增 RPC、队列或持久状态，不忽略正在初始化的原工作。Host 的纯核对必须先发该命令再读原快照；两种订阅模式共享同一记录及原交付语义。

11 工单复用原 stop、setAutoDrain、deleteQueueItem、pauseGoal 和 cancelBackgroundWork。Host 先持久停止屏障，再暂停原任务队列；仅控制原需求来源的执行，前台使用实际 foregroundExecutionId，停止 ACK 不等同于终态。

新增只读 V4 inspectOwnedWork 命令，返回严格 ownedWorkState（idle / busy / unknown）。CLI 在原 record/runtime 上核对 active controller、finalization、Core residency-blocking work 及同一项目租约；未释放的后台/sidecar/待运行工作均不能返回 idle。持久租约仍属于此 session 而当前 record 没有对应 live lease 时返回 unknown，损坏或不可读也不得回空闲。不新增执行状态、队列、定时器或写入路径；Host 不用 UI phase 或 ACK 推测副作用结束。

仅 Host 停止适配使用该事实，桌面 continuous 与手机 replayable 的现有投影和 owner/lease 不变。旧 CLI 不支持该命令时 Host 明确报告无法确认。新调用使用新 commandId 取得当下事实，不复用先前 inspect ACK 作为当前状态；已有会话和通用 stop 行为不变。

验证使用实际 V4 server/App/Core 和合成模型：停止请求先于模型真正收口、后台与 detached sidecar、held queue、文件保留、已释放租约与未知旧租约。跨进程未知恢复仍属 12，真实模型和真实群验收属 18。
