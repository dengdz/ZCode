# 11 用户叫停与实际任务停止

Status: done

工单：[11](../issues/zcode-local/11-stop-execution.md)，基线 `0a118c696d04c8d58a273295c6a8aea8ad51754d`，分支 `3.16.2-local.1`。实现提交待本地入库后回填。父规格冻结 blob `25efc393d4c8d5cf0fb44cbbd4ca8b04dd6c1387` 保持不变。

## 行为与所有者

授权真人向 PM 发送 `/stop`，或在当前真人输入中由 PM 声明 ReplyToChannel `collaboration: {kind: stop}`，沿原群/线程、配置版本、任务、输入和固定工作区定位原需求。工具只接收一个空 text part，不接收目标 ID；执行者、机器人回报、错误输入/工作区和旧授权不能取得叫停权。自然语言含义由 PM 表达显式意图，Host 不靠关键词猜测授权。

原 Local owner 先持久登记停止屏障，再经原任务 SDK 暂停所有原队列的自动推进、删除原输入待执行项、暂停可识别的原目标、按观察到的 foregroundExecutionId 停止前台，并取消可取消后台工作。最终输入 admission、停止控制核对与新需求恢复共用原文件锁；已确认的旧停止计划不再执行。旧派单、卡片、迟到交接和普通成功终答不能越过屏障。新需求只在旧需求确认结束后，由新可信输入恢复已空的原队列；不恢复旧目标或旧输入。

CLI 新增只读 inspectOwnedWork，读取原 Core residency-blocking work、finalization、active controller 和项目租约；不引入执行状态副本。停止 ACK 不作为结束证明。仍有模型/后台/detached 工作时为“正在停止”，来源未知、旧 CLI、不支持取消、断线或冷 record 仅有旧持久租约时为“无法立即停止/无法确认”。仅所有原任务实际核对结束后，才记录“已停止”。文件、改动、历史及外部结果全部保留。

状态通知向原用户原生提及，通过现有 Bot 投递 owner 保存真实发送结果；Local 只保存发送前领取及授权 key。同调用同状态跨 owner 只领取一次，sent/unknown 不盲目补发；状态由 stopping 变为 stopped 时可发送新状态。停止时与新的真人输入、不同叫停调用之间的互斥由同一 Local 锁保证，不新建调度器或恢复引擎。配置概览/绑定统一为 readSettings，保持一个配置读取能力。

## 能力边界

现有 goalVerifier/compact 投影可能没有可信 sourceCommandId；此时保守返回无法确认，不按同一 session 误停来源未知的工作。可识别的 primaryTurn、原待执行输入和后台控制已覆盖；不能把这些证据扩大成所有前台类型都能立即停止。

发送前领取后进程退出、原任务不可查、持久租约失去 live owner 等未知状态保留，不盲目恢复或重发。新用户输入在旧需求仍停止中时拒绝启动。广泛恢复归 12，真实模型和真实群的自然语言判断及运行验收归 18。

## TDD 与验证

Node 24.14.0 / pnpm 10.33.2。公开边界包括 Provider 回调 → 真实 Bot/协作/Repo/渠道请求组装 → 合成任务 SDK，以及真实任务适配 → 合成外部 Agent wire；CLI 使用实际 V4 server/App/Core 与合成模型。没有连接真实群、调用真实模型或读取日常凭据。

原生停止链首个红证据为 stop-chain-red.log：PM/执行者未收到控制；owned-work-red.log 证明原 CLI 不识别新事实命令；runtime-adapter-red-clean.log 证明原 SDK 无停止链能力。stop-idempotency-red.log 的自然语言 stop 被原严格 schema 拒绝。其余初次实现或夹具失败保留在证据目录，不冒称产品基线红证据；admission-stop-red.log 实际为通过的交错探针，也不计作红证据。

| 检查            | 结果                                                                                                                                                                                   |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 相关回归        | 5 文件 / 223 项通过；默认群/话题、原执行者控制、迟到派单、旧卡、真人与机器人来源、重建重投、跨 owner 同/不同调用、确认后新需求恢复，以及普通群兼容                                     |
| 实际 CLI        | 16 项项目/停止运行时、14 项工具测试通过；覆盖 ACK 先于真实结束、detached sidecar、held queue、文件保留和冷 record 未知租约。另有 184 项既有 V4 命令/交互/后台回归通过，CLI 合计 214 项 |
| 类型            | 根类型与完整 CLI 类型通过，CLI 32/32 任务成功                                                                                                                                          |
| Lint/架构       | 根 0 错误 / 97 条存量警告；CLI 0 错误 / 70 条警告、13 条原样上游行数诊断；架构 0 违规                                                                                                  |
| 固定官网 Reader | 官方 `3c5b2276` 读写本轮默认群/话题的隔离 Bot v3，Local 读回通过；2 输入、2 交接、1 条真实格式停止通知可读，Local 停止事实逐字保留。仅证明隔离 Bot 文件兼容，未覆盖 SQLite 或实际凭据  |

此前 full-unit.log 未产生完整汇总或退出码，不能计为完成；续跑第一次因临时 Corepack 缺少依赖在 Vitest 启动前失败。两份日志保留。保持 Node 24.14.0 / pnpm 10.33.2，通过隔离工具路径完成一次完整补跑：2061 文件通过、2 文件跳过；20117 项通过、10 项跳过，645.67 秒，退出码 0。完整结果及退出码见 full-unit-final.log/.exit；本轮没有沿用上一票的端口环境失败结论。

全量后 fixture 诊断 10→10，新增 0；本次实际临时 native app 完整签名验证通过，Identifier=dev.zcode.app、Signature=adhoc；已安装官网应用签名有效。未启动日常应用。未观察系统弹窗，不以签名或诊断记录冒充屏幕观察。变更范围格式检查通过，新增文档链接无失效；工具总规范有 4 条原有失效链接，与基线一致，本票未改动这些引用。

## Standards

独立规范轴初审无确认硬问题。可观测性建议已补正：稳定 task/phase/reason 保留，异常仅记录类型，不记正文或凭据。接口/端口循环、未受管新文件和公开方法数量由架构检查发现并整改；复审通过。未知 verifier 来源限制明确披露。

## Spec

独立需求轴发现 1 项 P1：不同停止调用的旧计划可能在新需求启动后才执行。现已将控制前重读、实际控制和确认写回与新需求恢复放入同一持久锁，并补跨 owner 回归；复审关闭，0 遗留问题。两轴均为只读静态审查，不冒充真实模型/群验证。

## 证据与复验

本机证据根：`~/.local/share/zcode-local/research/issue-11/`。复验命令见 commands.txt；关键记录包括 related-final.log、cli-runtime-focused.log、cli-tool-focused.log、runtime-contracts-fixed.log、cross-owner-stop-green.log、typecheck-complete.log、cli-typecheck-final.log、lint-final.log、cli-lint-final.log、architecture-final.log、review-summary.md、standards-review.md、spec-review.md、full-unit-final.log/.exit、fixture-audit.json/log、doc-links-final.json，以及 official/local-stop-group/topic-reader.log。

当前仅交付源码；不推送、不打包安装、不更新旧候选、不重启日常机器人，不开始 12。
