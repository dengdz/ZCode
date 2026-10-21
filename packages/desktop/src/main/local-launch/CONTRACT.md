# local-launch

受控入口统一启动同一业务 home 下的原始官网应用和 Local。支持 macOS，本模块不修改原始应用或它们的 native singleton。

- home 与实际业务根共同参与占用；占用文件在各根 `.zcode/local/launch-owner.json`，父目录 realpath 去重并按固定顺序加锁。官网 `.zcode/v2` 不扩字段，两版 Electron profile 分开。
- 异步读取 home 设置里的 dataBaseDir；显式 dataRoot（默认 home）须与保存的实际根一致，重定向未确认时拒绝启动，避免测试设置意外加载日常数据。
- 短临界区复用 shared 异步目录锁；持久化 preparing 在 spawn 之前。running、preparing、损坏或未知版本都禁止后续接管，不能按时间过期夺锁。
- 正常退出码 0 且实际进程组、目标应用进程已结束，才以原 token 释放。异常退出、launcher 崩溃或状态不明保留记录。观察期限仅产生 unconfirmed，不作为已退出证据。
- 对进程仅以信号 0 观察，不强杀；发现占用由用户完全退出。绕过受控入口直接运行原始程序不受此机制约束。
- 入口既不调度 Bot 任务，也不保存第二份会话；调用方负责给测试传独立 home，不能把开发路径指到日常数据。
