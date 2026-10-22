# 10 合法协作长链受理

Status: done

工单：[10](../issues/zcode-local/10-collaboration-chain-admission.md)，基线 `63b229f2`，分支 `3.16.2-local.1`。父规格冻结 blob `25efc393d4c8d5cf0fb44cbbd4ca8b04dd6c1387` 不变。

## 行为与兼容

启用协作的群先经原协作所有者核对原生身份、群/线程、配置版本、职责、当前来源任务/输入及渠道投递 owner 的 sent 收据。只有当前授权结果为 allow 的消息不再受连续五条计数截断；不能仅凭机器人发送者、Local 宿主开关、正文自报身份或原生提及取得豁免。

原 Bot 入站守卫仍在停止、准备和受理前持久登记消息 ID，重复事件不重新提交。计数到五后饱和，保留官网 Bot v3 的严格 0–5 格式；未启用群、停用群及非 Local 宿主继续使用原五条限制，只有新的真人输入恢复原额度。withInbound 的配置协调、bindInput 的授权重查、07 的完整 silent 投递边界和 09 的固定项目串行范围保持。

无新增队列、所有者、持久字段或模型语义分类。PM 判断正常阶段交接和整改是否无进展；代码只核对可信显式声明。三轮整改与依赖推进属于 13，真实停止与广泛恢复分别属于 11/12，真实模型与真实群验收留 18。

## TDD 与验证

使用 Node 24.14.0 / pnpm 10.33.2；临时存储、合成飞书身份、受控任务 SDK 和外部 HTTP 端口，真实 Bot 服务、协作所有者、Repo、Provider 解析及请求组装参与。没有连接真实群、调用真实模型或读取日常凭据。

首个公开接口回归在默认群和话题的第 11 次交接失败：接收方已有五条机器人输入，第六条没有受理（long-chain-red.log）。第一次移除受限判据后暴露 v3 计数字段不能写 6，兼容补正采用饱和计数（long-chain-green.log 保存该失败，long-chain-compatible-green.log 两项通过）。测试准备阶段曾遗漏停用请求必填字段，并把同一平台消息 ID 先伪装成其他发送者再当合法消息投递；已修正合成输入，保留 chain-guards.log，不将这类夹具问题当作产品红证据。

| 检查            | 结果                                                                                                                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 长链与原群防护  | 2 文件 / 196 项通过；四个长链场景覆盖默认群/话题、16 次原生交接、中途服务重建、并发与持久重投、最终汇报或 silent 收口。另覆盖 Local 宿主停用群仍受五条限制、旧真人重投和新真人恢复额度              |
| 类型            | 根类型检查通过，完整 CLI 类型 32/32 任务通过；本票无 CLI 源码变更                                                                                                                                   |
| Lint/架构       | 根 Lint 0 错误 / 97 条存量警告；架构 0 新违规                                                                                                                                                       |
| 固定官网 Reader | 官方 `3c5b2276` 读取并写回本轮默认群/话题长链的隔离 Bot v3，Local 读回通过；双方计数仍为五，17 个输入关联、16 个交接和 Local 文件逐字保留。仅证明隔离 Bot 文件兼容；SQLite 与实际凭据不在此证明范围 |

一次全量使用仓库支持的 `ZCODE_TEST_POOL=forks pnpm test:unit`，保持完整范围并采用进程隔离：2059 文件通过、1 文件失败、2 文件跳过；20090 项通过、3 项失败、10 项跳过，1201.20 秒，退出码 1。失败全部为既有 webRemoteControlAuthGateFixture，日志明确显示 Port 5173 is already in use；其他项目 Node 93626 自 10 月 21 日占用该端口，cwd 为 breakx/frontend。未终止其他项目、未改无关测试，未记全绿。

全量后原生 fixture 诊断 10→10，新增 0；本次实际临时 native app 完整签名验证通过，Identifier=dev.zcode.app、Signature=adhoc；已安装官网应用签名通过。03a 修复继续有效。未自动观察系统弹窗，不以签名和诊断记录冒充屏幕观察。变更范围格式、文档链接和父规格冻结检查均通过。

## Standards

独立规范轴对照根/Services AGENTS、词汇表、运行时边界和架构契约，0 项确认违规、0 项需整改的新增 Fowler 异味。只读源码审查，不将其称为独立运行时验证。

## Spec

独立需求轴对照 stories 17/41、T11/T12 及本票实施合同，0 项确认问题。合法长链、原群保护、可信来源、持久去重、静默和项目串行范围符合合同；合成输出证明机制，不证明真实模型按章程持续推进。

## 证据与复验

本机证据位于 `~/.local/share/zcode-local/research/issue-10/`；关键记录为 long-chain-red.log、long-chain-compatible-green.log、chain-guards-final.log、long-chain-replay-final.log、typecheck-first.log、cli-typecheck.log、lint.log、architecture.log、format-final.log、doc-links-final.log、full-unit.log、full-failure-port-owner.log、fixture-audit.json/log、review-summary.md、standards-review.md 和 spec-review.md。固定官网 Reader 的四份日志按 official/local-long-chain-group/topic-reader.log 命名；完整复验命令见 commands.txt。

```sh
pnpm exec vitest run packages/services/test/botCollaborationHandoffs.test.ts packages/services/test/botsService.groups.test.ts
```

当前仅源码交付；未推送、未打包安装、未更新 02 旧候选、未重启日常机器人，11 尚未开始。
