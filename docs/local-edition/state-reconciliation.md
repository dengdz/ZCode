# 12 断线与重启后的状态核对

Status: done

工单：[12](../issues/zcode-local/12-state-reconciliation.md)，基线 `4967777c9f817b0bb96cf1d4bc649388686c1e68`，分支 `3.16.2-local.1`。实现提交 `d565c608da8d7c60f593134ca50a2977dfb48436`。父规格冻结 blob `25efc393d4c8d5cf0fb44cbbd4ca8b04dd6c1387` 保持不变。

## 行为与所有者

启用群在 Host 启动重新订阅、可信入站与正式回复准备时，按原群/线程、任务、输入、工作区和授权核对已有事实。原 Local owner 持有需求、输入关联、卡片及通知领取；CLI/Core 继续持有输入、执行和租约；Bot delivery owner 继续持有发送结果。没有新增恢复执行队列或运行状态表，不重新 submit 已受理工作。

任务 SDK 只读查询原 commandId、原队列/执行来源及 owned-work。CLI 冷查询从 canonical user message 的严格完整 conversationInputIntent 恢复 inputAccepted，保留原 admitted delivery；assistant、timeline、缺失或矛盾 intent 不作为有类型的受理证明。输入提升在原 Repo 文件锁内原子修改 admission，保留其他 Host 的渠道收据。`/new` 后的历史 taskIds 仍能核对，不能要求旧任务仍 active；旧卡片与实际发送继续校验当前任务。

unknown 投递只有原 message_id 可查时，才读取 Provider，核对群/线程、应用发送者和原消息身份，经原 delivery owner 确认为 sent。无 ID、读取失败、删除/404、不匹配保持 unknown，不把超时或人工“未收到”变为重发依据。sent 保留，普通群既有人工核对行为保持。

有效、未领取展示的卡片，及已选择但尚未领取发送且无发送事实的原请求，沿原 present/ReplyToChannel 续接同一 toolCallId。claimed、unknown、过期、撤权、版本变化、任务切换与停止屏障不能被恢复绕过。停止恢复只继续原 owned-work 核对，不恢复旧队列或旧目标；新需求仍须按 11 的确认条件推进。未知时真实叫停和 `/disable` 撤权仍走原权限检查。

原 Host 退出只证明入站协调调用不再活跃；仅在原 token 关联原输入并核对受理/停止事实后清理协调 token，绝不据 PID 或时间删除项目执行租约。关键配置变更核对 owned-work/租约与未决投递，界面空闲不足以放行。恢复通知只提及原授权用户，领取先落 Local 再锁外走原投递；多 Host 与丢收据均不自动重发同一通知。

## 能力边界

旧 CLI 不支持查询/owned-work、仅有无类型 ACK、原任务不可查、旧 token 无法关联、失去 live owner 的项目租约、无消息 ID 或 Provider 无法核实时，保持未知并说明，不能自行清除或再执行。CLI 原有冷启动取消/丢弃的队列不因本票自动重建。旧授权、删除记录和未知结果不作为安全续接证明。

本票只交付本地源码与合成公开边界证据。真实群、真实模型、实际凭据、安装候选与用户验收留后续票；13 未开始。

## 验证

Node 24.14.0 / pnpm 10.33.2，隔离工具路径未改全局。验证边界为 Provider 回调→真实 Bot/Local/Repo/渠道组装→受控任务 SDK，真实 SDK→合成外部 Agent wire，以及实际 V4 server/App/Core→合成模型。没有 mock 所有者内部方法。

| 检查            | 结果                                                                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 根相关回归      | 6 文件，276 通过 / 1 默认跳过；覆盖启动恢复、丢 ACK、丢收据、消息错群/线程/发送者、跨 owner 通知、卡片续接、停止保持、配置约束、/new 与撤权兼容             |
| 实际 CLI        | 6 文件 / 169 通过；原命令冷查询保留原 delivery、不再次启动模型，queue/owned-work/持久事实与既有 V4 命令回归                                                 |
| 类型            | 根类型与完整 CLI 类型通过，CLI 32/32 任务成功                                                                                                               |
| Lint/架构       | 根 0 错误 / 97 条存量警告；CLI 0 错误 / 70 条警告、13 条原样上游行数诊断；架构 0 违规                                                                       |
| 独立审查        | Standards 2 项、Spec 2 项（历史任务项重复）；共 3 项已修正，双路复审未解决 0                                                                                |
| 固定官网 Reader | 官方 `3c5b2276` 读写本票隔离 Bot v3 后 Local 读回通过；恢复通知 unknown、原用户提及及 Local 领取字节保留。仅证明合成 Bot 文件兼容，未覆盖 SQLite 与实际凭据 |
| 全量            | 2060 文件通过 / 1 文件失败 / 2 跳过；20141 项通过 / 3 失败 / 11 跳过；667.36 秒，退出码 1。三项均为下述已核实端口冲突，未记全绿                             |
| 原生 fixture    | 诊断 10→10，新增 0；本次临时 native app 完整签名有效，官网已安装应用签名有效；未观察系统弹窗                                                                |

默认跳过项是专用崩溃子进程入口。父测试创建隔离临时 home、受控 Node/Vitest 子进程和显式 sentinel，子进程在 SDK 受理后自发 SIGKILL；父测试重建真实服务，验证核对原受理后才能清理入站协调令牌，且原输入不重跑。项目执行租约仍由实际 CLI/Core 的既有持久租约未知场景覆盖，不能用该受控 SDK 夹具证明真实租约已经结束。它不终止日常应用或其他进程，不是遗漏的恢复场景。

TDD 红证据包括 recovered-input-red、unknown-barrier-red、delivery-recovery-red、selected-recovery-red、stopped-recovery-red、settings-unknown-red、admission-recovery-red-real-crash 与 cli-durable-query 日志。审查补正另有 new-task-recovery-red 与 unknown-revoke-red，分别复现新任务阻断和撤权失效。早期夹具退出方式、合成 SDK spy、schema import 与类型错误日志保留，不冒称产品基线红证据。

证据目录：`~/.local/share/zcode-local/research/issue-12/`。主要入口为 `related-after-review.log`、`cli-related-first.log`、`typecheck-after-review.log`、`cli-typecheck-first.log`、`lint-after-review.log`、`cli-lint-first.log`、`architecture-after-review.log`、两份 review、`official-recovery-reader.log`、`local-recovery-reader.log`、`full-unit.log/.exit`。全量完整结束且失败如实保留；变更范围格式通过。新增文档链接无失效；工具链历史文档的 4 个既有失效相对链接与基线相同，未扩票修改。

全量的三项失败均在原 `webRemoteControlAuthGateFixture.test.ts`：Mobile Web fixture 以 strictPort 启动固定 5173，返回 `Port 5173 is already in use`。本轮实际核实 PID 13185、启动时间 08:35:57、工作目录 `/Users/zhangyl/IdeaProjects/breakx/frontend`，对应 Vite `--mode local.uat`；相关测试与 helper 相比基线无改动。本轮未停止该服务、未改测试端口、未重复全量，也未把原失败写成通过。证据 `port-5173.log`、`full-unit.log/.exit` 与 `checks.json`。这不替代受影响边界的 276 项相关和 169 项 CLI 通过结果；真实群验收仍留 18。

原生核对见 `fixture-audit.json/.log`：本轮实际 native fixture `Identifier=dev.zcode.app`、`Signature=adhoc`，完整签名校验通过；仅作签名与诊断检查，不启动日常应用，不把它等同系统弹窗观察。没有推送、创建 tag、打包/安装候选、重启日常机器人或进入 13。
