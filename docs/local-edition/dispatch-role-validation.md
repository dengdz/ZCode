# 06 派发职责与可信引用校验

Status: in-progress

工单：[06](../issues/zcode-local/06-dispatch-role-validation.md)。实现 `e8e697bc`，起点 `91fb69af`，分支 `3.16.2-local.1`。父规格冻结 blob `25efc393d4c8d5cf0fb44cbbd4ca8b04dd6c1387` 未改写。

## 交付行为

PM 先判断任务需要什么职责，再通过 ReplyToChannel 的 `requiredDuty` 声明；Host 按当前群配置精确比较。声明 APP、收件人职责为 Product 时，返回 `blocked/role_mismatch`，包含所需与实际职责及纠正说明，不产生新交接、实际发送或执行者任务。缺少声明返回 `required_duty_missing`；PM 面向执行者的追问也不能跳过检查。

比较沿用设置的自由职责字符串，去首尾空白后精确匹配，不猜同义词或忽略大小写。改名不改职责；模型和收件人选择不能修改配置职责。PM 对语义归类负责，代码只检查显式声明、身份与绑定；没有增加语义识别或 Jev。

派单可只选可信本机机器人，也可带一个当前任务有效来源中的原生 mention 引用。Host 从当前任务授权来源解析，引用须与目标已核验的平台身份一致；合法引用指向错误职责仍拦截。未知/失效/不匹配的引用、多个引用及未决名字或 candidateRef 返回 `reference_unavailable` 或 `recipient_mismatch`，保持未发送。完整候选卡片和原消息续发属于 08；本票不声称实现了卡片选择全链。

## 所有者与兼容

沿用同一协作服务、Host RPC 与渠道投递 owner。模块内 dispatchValidation.ts 只做纯职责/引用比较，无 IO、状态或发送。角色声明保存到 Local handoff 的可选字段；准备、最终发送和机器人入站受理都核对当前配置与职责。旧 PM→执行者关联缺少职责不能继续授权新受理；已有 sent 记录保留，不盲目重发。官网 Bot v3 和 SQLite 未扩字段。

工具 schema、描述、标记上下文及严格结果协议同步；blocked 直接作为原工具结果交给模型，不补发错误目标消息、不伪称投递失败或已发送。同一调用已发送后改参数，先报幂等冲突；同参重放优先复用原 owner 的收据，引用后来失效不能把既有 sent/unknown 说成未发送。引用范围沿用同任务当前授权下的有效来源输入，非任意历史或跨任务来源。普通未启用群继续用原 ref/name 解析。

## 验证记录

使用 Node 24.14.0、pnpm 10.33.2；所有身份、外部 HTTP、任务 SDK 输出为合成数据，真实 Bot 服务/Repo/Feishu 解析和请求组装参与。没有连接真实群或读取日常凭据。

| 检查 | 结果 |
|---|---|
| 相关回归 | 补正后 14 文件 / 353 项通过，其中 39 项可信交接，覆盖原生错误角色引用、身份/目标不符、未决选择、改名、精确匹配、发送前职责变更及原05链路 |
| CLI | 2 文件 / 16 项通过；职责转发和严格 blocked 结果不改写为成功，拒绝伪造收据字段 |
| 类型 | 根类型检查通过；CLI 顶层脚本因 turbo 不可执行失败，直接按现有包脚本检查 core/bootstrap/contracts 三个受影响包均通过 |
| Lint/架构 | 根 0 errors / 96 条既有警告；CLI 0 errors / 69 条警告，另 13 项原样上游行数存量；架构 0 新违规 |
| 全量 | 正在运行，待归档 |
| 两路审查 | Standards 首轮 0 项；Spec 首轮 1 项 P2，已补正，待独立复审 |

本机证据目录 `~/.local/share/zcode-local/research/issue-06/`。关键产品红证据为 `missing-duty-red.log`、`role-red.log`、`native-ref-red.log`、`idempotency-red.log`；最终相关 `related-review.log`、CLI `cli-first.log`，类型 `typecheck-review.log` 与 `cli-scoped-typecheck.log`。原生入站会正常发送已有排队提示，测试比较派单前后实际消息增量，未把正常入站提示误当作错误派单。

## Standards

首轮 0 项文档规范违规、0 项高置信度 Fowler 异味。状态所有者、纯校验边界、严格协议及工具链同步符合规范。

## Spec

首轮 1 项 P2：同参重放先进行新引用校验，较早引用来源停止后可能返回 blocked/“Nothing sent”，掩盖已发送或未知事实。补正将同参数持久投递优先交回原 owner，角色/引用校验只约束新的发送；sent/unknown 两类公开集成回归从红转绿，复审待收尾。

审查汇总：Standards 首轮 0 项；Spec 首轮 1 项 P2，补正后待独立复审。

## 本票边界

当前证明显式声明与绑定校验，不证明真实模型一定能正确归类任务。受控语义判断不冒充模型评测；08 卡片选择时仍需保存并复用原 requiredDuty，选人不授予改职责权限。07 静默、08 续发、09 串行与后续恢复/真实验收保持各自工单。

未打包、安装、替换应用或重启日常机器人。02 旧候选仍不含 04–06；日常切换继续按后续维护工单推进。
