# 09 同项目实际执行串行

Status: done

工单：[09](../issues/zcode-local/09-project-serial-execution.md)，基线 `59ed44e5`，分支 `3.16.2-local.1`。实现提交 `387fbb3e260e3bab2804ca84011cd3ab768591f8`，包含同会话续跑补正和本次收尾记录。父规格冻结 blob `25efc393d4c8d5cf0fb44cbbd4ca8b04dd6c1387` 未改写。

## 行为与边界

启用协作群的 Host 从固定绑定生成 `projectExecutionScope`，只包含可信 projectId 和 workspaceKey（identity.trim() 或 path）。Local 话题输入也强制 queue，不抢占在办执行。字段经严格 V4 sendText 校验，与真实 workspaceKey 不符直接失败；正文、模型声明、桌面当前项目不能改变路由。

原 CLI CommandInbox/Core 队列继续是接受、排队与执行唯一所有者。新增 `cli-project-execution` 只在现有 storage root 的 Local 扩展目录保存 session 固定绑定和按 workspaceKey 排他的当前租约，文件名哈希、原子写入、文件锁协调；不保存输入正文、第二份 accepted queue 或发送结果。相同工作区的不同群、机器人或项目别名共享互斥；不同工作区隔离。已有会话不得换绑项目。

忙碌输入经原 requireQueue 返回 queue ACK；原 sendQueuedNow 在提升前重查租约。自动等待复用既有队列重评入口，互斥 busy 不把队列切 held；手动竞争失败保留原项。同会话上一项 completion 收口后释放旧租约，已提升的下一项沿原队列继续；后台任务仍由原 runtime 权威查询阻塞释放，停止 ACK 不释放。未知、崩溃或损坏租约保持阻塞，不做 TTL 抢占，恢复核对留在 12。

普通未绑定会话、私聊、其他群和桌面/手机链路不添加该字段，保持原并发、owner/lease、clientMode 与 replayable 语义。设置端 `busy` 继续核对真实队列/执行，queued 不得改关键配置。

## 验证

Node 24.14.0 / pnpm 10.33.2。实际 V4 server/App/Core 与受控模型端口验证 14 项运行时场景：跨 Host 同工作区互斥、原队列续跑、并发提交、冷恢复排队新输入、固定 scope 拒绝、改绑拒绝、协议校验、同会话续跑、detached sidecar 保护、普通会话兼容、重复提交、原队列取消与停止 ACK。CLI 相关 6 文件 / 176 项通过；Bot 相关 9 文件 / 376 项通过。根与完整 CLI 类型检查 32/32 通过；根 Lint 0 错误 / 97 条存量警告，CLI 0 错误 / 70 条警告及 13 项原样上游行数诊断；架构 0 新违规；43 条文档相对链接通过；父规格冻结检查通过。交接中的 format-final.log 实际记录 README 格式失败，格式状态以本次收尾复验记录为准。

一次全量：2059 文件通过、1 文件失败、2 文件跳过；20085 项通过、3 项失败、10 项跳过，耗时 496.42 秒，退出码 1。失败全部为既有 `webRemoteControlAuthGateFixture.test.ts`，固定 5173 被其他项目 Node 93626 占用（cwd 为 breakx/frontend，启动于 10 月 21 日）；未杀进程、未改无关测试、未记全绿。全量后 fixture 诊断 10→10、新增 0，临时夹具与已安装官网签名通过；系统弹窗 UI 未自动观察。03a 修复继续有效。

证据目录：`~/.local/share/zcode-local/research/issue-09/`。红线证据包括 runtime-full-current.log、cli-related-postfix.log、root-related-postfix.log、cli-typecheck-current.log、lint-final.log、cli-lint.log、architecture-final.log、format-final.log、full-unit-postfix.log、full-failure-port-owner-postfix.log、fixture-audit-postfix.json/log、review-summary.md、doc-links.log。固定官网 Reader 兼容沿用既有验证边界，本轮无 Bot v3/SQLite 格式改动。

## Standards

独立规范轴审查 0 项确认违规、0 项高置信度新增 Fowler 异味；模块边界、唯一队列所有者、租约所有者与依赖方向符合约定。

## Spec

独立需求轴对照 stories 8/9/36/37 与 T16–T18，0 项确认问题；固定 scope、互斥、排队、停止与普通会话兼容符合工单。真实模型和真实群验收保留 18。

审查汇总：Standards 0 项，Spec 0 项；固定比较 `59ed44e5...`。审查后补正同会话续跑：红证据 same-session-red.log，绿证据 runtime-full-current.log；相关 176/376 项、类型与上述门禁复验通过。

## 收尾复验

2026-10-22 在 Node 24.14.0 / pnpm 10.33.2 下复跑：实际运行时 14/14、根类型检查、完整 CLI 类型检查 32/32、根 Lint 0 错误 / 97 警告、CLI Lint 0 错误 / 70 警告及 13 项原样上游行数诊断、架构 0 新违规均通过。按仓库 formatter 整理本票文件后，根与 CLI 变更范围格式检查均通过；本次未增加或修改行为，未重复全量测试，前述 3 项端口环境失败继续保留披露。

新增证据单独保存在 `~/.local/share/zcode-local/research/issue-09/closeout-20261022-01/`，不改写旧日志。`root-typecheck.log`、`cli-typecheck-final.log`、`root-lint.log`、`cli-lint.log`、`architecture-final.log`、`root-format-final.log`、`cli-format-final.log` 和 `runtime.log` 为本次通过记录。首次 CLI 类型检查因 shell 缺少根 node_modules/.bin 中的 turbo 入口退出，补齐本次命令的 PATH 后 32/32 通过，未安装或变更依赖。`doc-links-final.json` 对本票 28 个交付文件中的 42 条相对文件链接复核，零失效；原 doc-links.log 的 43 条为交接检查记录。父规格冻结值未变。

## 复验入口

```sh
pnpm --dir apps/zcode-cli --filter @zcode/bootstrap exec vitest run tests/project-execution/runtime.test.ts
pnpm exec vitest run packages/services/test/botCollaborationHandoffs.test.ts packages/services/test/zcodeLegacyTaskCompatTaskIndex.test.ts
```

真实模型遵循与真实群验收仍未执行；当前源码交付，未打包、安装或重启日常机器人，02 旧候选尚不包含 04–09。10 尚未开始。
