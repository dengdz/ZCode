# Local 维护脚本契约

维护脚本的产品契约以 [14 工单](../../docs/issues/zcode-local/14-versioned-candidates.md) 为准，父规格保持冻结。
这是仓库脚本层，不是 Desktop Main/Host 或 CLI/runtime 的业务模块；`architecture-policy.yaml` 目前不托管 scripts，不能把架构检查通过当作此脚本运行行为已获验证。

公开进程入口：根目录 `pnpm local:maintain check|build --fork owner/repo --review FILE --output DIR`。
无隐式命令，无常驻任务。`--output` 必须为全新、仓库外、非日常应用/数据的绝对路径；父目录需已存在。
退出码：0 表示本次 check 允许构建或本次 build 产物已验证，1 表示拒绝/失败。stdout 为阶段和结果 JSON 行，stderr 为错误码，不回显原始子进程输出。原始构建输出保存在 output/logs，仅供本机审阅。

`check.json` 是单次上游/版本/公开内容检查报告；不是长期状态数据库。`candidate.json` 是本次候选的唯一 ready 事实，在全部验证后原子写入；没有该文件的目录不得安装。后续安装工单需重新核对文件哈希和源锚点，不能仅信任 status 文本。

build 用当前 Git 工作树的 `.git/local-maintenance.lock`（worktree 使用其自身 git-dir）互斥现有 out 目录写入。失败/正常返回释放自己取得的锁；进程崩溃时保守保留。人工确认进程及其构建子进程已结束后才可删除遗留锁，不自动按时间抢锁。文件、网络和子进程 IO 均集中在维护脚本 adapter；不导入 Desktop/服务/CLI 实现。

`review` schema=1：`officialBase`、`upstreamCommit` 为完整 SHA；`officialVersion` 对应版本前缀；`capabilityEvidence` 描述公开源码与所需能力的差异；`blockers` 为阻塞项数组；`publicContentReviewed=true` 表示已做语义隐私审阅；`patches` 每项含完整 commit、retain/retired 决定和 evidence。以上是维护者审阅输入，不是程序从测试结果推断出的业务验收。

API 实时核对上游 commit 和公开 fork；本机已有相同 Git 对象可复用，缺失则实际 fetch。任何网络失败均停止，不回退本地旧 ref。`git cherry` 只发现精确补丁等价；精确等价项需显式 retired 且能在当前源码重新应用（说明本地效果已移除），否则停止。语义修复与能力缺口由带证据的 review 负责。

当前 build 只在 macOS arm64/x64 执行既有工具链，并核对 ASAR 元数据、平台版本、ad-hoc/runtime 签名、架构、ZIP 全部应用文件/链接的类型/权限/内容（与已验签应用逐项相同）和只读挂载 DMG 内的完整应用。不会启动应用、安装、创建标签或推送；其他平台明确拒绝，不能视作已验证。

构建在隔离 HOME 下运行，但显式复用调用者已使用的 pnpm store 依赖缓存，避免 HOME 改变触发 node_modules purge；不修改全局 pnpm 配置，不访问日常业务数据。
