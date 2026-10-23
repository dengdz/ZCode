# local-launch

受控入口统一启动同一业务 home 下的原始官网应用和 Local。支持 macOS，本模块不修改原始应用或它们的 native singleton。

- home 与实际业务根共同参与占用；占用文件在各根 `.zcode/local/launch-owner.json`，父目录 realpath 去重并按固定顺序加锁。官网 `.zcode/v2` 不扩字段，两版 Electron profile 分开。
- 异步读取 home 设置里的 dataBaseDir；显式 dataRoot（默认 home）须与保存的实际根一致，重定向未确认时拒绝启动，避免测试设置意外加载日常数据。
- 短临界区复用 shared 异步目录锁；持久化 preparing 在 spawn 之前。running、preparing、损坏或未知版本都禁止后续接管，不能按时间过期夺锁。
- 正常退出码 0 且实际进程组、目标应用进程已结束，才以原 token 释放。异常退出、launcher 崩溃或状态不明保留记录。观察期限仅产生 unconfirmed，不作为已退出证据。
- 对进程仅以信号 0 观察，不强杀；发现占用由用户完全退出。绕过受控入口直接运行原始程序不受此机制约束。
- 入口既不调度 Bot 任务，也不保存第二份会话；调用方负责给测试传独立 home，不能把开发路径指到日常数据。

- `withMaintenance(input, operation)` 是维护脚本的公开静止文件操作边界，input 显式 home/dataRoot 和两种应用路径。复用现有实际根选择与 owner 锁，整个 callback 持有同一组锁；任何已有 owner（含异常遗留）或现存目标应用进程均拒绝。callback 获得规范化 home/dataRoot，无权更改 owner；维护方必须在 callback 内才初始化备份目的根，未确认重定向不能先写任何备份标记。正常或异常返回释放短锁，进程崩溃由 shared 锁的进程证据回收，不伪造应用退出。不持久化第二份维护运行状态；崩溃产生的备份只能是未 ready 半成品。直接绕过入口启动的竞争继续不在保护范围。

- `switchToCandidate(input, operation)` 先等待当前 Local 的 maintenance runtime 已就绪，再在实际数据根 `.zcode/local/maintenance/` 写带随机 token 的请求，并向该 owner 已验明的 child PID 发送由应用处理的 `SIGUSR2`。该目录是可重建的瞬时控制状态，不进入 15 的 `.zcode/local/v1` 备份载荷。请求存在期间普通 `run` fail closed；Main 只以所有窗口 Host 已就绪后的真实运行任务计数回答 busy/unknown/accepted。busy/unknown、无响应或旧 launcher 未按原 token 释放都停止，不发送 SIGTERM/SIGKILL。干净的 Local 不存在、官网占用/未知进程、部分或异常 owner 分别拒绝或继续，不能靠超时夺锁。
- 旧应用干净退出后，入口在同一跨根锁内原子写 `phase=switching` owner 并执行替换回调；普通 `run` 不接受该 owner。回调成功后唯一 takeover token 可交给 `run(input, { takeoverToken })`，该次启动原子取得 preparing/running owner；token 不匹配、已有进程或 partial owner 均拒绝。回调失败只在仍持有原 switching token 且没有应用进程时清除该 owner，保留恢复证据。
- Local `run` 为应用注入 `ZCODE_LOCAL_LAUNCH_TOKEN`。带该 token 的 Local Main 在 Host 完成服务与 base attachment 初始化后写 `runtime.json`；停止时读取当前请求，并以 `ready/busy/unknown` 回答。状态文件绑定 owner token 和 app PID，旧文件不能证明新应用已就绪。维护切换入口等待新 owner 的 runtime ready，且只把“本地 Host 已就绪”作为连接核对，不冒充真实模型、机器人凭据或群验收。
