# local-launch

受控入口统一启动同一业务 home 下的原始官网应用和 Local。支持 macOS，本模块不修改原始应用或它们的 native singleton。

- home 与实际业务根共同参与占用；占用文件在各根 `.zcode/local/launch-owner.json`，父目录 realpath 去重并按固定顺序加锁。官网 `.zcode/v2` 不扩字段，两版 Electron profile 分开。
- 异步读取 home 设置里的 dataBaseDir；显式 dataRoot（默认 home）须与保存的实际根一致，重定向未确认时拒绝启动，避免测试设置意外加载日常数据。
- 短临界区复用 shared 异步目录锁；持久化 preparing 在 spawn 之前。running、preparing、损坏或未知版本都禁止后续接管，不能按时间过期夺锁。
- 正常退出码 0 且实际进程组、目标应用进程已结束，才以原 token 释放。异常退出、launcher 崩溃或状态不明保留记录。观察期限仅产生 unconfirmed，不作为已退出证据。
- 对进程仅以信号 0 观察，不强杀；发现占用由用户完全退出。绕过受控入口直接运行原始程序不受此机制约束。
- 入口既不调度 Bot 任务，也不保存第二份会话；调用方负责给测试传独立 home，不能把开发路径指到日常数据。

- `withMaintenance(input, operation)` 是维护脚本的公开静止文件操作边界，input 显式 home/dataRoot 和两种应用路径。复用现有实际根选择与 owner 锁，整个 callback 持有同一组锁；任何已有 owner（含异常遗留）或现存目标应用进程均拒绝。callback 获得规范化 home/dataRoot，无权更改 owner。正常或异常返回释放短锁，进程崩溃由 shared 锁的进程证据回收，不伪造应用退出。不持久化第二份维护运行状态；崩溃产生的备份只能是未 ready 半成品。直接绕过入口启动的竞争继续不在保护范围。
