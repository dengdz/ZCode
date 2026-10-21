# 05 可信交接与原需求用户归属

Status: done

工单：[05](../issues/zcode-local/05-trusted-handoffs.md)。父规格固定 blob `25efc393d4c8d5cf0fb44cbbd4ca8b04dd6c1387`，未改写。源码起点 `d17b18ce`，集成分支 `3.16.2-local.1`。实现 `7317fa0e`，审查补正 `1a46a276`；本报告及工单归档另行正常提交。

## 交付行为

只在明确启用的 Local 协作群生效。授权用户向 PM 提需求，直发执行者得到经 PM 派单的引导；其他真人不能创建、停止或批准任务。PM 使用明确 dispatch/question 意图向配置中的执行者发送，执行者使用 report/question 向 PM 回报，PM final 面向原需求用户。模型不能指定原需求用户或平台 ID。

机器人收到原生提及也不能自行建立任务来源；还必须匹配同群同线程、当前配置版本、合法方向、平台原生发送者和消息 ID，以及既有投递 owner 确认的 sent 事实。未知回执、来源输入已停止/取消/丢弃及失效成员拒绝受理。目标群停用、项目权限撤销或固定项目不在目录时，发送前拒绝。

原需求、输入关联和交接索引由既有协作服务维护到 `.zcode/local/v1/collaboration.json`，不存正文、不复制执行队列。发送及结果继续走已有 ReplyToChannel → Host RPC → 渠道投递 owner；重放使用原幂等键，仅返回原回执。所有者给 CLI 输入附加标记明确的精简上下文；官网 Bot v3 来源和 SQLite 格式未扩字段。

普通 PM 终答和显式 final 都从可信输入关联选择原需求用户，不随执行者回报改成机器人。执行者普通终答不构造新的机器人交接；完整无动作静默仍属 07。首次可信派单可沿既有入口创建执行者话题，既有话题显式停用不能重开。

## 修复依据

- 首条合法输入：04 的配置版本轮换通过普通 context 写入时被旧授权保护丢弃，随后合法输入报授权改变。现按显式授权更新写回，受理回归从红转绿。
- 话题重放：新建对象与 schema 重读对象字段顺序不同，字符串比较误报 stale。两端通过同一严格 schema 规范后比较；同一调用在默认群及话题内只产生一次实际发送。
- PM 终答：既有 createOutbound 默认提及当前消息发送者，覆盖了正确来源。协作结果发送时明确采用可信原需求目标，保留原消息来源用于审计。
- 首次话题与迟到交接：只对已核实的渠道交接放开话题初次接入；停用、来源已停止、伪造发送者及未知结果仍拒绝。长链额度、真实停止和恢复分别留在 10/11/12。

- 发送等待窗口：准备与实际发送之间发生目标群/项目权限/配置撤销时，原 owner 的最终授权检查拒绝发送并记录 invalidated。Local 持久 schema 单独集中在 ledger.ts，读写仍是同一服务。

## 验证记录

Node 24.14.0、pnpm 10.33.2；全部使用临时存储及虚构身份。Provider 解析及 HTTP 请求组装、Bot Repo、协作所有者和运行时接线使用生产实现；外部任务 SDK 与 HTTP 端口可控，不连接真实平台或模型。

| 检查 | 记录 |
|---|---|
| 可信交接 | 补正后 25 项通过；覆盖默认群/话题短链、原生发送目标、服务重建后 final、普通终答、重放、越权与迟到拒绝、首次话题及停用，以及等价工作区身份、发送前并发撤销 |
| 相关回归 | 补正后 14 文件 / 339 项通过。首轮有 1 项 04 用户提示回归，目标停用校验已收窄到发送目标，原断言不变 |
| CLI | ReplyToChannel 与权限两文件 15 项通过；实际执行 inputId 仍取 assistant 父消息，严格拒绝模型原用户字段 |
| 固定官网 Reader | 对默认群及话题真实短链产生的隔离 Bot v3 文件，以官方 3c5b2276 独立 worktree Repo 读取并写回；Local 读回及索引逐字保留均通过。只验证 Bot 文件，SQLite 沿用 03/04 证据 |
| 类型/Lint/架构 | 补正后根类型检查、CLI core 类型通过；根 Lint 0 errors、96 条既有警告，CLI Lint 0 errors、69 条警告（另 13 项原样上游行数存量）；架构 0 新违规，代码格式通过 |
| 全量 | 实现检查点启动的一次全量：2059 文件通过、1 文件失败、2 文件跳过；20023 项通过、3 项失败、10 项跳过，347.49 秒。3 项均为既有 webRemoteControlAuthGateFixture 固定 5173 被其他项目开发进程占用；未改测试、未停止其他项目，未记全绿。随后审查补正以 339 项相关回归验证，未重复全量 |
| 两路审查 | 首轮 Standards 2 项 P2、Spec 1 项 P1，补正后独立复审全部关闭，最终 0 项遗留；Spec 原竞态探针不改断言独立重跑 1 项通过 |

本机原日志位于 `~/.local/share/zcode-local/research/issue-05/`。红证据包含 `authorization-red.log`、`pm-admission-red.log`、`dispatch-red.log`、`chain-red.log`、`thread-replay-red.log`、`stopped-red.log`、`target-red.log`；夹具准备失败不当作产品红证据，最终结果以对应 green/最终日志为准。补正回归 `related-review.log`，身份红证据 `identity-red.log`，发送竞态 `send-race-red.log` 与 `review-second-green.log`；独立竞态复审 `spec-race-probe/retest.log`。固定 Reader 为 `frozen-group.log`、`frozen-topic.log`、`local-group-reader.log`、`local-topic-reader.log`；全量和端口归属分别为 `full-unit.log`、`full-failure-port-owner.log`。类型、Lint、架构、格式见 `typecheck-final-head.log`、`lint-review.log`、`cli-lint.log`、`architecture-review-second.log`、`format-review.log`、`cli-format.log`。

## Standards

首轮 2 项 P2：工作区身份原值比较误拒等价 key，逐消息诊断使用 info。已沿用统一身份 key 并补三类发送回归，日志改为 debug。生产结果仍可从原投递事实及 Local 关联记录核查。独立复审确认两项关闭，无新增规范问题。

## Spec

首轮 1 项 P1：准备后目标授权撤销仍可能实际发送。现由原投递 owner 在最后发送检查中重读 Local 版本、来源及目标授权，撤销进入 invalidated 终态；同一 owner 不再将授权失效当作网络 failed 重试。三类并发撤销从红转绿，独立复审确认关闭，原仓库外探针实际 0 次发送、invalidated 回执，退出码 0。

审查汇总：Standards 首轮 2 项 P2，最终 0 项；Spec 首轮 1 项 P1，最终 0 项。全量的环境失败独立保留。

## 本票边界

合成短链证明机制，不能证明真实 PM 模型已能正确拆单、审核或长期推进。职责语义校验、完整静默、候选卡片、项目串行、长链、真实停止、恢复及用户验收仍在 06–13/18。本票不改变桌面持续流与手机可恢复链、Host owner/lease 或 CLI CommandInbox。

未连接真实群、未读取日常凭据、未安装或重启日常应用。02 已签名候选仍是 02 源码，不包含 04/05；日常安装与切换按后续工单推进。

## 复验入口

在本机固定 Node 24.14.0 与 pnpm 10.33.2 后，从仓库运行以下范围；测试默认使用临时数据，不接管日常机器人。

```sh
pnpm exec vitest run packages/services/test/botCollaborationHandoffs.test.ts packages/services/test/botCollaborationSettings.test.ts packages/services/test/channelReply.test.ts packages/services/test/botGroupDelivery.test.ts
pnpm --dir apps/zcode-cli --filter @zcode/core exec vitest run tests/reply-to-channel.test.ts tests/channel-reply-permission.test.ts
```

首条补正后为 95 项，CLI 为 15 项。完整 339 项相关范围见私有日志；全量未通过的原因与结果保持上述披露，不以定向通过替代全量通过。
