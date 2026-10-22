# 08 候选卡片选择与原消息续发

Status: done

工单：[08](../issues/zcode-local/08-recipient-selection.md)，实现 `8e6913e2`，基线 `b24a2985`，分支 `3.16.2-local.1`。父规格冻结 blob `25efc393d4c8d5cf0fb44cbbd4ca8b04dd6c1387` 未改写。

## 交付行为

启用协作的群中，PM 可保留所需职责并省略派单目标，或在原生引用缺失/不匹配时请求候选卡。Host 保存原请求，返回严格 awaiting_selection 控制结果；卡片明确原消息尚未发送，候选标注配置职责。没有已核验且接入的候选不产生可发送卡片。职责本身错误仍按 06 拦截，不因选人改写。

合法用户点击后复核真实操作者、Provider/应用、原生卡片位置及消息 ID、群/话题、当前任务/输入/工作区、原授权和配置版本。合法选择替换收件人身份，保留原文、所需职责、原任务及原需求用户，经原 ReplyToChannel 请求和同调用 key 续发。工作投递后形成正常可信交接，执行机器人可受理且原生事件重投不重复执行。

取消、错角色、失效及过期均不续发；错角色关闭该卡，不能随后点正确角色继续派发。卡片期限 15 分钟。新候选卡使同输入旧卡失效；越权点击不改共享卡。卡片展示及本轮结束沿 07 抑制普通终答/空输出兜底；错误与阻塞提示保留。选择反馈更新原卡，UI 更新失败不会重发工作。中英文设置使用相应卡片和提示。

保留渠道既有 1–2000 字符限制，不能投递的总原文不先建卡；收件人与原文合计超限时关闭选择，不截断或改写原文。已经送达的卡片在过期后重投仍显示原收据，不改称未发送。

## 状态所有者与恢复边界

原 bot-collaboration owner 在原 Local sidecar 保存待发内容、候选快照和卡片/续发领取；原 Bot 群投递 owner 继续保存实际 sent/failed/unknown/invalidated。Bot v3 与 SQLite 不增加字段。replyRouting.ts 是同一 owner 内聚合回复准备和选择操作的私有实现，不持有额外状态服务或执行队列。

卡片领取在文件锁内持久化，出站时从原待选记录投影 SelectionPrompt，再交原 Provider 渲染；卡片结构不塞入 Bot v3。续发在同一锁内持久领取，只有第一次进入原投递链。两个独立 Service/Host 实例共享实际 Repo/FileLock 的并发路径已验证。

选定但未领取的有效记录可以在回调重投时继续；领取后崩溃且没有投递记录时仅报告待核对，不猜测是否已发送，不自动重发。已有投递记录优先读取原收据；外部接受后确认丢失保留 unknown，重启或重复点击不补发，不宣称外部恰好一次。更广泛的恢复编排留在 12。

普通未启用协作群的既有名字澄清方式保持；桌面 continuous / 手机 replayable 的任务事件广播不变，不新增 Host、运行时或接受队列。

## 验证

Node 24.14.0 / pnpm 10.33.2。真实 Service/Repo/Feishu Provider 解析和 HTTP 请求参与，任务 runtime 与外部 HTTP 应答为受控合成端口。相关回归 14 文件 / 390 项通过（可信交接 76 项），CLI 工具/权限 2 文件 / 18 项通过。根类型检查、完整 CLI 类型检查（32/32 任务）通过；根 Lint 0 错误 / 96 条存量警告，CLI 0 错误 / 69 条警告及 13 项原样上游行数诊断。架构检查 0 新违规，根和 CLI 分别使用自身 formatter 检查通过。

本机证据目录 `~/.local/share/zcode-local/research/issue-08/`。红绿记录为 selection、expired-receipt、content-limit；相关 related-final.log、CLI cli-tests.log，单场景含重启、并发、错误角色、取消、越权、原生位置、配置/任务/停止/过期、旧卡、未知结果、无候选、UI 更新失败及英文提示。

真实模型与真实群尚未验证，留在 18；当前为源码交付，未打包、安装或重启日常机器人，02 旧候选尚不包含 04–08。09 项目串行等后续工单尚未开始。

固定官网 `3c5b2276` 的隔离 Repo 已读取并写回本轮主聊天和话题选人续发产生的 Bot v3 数据，Local 读回通过，待发扩展索引逐字不变。证据为 official-group/topic-reader.log 和 local-group/topic-reader.log。此项证明隔离 Bot 文件兼容，不宣称重新验证了日常数据或 SQLite。

## Standards

独立规范轴审查 24 个变更文件，0 项确认违规，0 项高置信度新增 Fowler 异味。核对根、Services 与 CLI 规则、模块受控契约、运行时职责、术语及工具变更链。私有 replyRouting 提取没有引入第二状态所有者、执行队列或投递结果所有者；严格协议、异步 IO、公开包入口和合成集成测试边界符合约定。

## Spec

独立需求轴对照父规格 stories 28–32、38 及 T12–T15、T35，0 项确认问题。原文与职责保留、合法选择续发、未发送卡片与真实收据分离、错误选择闭合、操作者和原生位置复核、旧卡/并发/重启去重、未知结果保留和普通群兼容符合约定。真实模型及真实群验证继续留在 18。

审查汇总：Standards 0 项，Spec 0 项；固定比较 `b24a2985...8e6913e2`。

## 全量与环境披露

实现 `8e6913e2` 后运行一次全量：2059 文件通过、1 文件失败、2 文件跳过；20080 项通过、3 项失败、10 项跳过，耗时 350.35 秒，退出码 1。失败全部为既有 `webRemoteControlAuthGateFixture.test.ts`，固定 5173 被其他项目 Node 93626 占用（cwd 为 breakx/frontend，启动于 10 月 21 日）。未终止该项目、未修改无关测试，未将全量写为通过。证据为 full-unit.log、full-failure-port-owner.log。

全量后的只读审计：fixture 诊断报告仍为 10 份，新报告 0；本轮自编临时原生夹具的完整签名校验通过，已安装官网签名也通过。证据为 fixture-audit.json / fixture-audit.log。系统弹窗 UI 未自动观察；旧诊断保留，不据此宣称操作系统弹窗绝不再出现。03a 的原生夹具修复继续有效。

收尾仅更新验证报告、工单和索引，没有生产行为变化，不重复全量。父规格冻结检查及 35 条文档相对链接核对通过；两轴增量复核均无新增问题。

## 复验入口

固定 Node/pnpm 后，在源码根目录执行：

```sh
pnpm exec vitest run packages/services/test/botCollaborationHandoffs.test.ts packages/services/test/channelReply.test.ts packages/services/test/botGroupDelivery.test.ts
pnpm --dir apps/zcode-cli --filter @zcode/core exec vitest run tests/reply-to-channel.test.ts tests/channel-reply-permission.test.ts
```

完整 390 项相关范围见 related-final.log，CLI 范围见 cli-tests.log。单场景同时覆盖默认群和话题，包含实际工作发出后的原生事件重投不重复受理。
