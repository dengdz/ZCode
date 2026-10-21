# 07 纯确认轮静默

Status: done

工单：[07](../issues/zcode-local/07-silent-acknowledgments.md)，实现 `736e3200`，分支 `3.16.2-local.1`，开工基线 `fe767e60`。父规格冻结 blob `25efc393d4c8d5cf0fb44cbbd4ca8b04dd6c1387` 保持原样。

## 行为与边界

模型在纯确认、感谢或无需动作轮调用既有 ReplyToChannel，声明 `collaboration: {kind: "silent"}`，parts 为单个空 text。Host 从实际执行输入解析授权，在 Local 输入索引保存意图，返回仅含 status 的 silent 结果；不创建外部消息或 deliveryId，也不表示任务完成。各轮精简协作材料和工具说明均提供该用法，不根据关键词猜测。

协作群继续沿原 summary_changes 缓存模型流，admission 时不发送排队卡，等待/工作/终态表情保留；普通终答、空输出和长文本分片均在发送前遵循静默。用户配置 streaming_card 也不改变协作群的 summary 发送边界。真实错误、失败或拒绝工具以及权限/问答交互保留。没有静默声明的空结果提示检查状态，不补“任务已完成”。普通未启用协作群保持旧行为。

终态即使省略 inputId，也按实际运行来源重读 Local 意图。索引以当前 task/input/workspace/revision 隔离；重复静默调用只返回原接受事实，不覆盖后来的正式工作；原调用 key 改成正式发送拒绝。正式发送尝试先将意图改为 visible，较晚新静默调用不能抹去 sent/unknown/blocked 事实。普通发送仍复用原 Host/投递 owner，不撤回消息，不新增执行队列。

Local 意图与静默调用 key 只扩充既有 sidecar 的输入记录，官网 Bot v3 与 SQLite 格式不变。桌面 continuous 和手机 replayable 的任务事件仍按原链路广播，静默仅约束群侧显示。

## 验证

Node 24.14.0 / pnpm 10.33.2。真实 Bot Service、Repo、Feishu 原生入站解析和 HTTP 组装参与；外部任务 runtime 和 HTTP 应答使用合成数据。不连接真实群、不读取日常凭据。

当前相关回归 14 文件 / 370 项通过，包含 56 项可信交接；CLI 工具与权限 2 文件 / 17 项通过。根类型检查及完整 CLI 类型检查通过（32/32 任务）；根 Lint 0 错误 / 96 条存量警告，CLI 0 错误 / 69 条警告，另 13 项原样上游行数诊断；架构 0 新违规。两路审查结果见下文。

证据目录：`~/.local/share/zcode-local/research/issue-07/`。产品红/绿证据包括 silent、terminal、error、replay；相关测试 `related.log`、CLI `cli-tests.log`、类型 `typecheck-final.log` 与 `cli-typecheck.log`。

真实模型是否遵循意图说明及真实群验收保留在 18。当前源码交付尚未打包安装或更新 02 的旧候选；未替换运行中的日常应用。08 选人卡片及后续串行/长链/停止与恢复按各自工单推进。

## Standards

独立规范轴审查 18 个变更文件与 hunks，0 项确认违规，0 项高置信度新增 Fowler 异味。核对了原状态所有者与文件锁、严格协议、CLI 工具变更链、运行时职责、中文修复注释及实际 Service/Repo/Provider 集成边界。

## Spec

独立需求轴对照父规格 stories 23–25、发送静默契约与 T08–T10，0 项确认问题。完整静默边界、空结果不冒充完成、正式工作与错误/阻塞保留、重放与输入隔离、普通群兼容均符合约定。真实模型/群验证仍明确保留在 18。

审查汇总：Standards 0 项，Spec 0 项；固定比较 `fe767e60...736e3200`。

固定官网 `3c5b2276` 的隔离 Repo 已读取并写回本轮主聊天和话题短链产生的 Bot v3 文件，Local 读回通过，Local 扩展索引逐字不变。证据为 frozen-group/topic.log、local-group/topic-reader.log。此项证明隔离 Bot 文件兼容，不宣称重新验证了日常数据或 SQLite。

## 全量与环境披露

实现 `736e3200` 后运行一次全量：2059 文件通过、1 文件失败、2 文件跳过；20060 项通过、3 项失败、10 项跳过，耗时 362.43 秒，退出码 1。三项失败均为既有 `webRemoteControlAuthGateFixture.test.ts`，固定 5173 被其他项目 Node 93626 占用（cwd 为 breakx/frontend，启动于 10 月 21 日）；未终止该项目，未改无关测试，未将全量写为通过。证据为 full-unit.log、full-failure-port-owner.log。

全量后的只读审计：fixture 诊断报告仍为 10 份，新报告 0；本轮自编临时原生夹具 `zcode-local-launch-ydehON/official.app` 的完整签名校验通过，已安装官网签名也通过。证据为 fixture-audit.json / fixture-audit.log。没有读取或宣称自动观察了系统弹窗 UI，旧诊断报告保留。

CLI 子项目使用自身 formatter 检查；首轮发现新测试未格式化，按 CLI 规则补齐格式后通过并重跑工具测试。该补充只有测试排版及最终文档，无生产行为变化，不重复全量。根和 CLI 分别记录 format-final.log、cli-format.log；最终类型、Lint、架构及父规格冻结检查一并留档。

## 复验入口

固定 Node/pnpm 后，在源码根目录执行：

```sh
pnpm exec vitest run packages/services/test/botCollaborationHandoffs.test.ts packages/services/test/channelReply.test.ts packages/services/test/botGroupDelivery.test.ts
pnpm --dir apps/zcode-cli --filter @zcode/core exec vitest run tests/reply-to-channel.test.ts tests/channel-reply-permission.test.ts
```

首条当前为 100 项，第二条为 17 项。完整 370 项范围与结果见 related.log。实际模型与群验证尚未执行；本轮交付源码，安装候选仍为 02，不包含 04–07。
