# Local 项目执行租约

原 V4/Core 队列继续拥有接受/排队/执行。此模块只在注入的 Local 扩展目录保存固定 session scope 和当前排他执行租约。acquire 等待元数据持久化后返回 unscoped/busy/acquired；release 只清除匹配 token，幂等且异步。目录未配置时，显式 Local scope 必须拒绝，普通无 scope 返回 unscoped。

workspaceKey 必须与实际 record 的 identity.trim() || path 相同。同工作区不同 group/bot/task/project alias 共享一把租约；session 的项目绑定不可替换。绑定和租约用严格 schema，文件名哈希；无正文、凭据、第二份 accepted queue。租约没有TTL或进程死亡自动接管，损坏/异常冒泡，执行未知留12核对。释放时机由原 runtime 的实际工作状态决定，不由 Bot 完成确认决定。

11 的 isSessionLeaseHeld 只读同一工作区执行文件，核对它是否仍归该 session；不释放、不接管、不按 pid 推断空闲。不存在或归其他 session 时为 false，损坏或读取失败向上报告。运行时将该事实与 live record/Core owned work 一起用于 inspectOwnedWork，旧租约没有 live owner 时保持 unknown。
