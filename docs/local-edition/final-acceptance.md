# 18 整体验收记录

Status: in-progress

对应[18 工单](../issues/zcode-local/18-end-to-end-acceptance.md)。父规格 [T01–T36](spec.md#验收场景矩阵) 为唯一验收矩阵；本报告只定位证据，不重写场景定义。当前不代表用户已验收。

当前落点：运行中的 `71e8ae055174a2bf371a4f5de4412a1bb3301028` / local.3 已证明回执绑定修正生效，但真实需求没有协作 report/PM final，且 PM Edit 项目外台账，整体验收失败。用户随后批准提示范围及显式只读约束修正；新实现已完成隔离回归，待固定源码复审与下一候选。运行应用尚未切换，18 保持 in-progress；未重发需求或恢复真实数据。

## 基线与范围

初始回归业务源码固定于 `f2dfa97ff78e28abe48918d2348a3ce43ee25efe`，最终 17 源码为 `ca707b5f600c1924c14fb9d07ebe1aecdefde4b3`。真实启动前备份暴露的插件链接边界已获用户确认，维护脚本补正源码为 `8c752d581e8880db2533df11b5dc5018a5a2d837`；后续接收观察能力及候选端点见本报告末节，不改变原业务路由。父规格冻结 blob `25efc393d4c8d5cf0fb44cbbd4ca8b04dd6c1387` 保持不变。

本机私有证据根为 `~/.local/share/zcode-local/research/issue-18/`。新测试使用隔离 HOME、合成身份和业务数据；测试入口、命令、时间、源码与退出码保存在各检查 JSON/日志中。根全量单测未执行，affected 的全选/跳过也不视为全量通过。

## 当前验证

- 根相关测试 27 文件 / 647 通过、1 专用子进程入口跳过；涵盖群协作/投递/卡片/停止/恢复、原服务兼容、Local 更新/身份、启动所有权及共享契约。
- CLI 工具 3 文件 / 33 通过；V4/项目执行、原 CommandInbox/持久化 6 文件 / 169 通过。均为受控模型与渠道边界，不能证明真实 PM 的语义判断。
- 设置界面 5 项通过：原生核验、生产 RPC 编解码、服务保存/重建读取、忙碌拒绝、其他群隔离及 1000/390 宽度、两种语言/主题。它是隔离 UI 夹具，不是日常应用的全引导流程。
- 根类型检查通过；CLI 32/32 turbo 类型任务成功（缓存结果如实保留）；根 Lint 0 errors / 97 存量 warnings，CLI 0 errors / 70 warnings / 13 条原样上游行数诊断。
- 维护/备份/安装/恢复首批 79 项中 78 通过、1 失败：owner 冲突用例期望 install-startup-unconfirmed，实际提前返回 install-exit-unconfirmed。其本机记录已有 accepted 响应，结束后 owner 已清理；原因未确认，不将并发/调度猜测当根因。原批次退出 1 保留。该用例独立复跑 1/1 通过，完整到达冲突分支并核对新目标、previous 与有效备份。
- 两次真实候选维护入口内的 45 项维护/备份检查通过；是重复验证，不与首批数量相加。实际构建中的类型/Lint/架构及依赖/闭包审计通过，affected 官方全选后按仓库合同跳过根 UT。
- 架构 0 新违规；scripts 运行语义由命令场景验证。仓库级 fmt:check 实际退出 1，报告 2143 个文件，未记全绿、未改写无关格式。

历史 01–17 工单均为 done；本机 issue-13 原始证据目录当前不存在，13 的历史报告仍可读，不能声称重新验证了缺失的原始日志。本轮重新执行协作与 CLI 机制回归；历史真实应用、官网 Reader、凭据计数等按原报告的源码和范围引用，不当作当前真实群验收。

## 证据定位与公开边界

[证据索引](acceptance-evidence-index.json) 为 T01–T36 每个 ID 提供原工单、当前检查、历史证据及限制，不包含场景定义。T19/T20/T23 的真实模型语义、T27 当前凭据/连接、T36 真实群均待验收；T25 官网 Reader 保留为历史证据；T30 未发布标签。

真实维护 check 通过 GitHub API 再次观察官方 main=`3c5b2276`、版本 3.16.2、latest release=`v3.14.3`。公开历史扫描检查 540 个本地新增/修改 blob，上游精确等价补丁为空、blockers 为空；这不替代语义审阅。Local 诊断调用与适配器的审阅确认：路由仅写 scope/动作/结果和 input/delivery/requirement/revision 元信息，经 createServiceLogger 的 debug 输出；停止/恢复警告写阶段、原因及 error 类型。未在已审阅新增路径发现正文采集或新增上传目的地，不扩大为全部既有日志审计。候选准备阶段未读取日常日志或提取凭据；启动后诊断仅计数匹配的已知告警，不收集消息正文。

## 首次真实运行候选（历史）

首次真实运行的 ready 候选清单位于本机私有 `${HOME}/.local/share/zcode-local/research/issue-18/candidate-2/candidate.json`，完整源码 `cd6bc0f23b0bc18ec8f6b7a50f6c5e3ee3370e36`，展示/分支版本 `3.16.2-local.1`。相对 f2dfa97f 仅增加 18 初始验收文档，无业务代码变化。该应用路径已由后述原安装入口切换为 local.2；旧清单保留为历史，不能再用它验证该路径的现有应用。

- 应用：`artifacts/mac-arm64/ZCode Local.app`；身份 dev.zcode.app.local，平台短版本 3.16.2 / 内部版本 3.16.2001，维护协议 1。
- 标准维护入口完成 ASAR/package/build-meta、源码、完整应用树、deep/strict 签名、完整 ZIP 成员与只读 DMG 内容核对；随后独立重新核对源码/元数据、签名、完整应用树和两个归档 hash。
- 首次 candidate-1 已生成签名应用与 ZIP，但 dmg-builder 工具下载 ETIMEDOUT，无 ready 清单。重试使用全新 candidate-2，复用 issue-14 先前已验证的完整 dmg-builder 1.2.0 工具缓存到新隔离 HOME，继续执行原构建链；没有新建打包链、关闭主机/签名校验或手写 ready 清单。
- 原 `/Applications/ZCode.app` 只读 deep/strict 签名检查通过；准备阶段未启动、安装或接管日常数据；后续受控启动结果见下文。预期发布标签仅记录，未创建或发布。

## 真实群门禁

用户已私下指定唯一群、PM 和一名产品执行者，并先确认尚未启动 ZCode Local，随后确认已结束相关任务并正常退出官网应用。名称与真实标识保存在私有证据中，公开材料不写群名、chat ID、人员/机器人身份或消息正文。

本机 `/Applications/ZCode.app` 的身份是 `dev.zcode.app`，版本 3.16.2、源码 2469e253，无 Local 维护协议；开工时该官网应用正在运行；用户确认退出后，本轮进程核对未发现其应用/Host 进程。没有在常用 Applications 目录发现 Local。不能用官网应用证明 Local 协作可用，也不能因进程存在就断言群空闲。

业务验收需求尚未发起。后续 Local 已实际受控启动并完成群空闲核对（见下文）；原生身份、授权用户、协作绑定保存和真实模型遵循仍待执行。凭据由既有机制使用，不提取或输出秘密，不强制退出官网应用。只有用户明确验收后，才可将整体视为通过；父 spec 保持原状态。

## 待执行真实流程

以下是有限验收步骤清单，详细定义仍引用父规格，不替代矩阵。执行前对照本机私有目标记录核实原生身份，并以真实 owner/任务/租约证据确认群空闲。

1. 授权用户向 PM 发出带唯一验收标记的只读需求，限定执行者读取绑定项目内一个无敏感内容的现有说明文件并回报依据；PM 核对后原生提及原需求用户，保持待用户验收。没有明确验收前不关闭。
2. 在同一范围内验证纯确认静默、正式追问/派单可达、错误角色保持未派发、歧义卡片选择一次及旧卡片失效；不人为伪造平台身份。
3. 用有限且有明确终点的只读检查分步交接超过五条，观察同项目实际串行。三轮无进展与依赖判断须记录真实模型行为，不能注入预置答案冒充成功。
4. 仅叫停本次验收任务，观察真实前台/后台及后续派单停止；不停止其他用户工作。停止或恢复事实不明时保留状态并结束该项。
5. 在不打断日常应用的条件下验证恢复核对。若必须重启、切换或人为断线，先把具体操作和影响交用户决定；不制造真实外部投递不明并盲目重发。
6. 按真实可见结果逐项记录 pass/fail/limited/not-run；对 T19/T20/T23、真实连接与凭据保留实际限制。形成最终报告后交用户明确验收。

## 交付状态

隔离证据与 ready 候选已准备，真实群与用户最终验收待执行；用户确认插件链接补正并继续后，18 回到 in-progress。用户结束任务并退出官网的步骤已完成；下述备份外链门禁现已解决，原受控启动和空闲核对通过，接下来核实指定群的原生身份/授权/绑定；不使用普通双击绕过互斥。真实步骤不改业务代码、不部署、不制造未授权中断。

父 spec 不关闭，18 不标 done。首批安装断言失败及真实群/凭据/标签/当前运行验证缺口均保留。证据根内各检查 JSON 记录命令、退出码与源码；候选自身的 source 独立记录，避免把文档端点与业务源码端点混淆。

## 候选哈希

应用树 SHA-256：`29a6ebe405d6f327171d407c704b1fab39b24e58489734b7c3ed95bac5c37de1`。

- `artifacts/ZCode Local-3.16.2-local.1-mac-arm64.dmg`：204582229 bytes，SHA-256 `691259fdf917fc35860d9fcbe3824d5a3906e2dd7aafcbc121dd802d1154e934`。
- `artifacts/ZCode Local-3.16.2-local.1-mac-arm64.zip`：195279719 bytes，SHA-256 `c0b4eea98fce3bfb3094dd63be89544db00085e15ab118569139c1b8d3e81e46`。

## 复审与归档

固定比较 `f2dfa97f...6b424008`，Standards / Spec 两个独立代理分别审查公开差异和合成证据，均无可操作发现。复审确认真实群与用户验收属于明确披露的未完成门禁，ready-for-human 不代表整体通过。

干净提交上的 pre-push：schema 8 项、架构工具 36 项、Lint 和架构检查通过；本次仅文档/证据修改，affected 官方选择 0/2063，没有执行所选外测试。变更范围格式、36-ID 索引完整性、53 条文档链接、真实目标名称不入公开材料及冻结父规格核对通过。候选构建过程中基于官方源的 affected 全选/跳过与本次文档 pre-push 的 0 项选择分别记录，不混为一次运行。

## 真实启动前新增阻塞：插件外链备份

用户确认退出后，已观察不到官网应用/Host 进程。启动前通过既有维护入口读取 bootstrap 的 dataBaseDir 定位真实 home/data，参数一致；未输出其他设置。随后尝试保护现有数据的备份，入口在源树核验阶段以 `backup-external-link` 停止，尚未生成 payload 或 ready 备份。原官网应用保留，Local 未启动，真实群消息仍为 0。结束后核对 owner 与 switch-gate 均不存在，未留下运行占用。

只读核对链接元数据，定位到 3 个现有 CLI 插件 cache/marketplace 路径下的 AGENTS.md 或 skills 符号链接；真实目标路径仅保存在本机私有记录，未移动/删除链接、未读取目标 Secret、未复制其范围外目标内容。15 现有契约拒绝范围外链接，因此不能绕过校验或把失败备份说成可恢复基线。此前“未接触日常数据”的陈述限于隔离阶段；本次尝试已由用户允许的启动前安全流程访问所选数据元信息及文件哈希，未解密或输出凭据。

用户已明确确认“按此边界补正并继续验收”：对明确限定的 CLI 插件资源目录，备份符号链接对象本身并在清单标明外部依赖；不跟随目标，不复制/覆盖目标内容，其他业务外链继续拒绝。恢复时仅恢复已确认链接对象并核对记录，不能声称外部目标也已恢复。15/17 已先更新局部合同，并补充命令级备份、独立 verify、恢复及未知业务外链拒绝回归；不排除整个插件目录，也不移改日常链接来让测试通过。

这是实际输入暴露的备份边界缺口，已按 AGENTS.md“发现设计缺陷时先与用户对齐”完成对齐。18 回到 in-progress，补正通过验证和复审后重试当前数据保护备份，再受控启动既有 ready 候选；真实群及最终用户验收仍未完成，18 不记 done。该修正仅涉及仓库维护脚本，应用业务源码与 ready 候选不变，分别记录两端源码。

## 插件链接补正验证

维护脚本端点 `8c752d581e8880db2533df11b5dc5018a5a2d837`，应用候选仍为 `cd6bc0f2`。先由新增命令级场景得到 backup-external-link 红灯，再实现显式策略，新增 6 项绿灯；完整维护/备份/安装/恢复串行进程回归 85/85 通过（含原 79 项及新增 6 项）。缺失目标仍可独立 verify，合成外部目标修改不被恢复覆盖，旧/篡改清单与例外根目录外链仍拒绝。该结果不代表真实数据恢复已执行。

根类型、Lint 0 errors/97 存量 warnings、架构 0 新违规和变更格式通过；pre-push 的 schema 8/架构工具 36、Lint/架构通过，affected 选择 0/2063。全仓格式失败与首批安装失败继续按前述保留。固定范围 `32fc9e01...8c752d58` 两个独立复审：Standards 0 项、Spec 0 项。

临时工具链重新核对：Node 24.14.0，pnpm 10.33.2。此前临时 pnpm 链接实际指向全局包 10.33.3，新的隔离 HOME 下会自准备所需版本；本轮终止了这三条尚未开始检查的准备进程，改用已有已核对的 10.33.2 缓存建立本次私有链接后执行成功。没有改全局工具链、依赖或仓库声明。

## 真实启动前备份复验通过

补正后使用显式选择的实际 home/data、既有候选及私有备份根，经原 backup 入口成功生成 ready 快照；另一次 backup-verify 独立恢复演练、SQLite integrity 和完整应用验签/源码核对通过，均退出 0。清单记录 3 个插件链接依赖，原 3 个链接对象保持不变；没有跟随或覆盖外部目标。备份保护的是待启动 Local 候选与现存共享业务数据，官网包仍原位保留，不把它描述为此前已运行 Local 的备份。未执行实际数据恢复。

原 backup-external-link 失败证据仍保留，本次成功不重写首轮结果。备份与独立核验原始日志/清单留在私有证据根，公开材料仅引用结果与边界。随后已按下文经原受控入口启动。

## 真实受控启动与群空闲核对

原 `local:launch` 脚本经显式选定的实际 home/data、官网路径与已验签 Local 路径启动候选；owner 为 running，存活 launcher/应用 PID 与 runtime 的 token、PID、3.16.2-local.1 版本及 ready 一致。调试端口仅监听 127.0.0.1。官网应用仍未运行，未替换其包；本次 Local 直接运行私有候选，使用版本独立的 Electron profile 和共用业务根。启动不是恢复旧快照，也未执行实际数据覆盖。

真实 UI 读取原有群会话和机器人，指定执行者显示飞书 WebSocket 运行及“已连通”。仅据此确认该现有应用连接状态，不当作所有模型、所有凭据或 PM 协作已验收。初次协作界面因 busy/未确认锁住；只读检查选定群 7 个上下文、6 个当前任务及 11 个相关任务引用，无远程上下文、无 pending/unknown 投递。调用现有任务服务的 block-reason 与 owned-work 读接口，首轮 6 idle/5 busy，随后 11/11 idle、无前台/队列阻塞；刷新后设置门禁解除。没有清租约、停止或重发任务，具体 busy 项未进一步归因。

核验前群协作为 revision 0、未启用（后续进展见下节）。只为用户指定的 PM 与一名执行者生成两个原生身份核验挑战，等待同一既有绑定用户在原群原生 @ 确认（10 分钟有效）；一次命令与真实身份只保存在私有材料，不写公开报告。此步必须由真人渠道完成，不能从桌面脚本伪造原生身份。尚未保存协作配置、尚未发起只读验收需求，18 继续 in-progress，最终用户验收未完成。Local 保持运行，未知状态时不擅自退出或切换。

受控启动文档增量固定复审 `8c752d58...23c5726e`：Standards 0；Spec 发现 1 项 P3（把 busy→idle 写成具体后台工作自然结束），已改为两轮权威观察事实，保留未清租约/未停止/未重发和未归因边界。该修正仅为证据表述，不改变运行代码。

## 原生身份核验与实际配置已完成

前两组一次命令过期的事实保留；没有把用户“已发送”直接当作核验成功。最新一组命令经原 Provider 入站后，两名指定机器人均显示 verified/connected，同一群只有一个已核验授权用户。真实原生身份已成立，不是从机器人名称或手工写入身份字段推断。

在确认群空闲后，通过真实协作设置 UI 仅选定指定 PM 和一名产品执行者，填写本轮只读职责、选择该原生用户及双方原有群任务所用项目；保存后 UI 显示 revision 1，另经原服务读接口重读确认 enabled、角色、职责、项目和两名已核验接入身份一致。没有新增其他执行者、扩大原项目范围或提取凭据。

真实只读需求已准备，选用绑定项目内确实存在的一份说明文档，要求执行者回报标题、已有命令及文件/行号，由 PM 审核后原生回复原需求用户并等待明确验收；项目根没有原计划默认 README，因此请求改指既有子目录说明，没有新建文件。此时 Local 需求与输入关联均为 0；在请求受理前保存了项目 Git status/diff 指纹作为后续核对起点，保留既有改动。尚未发起任务，不把配置保存当作 PM 派单、实际模型判断或交付闭环通过。接下来必须由该真人账号发送初始需求；脚本不能用机器人身份冒充用户。

本轮只新增验收记录，运行代码保持 `8c752d58` 的维护补正及 `cd6bc0f2` 的应用候选。原 85 项回归、类型/Lint/架构及已披露失败仍按各固定端点引用，不因本次真实配置操作冒称重新执行。

## 真人需求已受理，执行者入站待核对（2026-10-24）

用户确认已通过同一真人账号在指定群原生提及 PM 发出既定只读需求。随后实际 Local 记录为 1 个 active 需求、1 个输入、1 个可信交接关联、0 个在途入站协调记录；PM 的 dispatch 阶段为 settled。原投递记录为 sent 且有 Provider message ID，原生 channelMention 的 bot/open_id 目标与已核验执行者身份一致。该结果只证明真人入站及 PM 派单发送，不能证明执行者收件、执行或回报，更不代表 PM 已审核或用户已验收。

截至本次观察，尚无执行者对应输入；既有机器人运行状态为 connected，不能由此推断事件已送达。项目 Git HEAD/status/diff 在派单后的核对中与请求前指纹一致；此检查不扩大为全部文件内容审计。未重发派单、伪造入站或清理 active 需求；Local 保持运行。

仓库[飞书接入契约](../bots-feishu-group-collaboration.md#接入隔离与退出)及[官方接收消息事件文档](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/events/receive)要求接收机器人原生提及需已生效的 `im:message.group_at_msg.include_bot:readonly`，或覆盖该场景的 `im:message.group_msg.include_bot:read`。普通真人消息权限与原生身份核验不能证明上述权限已开通。本轮未提取凭据检查权限，也未获取应用后台的已发布授权证据；正在请用户只读核对当前生效权限，缺少权限仅为待验证假设，不记为已确认根因。不擅自扩权或发布应用配置。

脱敏计数与观察边界保存于私有证据根 `live-demand-chain-summary.json`；实际投递、原生提及及项目指纹保留在对应 private 文件。后续须根据权限与实际事件证据继续排查，不能按等待时长判断旧派单可以安全重发。真实闭环、关键异常与最终用户验收仍未通过，18 保持 in-progress。

## 旧循环守卫核对（2026-10-24）

用户反馈过去 PM 与执行者互发达到旧循环上限后，需要真人原生提及才能恢复。本轮将其作为明确的排查线索；没有据此直接将当前派单记为发送失败。对指定群主聊天的原持久状态只读核对：PM consecutive=0，执行者 consecutive=4，上限为 5；revision 1 协作仍启用。当前派单消息 ID 不在执行者的 guard 去重记录或输入中，尚无第二个 Local 输入。计数尚未达到截断值，且缺少真实接收事件，不能确认本次被旧守卫拦截，也不能由未持久化反推平台从未推送。

当前源码的 `admitAutoReplyTurn` 只在非可信协作时按五条截断；协作 authorize 的 allow 继续保留消息去重，计数饱和。沿已有 Provider 回调/真实服务/持久化/可控任务边界，单独复跑原长链及 legacy 守卫用例：`pnpm exec vitest run packages/services/test/botCollaborationHandoffs.test.ts -t '可信协作长链超过|Local 宿主未启用协作的群仍保留'`，5 通过、127 未选中跳过，退出 0；隔离 HOME，Node 24.14.0 / pnpm 10.33.2，源码 `878bbe2e`。这是合成回归，不是重放真实入站，也不能证明当前真实事件获 allow。

对当前存储交接逐项核对：来源任务仍对应、原输入 accepted/done、投递 sent、授权及 sourceCommandId 匹配、当前版本和职责匹配、需求 active。没有获得执行者实际收到的 native sender/mention/thread 事件，因此不把这些已满足的存储前提扩大为实际授权成功。用户先选择了“查到接收事件”，后明确澄清只能看到群里的消息，没有查看应用后台事件或具体结构。先前把该回答解释为平台接收证据不成立。用户截图只支持 PM 派单已在群内显示，不证明执行者应用收到事件；原生接收、Provider 解析及受理位置继续未知。include_bot 权限缺失和旧守卫均不能记为已确认原因，不要求用户提供其不可见的事件结构。

私有证据为 `live-auto-reply-guard-summary.json`、`live-handoff-prerequisites-summary.json` 及 `guard-diagnosis.json/.log`。未修改业务源码、重置计数、手动伪造提及、重发派单或改变需求状态。真实闭环继续待核对。

## 接收事件证据更正（2026-10-24）

用户提供的群截图显示真人需求、PM 对执行者的原生提及派单，以及 PM 对原需求用户的派单说明；截图内未见执行者回报。它不包含飞书后台事件记录或 native payload。此前将用户选择回答记作“后台查到接收事件”的推断已撤回，不能据此排除平台未推送。截图含真实身份、正文及项目路径，只留私有材料，不入公开仓库。

继续只读核对受控启动日志中已有的接收摘要、解析、回调失败、WebSocket 失败和卡片准备失败等已知标记，均未命中；仅保存计数，不保存原始行。生产构建按现有策略禁用服务 debug，因此缺少这些摘要不能证明没有收件。旧派单也没有可用的原生事件供离线复现。未开启原始 payload 日志或新增生产诊断，没有通过业务回调伪造/重放原派单；本次无法仅据现存证据定位丢弃阶段，保持未确认。

## 最小接收诊断、候选与受控切换（2026-10-24）

用户明确允许默认关闭的有限本机观察及空闲后的受控切换。局部合同先行，诊断源码固定于 `19059fb36abebbcdb9daf19268ca636110cc5cad`，只旁路观察原 SDK/Provider/授权/守卫/受理结果，不改变路由或重放业务消息。固定 `a240e91d...19059fb3` 的独立 Standards / Spec 两轴均为 0 项。新增观察 owner 契约 12/12 通过；根类型、Lint 0 errors/97 存量 warnings、架构和变更格式通过。源码推送的 affected 选择 109/2064，1822 通过/2 跳过，不是全量。

29 个指定根文件最终串行回归为 684 通过/1 失败/1 跳过。未修改的 Main 维护契约在 markHostReady 后读到 starting；独立复跑该文件 8/8 通过。源码可见初始 starting 与 ready 发布的异步写顺序风险，但没有确认诊断变更为引入原因；未在本次范围静默修改。原失败及全仓格式失败继续保留，不将本组写成全绿。

原安装规则要求版本严格更新，下一本地修订为 `3.16.2-local.2`，候选源码 `b35fa82f561e17e0f4c03077d75e561b022327e2`，清单为私有 `candidate-3/candidate.json`。标准构建入口的类型、Lint、架构及维护检查 50/50 通过；affected 全选 2064 后按仓库合同跳过。完整应用、ASAR 元数据、deep/strict 签名、ZIP 全成员和只读 DMG 均经原入口及独立核验。应用树 SHA-256 为 `de80caa75fc5e360b65cb10b5f4f83b723154a429020ca9c2055d0ff95d7d2dc`。首次构建尝试因 GitHub API 传输失败停止，后以命令级 HTTP/1.1 重试成功；没有修改远端、全局网络配置或关闭校验。分支正常推送，没有创建或发布 tag。

切换前只读查询再次出现 11 个列表已完成、无前台阻塞的任务中 5 个 ownedWork=busy；下一轮为 11/11 idle，active turn、待确认请求及快照后台任务均为 0。首次附加旧快照读取使用 messageLimit=0 被协议拒绝，改为正数后读取成功，原失败保留。没有停止任务、清理租约或计数；不能把两轮之间的变化归因为某项具体后台工作。指定群配置另读为 busy=false、revision 1，随后原安装入口再次取得 idle 与 accepted/runningTaskCount=0。

切换前 15 备份和独立 verify 成功；原入口正常退出旧应用、原子替换并启动 local.2，安装返回 installed。另独立核对安装目标的完整应用树/源码/签名、存活 launcher 和应用、owner/runtime/PID/token/版本、Host ready，以及切换门已释放。成功后旧 previous 临时应用由原入口清理；旧应用与数据保存在有效切换前备份，旧候选归档保留。未替换官网包、执行数据恢复或伪造用户输入。当前清单指针另存私有 `live-current-local.private.json`，不改写历史 candidate-2 清单。

指定执行者观察器已独占领取一次私有请求，0600 输出目前记录 connection/ready，facts 为空；这证明观察器及既有 WebSocket 连接就绪，不证明真实模型或业务收件成功。切换前备份与切换后的协作 ledger 字节相同：1 个需求、3 个输入、2 个交接、0 个在途入站协调记录，新增记录不是本次切换重放产生。等待新的真人原生需求，在有限窗口内观察 SDK 收件至受理阶段；旧派单不自动重发。根因及完整闭环继续未确认。

私有证据定位：`receive-diagnostic-review.json`、`receive-diagnostic-contract-final.json`、`receive-diagnostic-root-serial.json`、`receive-source-push.log`、`receive-candidate-build-2.log`、`receive-candidate-verify.json`、`busy-investigation-summary.json`、`receive-install.private.json`、`receive-installed-verify.json`、`receive-postswitch-ledger-summary.json`。真实身份、消息标识、请求 salt、路径和正文不进入公开材料。

## 授权断点已确认，修正待真实验证（2026-10-24）

切换后的新真人需求到达 PM 并形成第三条已结算交接。指定执行者的有限诊断观察 transport/native received、prepare ready、parse parsed（1 条、原生提及匹配）后 authorization deny；complete ready 仅表示回调结束，不是任务受理或业务完成。私有 salt 下的事件指纹与本次原 sent providerMessageId 对应，而原生 sender ID 指纹与配置 PM openId 不同。来源 task/input、sent、authorization/sourceCommandId、accepted/done、职责、版本、目标与需求 active 等已观察前提匹配。未进入旧守卫或执行者 admission，不能把本次归因为循环上限或未推送。机器人 ID 为何不同尚未独立证明，不把真人身份的单应用规则扩大为该事件的已证实原因。

用户已批准按 [05 局部合同](../issues/zcode-local/05-trusted-handoffs.md#18-真实验收补正原生机器人交接按已确认回执绑定2026-10-24) 修正。源码 `aca671101531717575635a6dc1a46e88e5952525` 仅在既有协作 owner 中移除跨接收视角 bot ID 的直接相等要求，保留非空原始 sender 和全部原发送回执/范围/方向/版本/成员/项目/输入/停止边界；来源仍沿原投递 owner 的真实 sent 回执绑定，不新增身份映射、schema、队列或查询/发送路径。

真实协作模块的隔离私有复现：同一有效回执但 sender ID 不同先为 deny/退出 1，修改后为 allow/退出 0；错误回执仍 deny、ledger 未改。Provider→实际 Bot/Repo/协作 owner→可控任务 SDK 的默认群/话题双向交接先 2 项红灯，修正后通过，并验证原 sender 来源和重投去重。首次绿灯尝试另有夹具误断言不存在的 source.senderType，已按实际公开 schema 修正；首轮完整交接 140 通过/1 失败/1 跳过，失败是新真人拒绝反例错误要求没有原权限提示，任务始终未受理，已修正提示与受理的区分。原失败日志均保留。

最终相关回归 17 文件 / 494 通过、1 专用入口跳过；根类型通过，Lint 0 errors/97 存量 warnings，架构 0 新违规和变更格式通过。固定 `6d68c7fb...aca67110` 独立复审 Standards 0、Spec 0。普通源分支推送的官方 affected 选择 109/2064，1821 通过/2 跳过，schema 8、架构工具 36、Lint/架构通过；不是全量，不覆盖此前 Main starting/ready 的未修改失败。

为遵守原版本严格更新门禁，下一候选使用 `3.16.2-local.3` 及同名集成分支。该源码复审结束时仍运行 local.2，后续候选核验及空闲切换结果见下节；仍须以新的真人只读需求验证修正。已拒绝的旧派单不自动重放，没有清理租约/计数或恢复覆盖数据。最终用户验收继续待完成。

私有证据：`receive-authorization-findings.json`、`receive-authorize-check.private.json`、`repro-sender-boundary.log` / `repro-sender-boundary-green.log`、`receipt-fix-red.json`、`receipt-fix-green-2.json`、`receipt-fix-handoffs.json`、`receipt-fix-boundaries.json`、`receipt-fix-related.json`、`receipt-fix-typecheck-final.json`、`receipt-fix-lint.json`、`receipt-fix-architecture.json`、`receipt-fix-review.json`、`receipt-fix-source-push.log`。

## local.3 已受控切换，等待修正后的真实闭环（2026-10-24）

标准维护入口从 `71e8ae055174a2bf371a4f5de4412a1bb3301028` 生成 local.3 ready 候选，私有清单 `candidate-4/candidate.json`。构建的类型/Lint/架构、维护测试 50/50、准备/桌面/打包与完整产物核对通过；affected 官方全选 2064 后按仓库合同跳过，不是全量执行。新分支首推按明确官方基线执行原 hook 后成功，GitHub API 独立核对相同源码；没有创建或发布标签。

随后独立重新核对完整应用树/源码/ASAR 元数据、deep/strict 签名、ZIP 全成员、归档 hash 和只读 DMG 内容。应用树 SHA-256 为 `dc34c63335ac6ff3829741d9c502e3f0c0860fc8c855a0978b0c5e60642c54d3`，DMG 为 `b2869bc29faea8818c447c85af2ef4302a3f771121c231d21d5c7d1df4bb7eab`，ZIP 为 `577939ea9c3795f49aefb36da88bba2d07f222990f2fd4d68c159104f12f2f62`。复用此前完整验证的公共 DMG 工具缓存，762 个文件逐一 hash 相同，未替代原构建或验签流程。

切换前只读确认无在途入站协调记录和项目执行租约、当前 owner/runtime 对应；实际空闲仍由原安装入口再次核对。其返回 accepted/runningTaskCount=0，旧 local.2 正常退出；本次 15 备份及独立 verify 后原子替换、启动 local.3，返回 installed。另独立核对安装目标的完整应用树、元数据/签名、存活 launcher/应用、owner/runtime/PID/token/版本 ready 和切换门已释放。官网未运行且包未替换，无强杀、计数/租约重置或真实数据恢复。

切换前备份和新真人输入前的协作 ledger 字节一致：1 个需求、4 个输入、3 个交接、0 个在途协调记录。原已拒派单没有自动重放。当前私有清单指针更新为 candidate-4，旧指针另行留存，不改写历史 candidate-2/3 清单。新应用的有限观察器已独占领取私有请求，0600 输出 connection/ready；仅证明既有连接及观察器就绪。已记录新的项目 Git/目标文档只读基线，等待真人原生发送新的只读需求，再检查授权/受理、执行者回报、PM 审核及用户验收。

私有证据：`receipt-candidate-build.log`、`candidate-4/candidate.json`、`receipt-candidate-verify.json`、`receipt-builder-cache-reuse.json`、`receipt-install.private.json`、`receipt-installed-verify.json`、`receipt-postswitch-ledger-summary.json`、`receipt-readonly-before.private.json`。之前回归和 Main 维护契约的失败仍保留，不因这次实际安装成功改写历史结果。

## 修正版真实受理通过，回报与只读验收失败（2026-10-24）

新的真人原生需求由 PM 受理，PM 的实际 sent 派单在执行者侧绑定为同一回执；原始 sender 与保存的 PM openId 不同，但执行者已 accepted、promoted 并完成 Read。这证明此前修正跨过了真实授权断点，不再以旧守卫或未确认的接收权限解释本轮无回报。诊断窗口在本次入站前已过期，只有 connection/ready；本结论来自原 Bot/Local ledger、原投递回执及只读 CLI 持久化查询，不声称观察到了新的 authorization/allow 诊断记录。

执行者普通回答中的标题、开发命令及行号与实际文件独立核对一致；项目 HEAD/status/diff 指纹和目标文档 hash 前后一致。但 PM 本轮还成功调用 Edit 修改项目外台账；不能将项目指纹不变推广为全局只读通过。该次精确 Edit 输入预览保存在本机私有材料，未回滚或覆盖真实台账。执行者本轮观察到的工具只有 Read。

执行者普通自动投递为 sent，没有原生提及，也没有 ReplyToChannel 协作 report 或执行者发出的新 handoff；PM 尚未收到对应协作输入，需求仍 active，没有 final/awaiting_acceptance。普通正文不按既有合同自动转成 report，也没有因此自动重试、重放、补发或宣布验收完成。

只读核对实际 promoted 输入与模型可见用户消息后确认：两名机器人的 Local 角色章程均在，要求通过 ReplyToChannel 的协作意图完成交接。同时，CLI 通用消息包装为所有 bot 来源附加普通回复自动投递及不要调用消息工具的指导，PM 的派单正文又明确禁止执行者调用 ReplyToChannel。可以确认这几层指导并存且本轮模型选择了普通回复；尚不能仅凭共现证明某一句话必然导致模型行为，也未确认 PM 产生该禁令的历史原因。

当前 Bot 群输入公开入口没有显式只读工具策略。已有 session 工具 allowlist 和部分 turn denylist 能力不能直接等同于该入口的只读保证。初查曾误写 Plan 会阻止渠道工具；完整路径及既有回归确认 ReplyToChannel 有先于 Plan 的专用放行，该说法更正。Plan 仍允许非 destructive MCP，不能保证本次限定工具范围。上述结果不扩张为所有权限路径或模型的审计结论。

私有命令 `python3 evaluate-readonly-round.py` 对选定本轮的真实捕获作断言，退出 1：原发送回执受理、执行完成、文件依据正确三项通过；协作 report、PM final 和无文件写入三项失败。它只读取原状态及选定捕获，不重放消息、不调用模型、不改变业务状态。原项目命令核对曾因将带行尾注释的整行与裸命令作相等比较而误判，已改为独立核对命令及行号；原误判保留。较早观察脚本也曾将含相同标记的执行者输入覆盖真人输入索引，最终判定按配置中的角色分别核对，两条输入均明确存在。

私有证据：`receipt-case-c-acceptance-evaluation.json`、`receipt-cli-input-rules-final.json`、`receipt-case-c-deliveries.private.json`、`receipt-case-c-tool-metadata.private.json`、`receipt-case-c-edit-preview.private.json`、`receipt-readonly-verification-final.json`。公开材料不包含真实正文、文档标题/命令、身份、消息 ID、台账路径或变更内容。

### 待确认的下一步修正边界

用户随后已明确批准此方案；实施合同见 [18 的已批准合同](../issues/zcode-local/18-end-to-end-acceptance.md#已批准的协作提示与只读执行合同2026-10-24)。当前运行应用尚不具备该能力，实现与验证仍待完成。

- 明确可信 Local 路由指导与通用自动回复指导的适用范围：PM 派单、执行者 report 和 PM final 使用已有协作意图，普通最终正文不代替交接；业务派单不能禁止必要的 Host 协作动作。普通机器人对话仍沿原自动投递语义。保留模型判断业务内容、Host 校验身份/职责/回执/状态的分工，不从正文推断或伪造 report。
- 为下一次验收增加用户显式启用、限定到新验收需求的只读执行约束。Local owner 持有唯一约束并向 PM、执行者及后续交接传递，CLI 沿原 CommandInbox 受理和恢复边界保存并执行。工具面仅开放 Read/Glob/Grep 及经过原 owner 授权的 ReplyToChannel；文件写入、Shell、可变 MCP/插件、子代理及其他工具入口均不能绕过。不能从自然语言、超时或机器人自报推断/解除约束，未知或旧协议不支持时拒绝执行；不更改全局权限或普通开发需求。
- 先补对应局部 spec/严格协议与工具变更链，覆盖普通回复与协作回报分离、错误角色/回执/停止拒绝，以及只读约束的排队、重启恢复、默认模式/插件/子代理绕过和相邻普通输入不被污染。实际工具执行边界需证明写入被拒而合法 report/final 可发送；提示词断言不能替代这一回归。
- 验证及固定端点复审后准备下一 Local 修订，只在实际空闲时经原备份/验签/受控切换入口更新，再由真人发送一个新的有限需求。旧需求不重放，现有台账不自动恢复。最终真实模型闭环及用户明确验收仍是独立门禁。

```mermaid
sequenceDiagram
    participant U as 授权用户
    participant H as Local owner
    participant Q as 原受理队列
    participant T as CLI 工具边界
    participant P as 原投递 owner
    U->>H: 显式启用新验收需求的只读约束
    H->>Q: 原输入与唯一约束一同受理
    Q->>T: 提升输入并恢复同一约束
    T-->>T: 拒绝文件写入与其他未开放工具
    T->>P: 已授权的 dispatch / report / final
    P-->>H: 原发送回执与需求阶段
    H-->>U: 待用户明确验收
```

依据根 [AGENTS.md](../../AGENTS.md)「发现设计缺陷时先与用户对齐」，上述提示指导与执行约束在实施前已完成范围确认；不得据此将尚未完成的实现、切换或真实验收记为通过，18 不记完成。

## 已批准修正的实现与隔离证据（候选待准备）

实施基线为 `d7b0f8ee0b062e05837732688bb92cf069e7399b`。先更新 18、CLI 工具变更链及模块合同，再补回归。Local owner 在原生授权真人的显式首行命令下创建独立只读需求，要求原群实际空闲且无其他协调 token；普通自然语言、引用和机器人正文不启用。约束沿原 V4 scope、canonical input intent、CommandInbox、SQLite 和实际 ActiveTurn 传递；不扩 Bot v3。稳定项目租约只取得 projectId/workspaceKey，不缓存单轮策略。

模型材料与工具面投影收口为 cli-input-projection 受控模块，原执行 owner 不迁移。Local 协作指导与普通自动投递指导分开，模型不按派单中的禁令绕过协作工具。只读轮直接曝光内置 Read/Glob/Grep/ReplyToChannel 的完整 schema；executor 在工具准备/Hook/handler 之前再次检查最终目标，拒绝 Write/Edit、Shell、MCP 同名伪装、子代理、工作流和 deferred 写入，渠道工具只接受既有协作意图。原 Host 继续校验角色、职责、回执及需求状态；本轮不派生可写项目记忆提取。下一普通需求保留原开发能力。

话题场景额外得到可复现红灯：原普通准备器会在验收命令受理前停止旧工作。现在显式验收命令绕开该准备器，busy/unknown 直接拒绝，已有准备中/等待停止也不能当 idle；原生主群与话题双向交接、final→真人明确 accept→新普通需求均已在隔离接口中验证。原已拒消息和旧需求不重放。

- 原 Provider→实际 Bot/Repo/Local owner→任务 admission 的 17 个根文件：502 通过、1 专用子进程入口跳过。含不同接收视角 ID 的原回执边界、真实原生提及、只读命令、忙碌/未知、重投、重建、交接/待验收与关闭后的隔离；不连接真实群或模型。
- CLI Core 定向 10 文件 114 通过；另以私有临时 Vitest include 配置运行受控模块公开投影契约 1/1。原包默认选择未包含 src 下该契约，因此它单独执行，不声称默认包选择已覆盖。Read 后的 Write 先证明能改合成台账，再实现拒绝，并覆盖实际 Write/Edit、Hook 未运行及下一普通轮仍能写；真实渠道工具的 report/final 可达合成端口，普通额外发送被拒。
- Bootstrap 的原 V4→CommandInbox/SQLite→实际 Turn：5 文件 62 通过，包含排队、手机 replayable 冷恢复后的编辑与重试保留约束、非法结构在 admission 前拒绝。依赖产物刷新后已重新执行相同边界并通过，不将 stale dist 当最终源码验证。
- 根类型检查通过；CLI 类型检查 32/32（24 缓存）通过。根 Lint 0 errors/97 既有 warnings；CLI Lint 0 errors/72 warnings/11 原样上游行数诊断。首次 CLI Lint 的两处超长错误保留：原文件分别 5918/2196 行，仅新增输入字段投影；按根存量合同将这两处精确登记为 max-lines 告警，800 阈值及其他检查不变。架构首次指出两个本地新增投影文件未受管，现由上述模块接管，复验 0 新违规，未改架构 baseline。

原红灯与中间失败均保留：工具夹具最初未先 Read、渠道 executor 夹具缺权限读取端口、cold runtime event store 不承载历史事件的误断言均已纠正。稳定租约误接收单轮字段、队列投影及编辑重试漏字段是在接口回归中实际暴露并修正的路径；早期 CLI 依赖产物需刷新，最终验证按实际源码和依赖刷新后的结果记录。临时阶段探针已移除，不加入应用日志。

本节是合成接口、真实持久化和实际工具机制证据，不能证明真实 PM 会遵守提示、审核依据或等待用户。当前日常数据未启用新命令；运行应用仍是旧 local.3，下一修订须复审、原标准构建/独立核验及空闲受控切换后，再由真人提交新的只读验收。原 C 失败结论及其他历史失败继续有效，18 未完成。

私有证据：`readonly-prompt-red.json`、`readonly-write-red-2.json`、`readonly-topic-idle-red.json`、`readonly-root-source-final.json`、`readonly-core-final.json`、`readonly-projection-contract.json`、`readonly-bootstrap-refreshed.json`、`readonly-typecheck-source-final.json`、`readonly-cli-typecheck-final.json`、`readonly-root-lint-source-final.json`、`readonly-cli-lint.json`、`readonly-cli-lint-2.json`、`readonly-preexisting-lines.json`、`readonly-architecture-source-final.json`。最终源码端点、复审及候选结果后续追加，不回填为已经完成。

### 固定端点初审与活跃话题修正

固定 `d7b0f8ee...0b309623de84af7b3a2fd6a21d96d50a2be8c40c` 两轴独立复审：Standards 0；Spec 1 项 P2，新增只读命令在已激活话题可沿允许无 @ 后续消息的旧路径启用。主群原有过滤使最初无 @ 测试通过，但不能代表话题。新增实际服务回归明确复现 SDK 从预期 1 次变为 2 次；Local owner 现对显式命令且 `mentionedBot !== true` 明确拒绝，不降级为普通任务。

修正后定向原生主群/话题、未知协调 token 和该反例 4 项通过，17 文件完整复验 503 通过/1 跳过；根类型与 Lint 0 errors/97 warnings 再次通过。CLI 代码未因该修正变化，之前类型/Lint及相关回归结果不重复累加。新端点仍须两轴复核后准备候选，18 的真实闭环和用户验收仍未完成。原发现及红绿证据保存在 `readonly-review-initial.json`、`readonly-active-topic-native-red.json`、`readonly-active-topic-native-green.json`、`readonly-root-reviewed.json`、`readonly-typecheck-reviewed.json`、`readonly-lint-reviewed.json`。

### 源码复审完成，推送整合夹具补正

最终行为源码 `d5471c3d70d887f9a8f37843fedc15491f4378de` 的独立 Standards/Spec 两轴均为 0 项未关闭发现，初审 P2 已用实际活跃话题红绿回归关闭。普通推送的官方 affected 选择 1373/2064 个根测试文件，实际 15692 通过、1 失败、4 跳过，推送被阻止，不是全量且不记全绿。

失败是 `hostRemoteStartupIntegration.test.ts` 的 InitLocal 沙箱未注入已有 `reportHostRunningTaskCount`，抛出 ReferenceError；独立单文件复现。`b9817f9e` 已加入该真实调用，而测试仍来自 `0a1fc56d`；本次只读源码没有修改该启动函数。按既有启动/维护合同补齐计数和 HostReady 端口，并断言 base attachment→初始计数→HostReady→后台迁移→数据库 ready 的顺序；只修测试夹具，不改应用逻辑或门禁。单文件修正后 4/4 通过，原失败保留；完整推送检查与下一候选仍须完成。

私有证据：`readonly-review-final.json`、`readonly-source-push.log`、`readonly-host-startup-red.json`、`readonly-host-startup-green.json`、`readonly-host-startup-typed.json`。当前仍运行旧 local.3，未重放旧派单、未恢复真实台账，18 未完成。

### local.4 候选准备

行为源码固定于 d5471c3d；测试夹具补正端点 de16c014 的增量 Standards/Spec 各 0 项。相同选定范围再次实跑 1373 个文件、15693 项通过/4 跳过，普通 fork 推送成功，GitHub API 独立核对源码端点一致。第二次尝试虽测试全绿但 SSH 在检查期间被远端关闭（exit 141），未推送；第三次只在单次命令加连接保活，保留严格主机校验和全部 pre-push，成功完成。原检查失败及传输中断不覆盖。

原安装入口要求严格更新，当前分支与根版本进入 `3.16.2-local.4`，用于准备下一候选；父规格冻结、官网包、保存的远端及全局 SSH 配置不变，没有创建或发布 tag。当前运行的仍是 71e8ae05 / local.3，下一版本的构建、独立验签和空闲受控切换尚待完成。新的显式只读需求将覆盖 PM/执行者；另核对上次发现的项目外台账哈希，不恢复或覆盖真实台账，也不重放旧需求。

私有证据：`readonly-review-with-fixture.json`、`readonly-source-push-2.json`、`readonly-source-push-3.log`。18 保持 in-progress；真实完整闭环、关键异常及用户明确验收仍未完成。

## local.4 已运行，新的只读真实轮待执行（2026-10-25）

候选源码 `f2ef20bf701fb8004bb9e15b13321623883ece5b` / `3.16.2-local.4`。行为 d5471c3d、夹具补正 de16c014、版本增量至 f2ef20bf 的独立 Standards/Spec 复核均为 0 项未关闭发现；复审只覆盖源码，不替代产物验证。原维护入口于 2026-10-24 生成 candidate-5 ready：维护测试 50/50，类型、Lint 0 errors/97 存量 warnings、架构 0 新违规通过；affected 全选 2064 后按合同跳过，不能记为全量。完整应用、ASAR 元数据、deep/strict 签名、ZIP 全成员与只读 DMG 经原入口及独立核对通过。应用树 SHA-256 为 `f551f527271fdce17dc3efa41c6bdfd1f1f7673e9df1701f6d8807661598367b`。没有创建或发布 tag。

安装前发现旧 local.3 的 launcher 已结束，但应用及其相关进程仍在；退出原因未确认，不能仅凭原 runtime ready 接管。现场私有归档，用户先保留工作，随后明确正常退出 Local。再次确认原关联进程、进程组与两类应用均结束，业务根无打开文件句柄，admission/项目租约为 0，两根 owner 与归档精确一致，无 gate/request/commit。持久化任务终态本身不当作 idle 证明。

按 17 人工边界，在原同序 owner 锁内调用 15 公开的 createVerifiedBackup / verifyReadyBackup，先完成当前应用/数据备份及独立验证，逐项核对当前源与完整基线一致，再把精确匹配的旧 owner 移入私有归档。首轮调用的 umask 077 使 14 个应用链接权限从 755 变成 700，成员数量、类型和内容 hash 一致；原校验拒绝且未解除 owner。首次诊断将目录模式说得过宽，后更正为链接权限。仅将本次进程恢复为常规 umask 022 后，原实现及独立 verify 通过；私有根/记录仍显式 0700/0600。原 pending 备份与失败保留，未豁免权限检查，也未宣称支持任意 umask。没有新增 force/TTL 入口、强杀、重置业务状态或恢复真实数据。

原 install 随后按冷态无占用路径完成自己的备份/独立 verify、staging 核对、原子替换、takeover 与 Host-ready；此次不声称存在运行中应用的 idle→commit→accepted 退出握手。独立核对安装目标完整树/源码/签名、存活 launcher 和应用、owner/runtime/PID/token/版本均一致，gate 已释放。当前清单指针更新为 candidate-5，v3 历史指针保留；官网未替换或启动，旧需求未重放，真实台账未恢复。

新真人输入前 ledger 与切换前字节一致：1 个需求、6 个输入、4 个交接、0 个在途协调记录。PM 范围的有限诊断已独占领取私有请求，0600 输出 connection/ready；仅证明观察器与既有连接就绪。项目 HEAD/status/diff、目标文档及已知项目外台账 hash 基线已保存。下一轮由同一真人原生提及 PM，以显式只读首行创建新的有限需求，验证 report、PM final/待验收及文件依据。需求不设过期时间；诊断仍按原独立时限/额度停止，不因观察到期重放或重启。旧 C 失败、其他关键真实异常与最终用户验收仍未完成，18 保持 in-progress。

私有证据：`readonly-candidate-build.json`、`candidate-5/candidate.json`、`readonly-candidate-verify.json`、`readonly-review-candidate-source.json`、`readonly-orphan-preflight/audit.private.json`、`readonly-cold-copy-mode-confirmed.json`、`readonly-cold-owner-recovery-2/result.json`、`readonly-install.private.json`、`readonly-installed-verify.json`、`readonly-postswitch-ledger-summary.json`、`readonly-d-before.private.json`。

## 真实入口拒绝与实际空闲核对修正（2026-10-25）

后续命令先因首行没有独立换行被 readonly_invalid_command 拒绝；纠正格式后进入 readonly_busy。两次都没有建立新需求或 CLI 输入，原 ledger 保持不变。旧有限观察窗口已到期，只有此前 connection/ready，不能宣称记录了这次的具体 busy 分支。所选时间窗两次错误来自同一 Host；Main 转发的日志不另算一次回调。原生事件标识未被该诊断捕获，不能仅凭两条错误把平台重投认定为原因，亦未自动重发或清理业务状态。

用户确认只剩空白页或已完成任务。所选项目持久化状态均为终态、admission/项目租约为 0；相邻内存采样的运行与待交互计数为 0。另仅执行原维护握手第一步，收到 idle/runningTaskCount=0，没有创建 commit 或请求退出。上述时点证据不代替所有会话的即时 owned-work 证明。

隔离反馈环复现了确定的误判路径：真实 sessions-index syncer/任务 adapter 保留纯内存 draft，listActiveTaskIds 因而非空；原协作空闲实现直接按列表非空拒绝。只增一个未提交 draft 的对照连续两次报同一 readonly_busy，无 draft 则通过。真实 CLI 的 draft 快照和 inspectOwnedWork 返回 idle，且模型启动数为 0。本机错误与该条件一致，但旧观察未记录分支，不将此隔离结果直接写成该条真实事件的唯一根因。

按 18 局部合同恢复实际空闲判据：活动引用用于发现候选，群内原任务与绑定 workspace 的候选均沿原 blocker 和 owned-work 查询核对。全局活动索引不改，不直接豁免 draft。实际运行、排队、交互、后台 busy/unknown、查询失败或能力缺失仍拒绝；同路径远程 identity 与其他 workspace 不污染本地判断。原有限诊断增加静态拒绝枚举和有界计数，依旧默认关闭、scope/HMAC 关联、限时限量，不记录原任务标识、正文、路径或异常文本，不参与业务判断。

最终指定根回归 17 文件 518 通过/1 专用入口跳过；原最小对照 2/2 变绿。CLI 原实际执行边界文件 20/20，通过未提交 draft 的 owned-work 证明与既有停止/后台工作/冷 lease 等反例。根类型和 CLI 类型 32/32（28 缓存）通过；根 Lint 0 errors/97 存量 warnings，CLI 0 errors/72 warnings/11 原样上游行数诊断；架构 0 新违规。初次私有夹具缺少 workspace alias 的导入失败保留，随后真正红灯为同一 readonly_busy；不是用导入失败充当回归红灯。源码复审、下一修订及真实验证仍待完成，当前运行应用还是 f2ef20bf / local.4。

私有证据：`readonly-case-d-format-rejection.json`、`readonly-busy-draft-minimized-1.json`、`readonly-busy-draft-minimized-2.json`、`readonly-draft-owned-work.json`、`readonly-main-idle-probe.json`、`readonly-busy-root-red.json`、`readonly-busy-diagnostic-red.json`、`readonly-busy-original-repro-green.json`、`readonly-busy-root-final.json`、`readonly-busy-bootstrap.json`、`readonly-busy-root-types-serial.json`、`readonly-busy-cli-typecheck.json`、`readonly-busy-lint-final.json`、`readonly-busy-cli-lint.json`、`readonly-busy-architecture.json`。18 不标 done，原 C 失败及其他真实场景/最终验收门禁保留。

### 空闲判据源码复审及 local.5 准备

固定 `8369f19e...461020e33a9dffe29aaa5cbe92378d3f5eaee8b4` 的 Standards/Spec 两轴各 0 项发现。普通 fork 推送通过原 pre-push：官方 affected 选择 110 个根文件，1857 通过/2 跳过，不算全量；GitHub API 独立核对源码一致。原严格安装规则要求下一修订，根版本及分支进入 `3.16.2-local.5`。当前运行应用仍是 f2ef20bf / local.4，新候选的构建、独立核验、空闲受控切换及真实验证尚待完成；不因源码复审通过重放旧消息或关闭 18。证据：`readonly-busy-review-final.json`、`readonly-busy-source-push.log`。

### local.5 已运行，等待新的真人只读需求

原维护入口从 `cf7f46641ba962a5e90c11e835c0aace85088b29` / `3.16.2-local.5` 构建 candidate-6。类型、Lint、架构与 50/50 维护测试通过；affected 官方选中 2064/2064 后按仓库合同跳过，未执行全量 UT。版本增量两轴复核各 0 项，fork 分支推送及 GitHub API 源码核对一致。独立校验应用完整树、源码和签名，所有归档哈希/大小、ZIP 全成员与 CRC、只读挂载 DMG 内完整树及签名通过，挂载已解除；没有发布 tag。

2026-10-25 北京时间 09:08–09:14，原 install 在 owner/runtime 匹配、无 admission/项目执行租约的前提下，执行运行中 local.4 的 idle→commit→accepted 正常退出、当前应用/数据备份及独立 verify、staging 与原子替换，随后 takeover 和 Host-ready 成功。未强杀、重置计数或恢复数据。再次独立核对实际目标完整树、签名及来源，local.5 的 launcher/应用均存活，owner/runtime/PID/token/版本匹配，switch gate 已释放。当前清单指针为 candidate-6，历史 v4 指针保留。

新真人输入前，协作 ledger 与切换前字节一致，仍为 1 个需求、6 个输入、4 个交接、0 个在途协调记录，项目执行租约为 0。新的 PM 有限诊断只记录 connection/ready，输出权限 0600；这不证明模型或协作业务闭环。项目 HEAD/status/diff、目标文档及已知项目外台账指纹已保存。旧拒绝消息未重放，下一轮使用新的显式只读需求。旧真实事件的具体 busy 分支仍未追溯，18 与最终用户验收保持未完成。

私有证据：`idle-proof-candidate-build.json`、`candidate-6/candidate.json`、`idle-proof-review-candidate-source.json`、`idle-proof-candidate-verify.json`、`idle-proof-install.private.json`、`idle-proof-installed-verify.json`、`idle-proof-postswitch-ledger-summary.json`、`readonly-f-before.private.json`。

### local.5 真实拒绝及冷加载初始化反馈环（2026-10-25）

用户发送新的正确格式只读需求后仍收到 readonly_busy。需求没有进入 Local ledger 或 CLI；仍为 1 个需求、6 个输入、4 个交接、0 个 admission。前后核对项目 HEAD/status/diff、目标文档和已知项目外台账 hash 均相同；这只证明这些选定指纹未变，不扩张为任意外部资源的全局证明。18 未通过，不将上一节安装成功或草稿回归通过写成真实闭环成功。

有限观察器捕获北京时间 09:22:53 的 idleness/deny，静态原因为 owned_work_busy，检查计数为 3；解析、原生提及和授权均已通过，guard 记录 duplicate/0 后仍进入空闲检查。观察器在截图对应的 09:54 已过期，且未找到这条早期诊断与需求的持久输入关联；不能把它直接当作 09:54 的完整事件证据，也不能仅凭两次错误归因为平台重投。原始业务日志分别在 09:54:34.061、09:54:51.920 记录 busy。

同一 CLI 日志与 session trace 关联显示：09:22:53.095 恢复一个未纳入当前协作配置、但仍在该群历史状态中的任务，09:22:53.102 拒绝时 MCP 初始化尚未完成；对应初始化在 09:23:07.805 完成。09:54 两次错误前又分别恢复两个旧任务，第一次恢复在 09:54:34.051、初始化在 09:54:38.755 完成；第二次恢复在 09:54:51.908。后两个时点没有有限原因记录，日志支持同类路径，但不声称已直接读取其每项 owned-work 分量。

源码路径为 BotsService 空闲核对 → 原任务 adapter → 临时 conversation 订阅 → 冷恢复 runtime → 启动 MCP → inspectOwnedWork。后者复用 residency blocking work，包含该检查自己刚启动的 MCP 初始化。隔离真实 Bootstrap/Core/SQLite/订阅命令反馈环，仅把 MCP 端口替换为合成可释放 Promise：已完成的任务冷订阅后，activeWorks/queue/pendingInteractions 均为 0，没有新增模型调用，但 inspectOwnedWork 返回 busy；释放这一个初始化 Promise 后返回 idle。最小对照连续两次各 1 通过/1 失败，失败均为预期 idle、实际 busy。初次夹具缺 MCP 方法、随后未持久化 draft 的失败保留，均不算根因红灯。没有改真实应用、业务数据、配置、计数或守卫。

另复核当前 local.5：应用仍存活，owner/runtime token/PID/版本匹配，但 launcher 已结束；退出原因未知。安装时及稍后存活的证据仍成立，不扩张为持续存活。保留现场，后续切换仍须遵守 17 的人工边界，不因 PID 消失或超时接管。

**待对齐方案，尚未实现：**让 CLI 单一 owner 提供不会为纯空闲核对启动执行服务的检查路径；已存在的运行、队列、交互、后台副作用、finalization 和项目租约继续沿原权威核对，未知仍拒绝。冷检查与真实执行初始化显式分离，真实执行沿原入口初始化，不能全局关闭 MCP、删掉 blocking work、等待固定时间或让用户逐个预热。所有群历史引用继续作为待核对候选，不仅检查当前两个配置成员；不清旧状态、不重放输入。先补真实 adapter/冷订阅/CLI 的纵向回归及两种订阅模式，再复审、准备下一修订。该方案涉及初始化和核对的职责分离，按根 AGENTS.md 的设计缺陷规则先与用户对齐。

```mermaid
sequenceDiagram
    participant B as 协作空闲检查
    participant C as CLI 单一 owner
    participant R as 原 runtime 与租约
    B->>C: 核对原任务引用
    C->>R: 读取已有执行和 owned-work 事实
    Note over C,R: 待对齐：纯检查不启动执行服务
    R-->>C: idle / busy / unknown
    C-->>B: 原权威结果，未知拒绝
    Note over B,C: 实际受理后才沿原执行入口初始化
```

私有证据：`readonly-f-initial-triage.private.json`、`readonly-f-after.private.json`、`readonly-cold-mcp-red-3.json`、`readonly-cold-mcp-minimized-1.json`、`readonly-cold-mcp-minimized-2.json`；反馈环命令及隔离 HOME 均在同名 JSON，合成 MCP 不连接外部服务。

### 纯检查修正实现与隔离验证

用户明确确认前述边界后，18 局部合同补充原 inspectOwnedWork→READY 冷恢复→延迟 MCP 预启动→真实执行 initializeMcp 的顺序。沿同一 CommandInbox、session record、Core 与原停止/恢复路径实现，不新增 RPC 或持久工作状态。普通创建/恢复仍默认预启动，已有 runtime 的真实初始化不能被检查关闭；Core 只对纯检查引起的冷恢复保存内存延迟标记，执行沿原幂等初始化并等待完成后请求模型。

Local 适配先读工作证明再读 blocker；证据适配先发纯检查避免订阅抢先预启动，再在原快照/收据读取后取得最终 owned-work 证明。读取过程中新增后台工作的反例先红后绿，不缓存早期 idle。所有群历史任务引用继续核对，未收窄为仅当前配置成员。

根相关 17 文件最终 521 通过/1 专用入口跳过；CLI 实际执行边界 23/23、原冷恢复 95/95、Core MCP/常驻/无模型绑定恢复 3 文件 17/17 通过。覆盖两种订阅、并发检查、检查无新 MCP/模型、执行等待初始化且只启动一次、已有初始化 busy、冷租约 unknown、原草稿及工作/停止边界。根 typecheck、CLI 32 项类型（24 缓存）通过；根 Lint 0 errors/97 存量 warnings，CLI 0 errors/72 warnings/11 原样上游行数诊断；架构 0 新违规。变更范围按各包 oxfmt 检查，未将仓库级格式历史失败改记通过，未运行完整根或完整 CLI UT。

首轮 CLI 夹具参数遮蔽、根夹具使用无效 phase、Core 构建产物尚未更新的失败均保留，未当作有效根因红灯。有效适配红灯固定 611c1b75 的两个原源码文件运行，均复现同一 busy，运行后当前编辑逐字节恢复并核对 hash；CLI 冷命令入口先拒绝、补通后两种模式均通过。原私有冷订阅对照仍证明旧订阅预启动机制，修正后的检查入口不靠等待或重试。

固定源码复审、下一候选构建和真实验证尚待完成；运行中仍是 cf7f4664 / local.5，launcher 遗留现场保留，旧消息不重放，18 不标 done。

私有证据：`cold-inspection-bootstrap-red-2.json`、`cold-inspection-valid-red-source-scope.json`、`cold-inspection-adapter-valid-red.json`、`cold-inspection-race-red.json`、`cold-inspection-adapter-final.json`、`cold-inspection-root-final.json`、`cold-inspection-cli-runtime.json`、`cold-inspection-cli-cold-resume.json`、`cold-inspection-core-runtime.json`、`cold-inspection-root-types.json`、`cold-inspection-cli-types.json`、`cold-inspection-root-lint.json`、`cold-inspection-cli-lint.json`。

固定 `611c1b75...7125ec685d77c355c70d5e0803bbe859b0a179ce` 的 Standards/Spec 复审各 0 项发现。源码普通 fork 推送的 pre-push 通过，官方 affected 选择 110/2064 个根文件，1966 通过/2 跳过，不算全量；GitHub API 独立核对一致。官方基线仍为 3c5b2276，严格安装版本门要求下一修订，分支和根版本进入 `3.16.2-local.6`。当前仅准备下一候选，未切换当前 local.5，旧消息不重放。证据：`cold-inspection-review-final.json`、`cold-inspection-source-push.log`。

### local.6 候选已独立核验，等待旧应用正常退出

原维护入口从 `0bd94d671206bd666df12743d458e317423fe690` / `3.16.2-local.6` 生成 candidate-7，版本增量复审 0/0。Node 24.14.0 / pnpm 10.33.2 已重新验证；官方 API 再核对基线 3c5b2276 未变。构建的类型、Lint、架构及 50/50 维护测试通过，affected 全选按仓库合同跳过，不冒充全量。仅复用 762 个 hash 已校验的公共 dmg-builder 缓存文件，没有替代打包链、手工 ready 清单或发布 tag。

独立检查完整应用树、来源及深度签名，DMG/ZIP 的大小和 hash、ZIP 全成员/CRC、只读 DMG 内完整树及签名均通过，挂载已解除。候选 app tree 为 `a97bae5bffa61ce308466a6554bd267175a35a4eb104b39f3486fde4482745fe`。独立核验不启动该候选，不证明真实模型或群闭环。

当前运行目标仍为 cf7f4664 / local.5，应用存活、launcher 已结束，退出原因未知；两根 owner 完全一致并与 runtime 匹配，原 owner 未改变。只读归档当前控制记录及 44 个关联进程，admission 和项目执行租约均为 0；这不替代正常退出及之后的完整无写进程核对。已请求用户在工作结束后从菜单正常退出，按 17 人工边界保护当前数据和精确归档遗留 owner，再由原 install 切换。备份/解除 owner/安装脚本仅准备，尚未执行；未强杀、清计数、恢复真实台账或重放旧消息。18 与真实新需求及最终用户验收仍未完成。

私有证据：`cold-inspection-review-candidate-source.json`、`cold-inspection-version-push.log`、`cold-inspection-candidate-build.json`、`candidate-7/candidate.json`、`cold-inspection-candidate-verify.json`、`cold-inspection-orphan-preflight/audit.private.json`。

### local.6 已安装，等待新的真人只读需求

用户确认从菜单正常退出后，按 17 在原同序 owner 锁内复核归档的 44 个关联进程均已结束、两类应用均不在、业务根无打开句柄，原 token/owner/runtime/路径仍精确匹配，群输入终态及投递结果、admission/项目租约均满足边界。调用原 15 公开备份与独立 verify，并对当前源逐项 sameTree；再次核对无写进程和控制记录后，将精确旧 owner 移入私有归档。未按超时接管、强杀、恢复业务数据或修改应用。

原 install 随后按冷态无占用路径执行自己的备份/独立 verify、staging、原子替换、takeover 及 Host-ready，返回 installed。此次没有运行中旧应用的 idle→commit→accepted 退出握手，不将人工退出和冷态切换冒充该路径。独立核对实际目标完整树、源码、深度签名及 local.6 版本，launcher/应用存活，owner/runtime/PID/token 匹配，gate 已释放。当前清单指针为 candidate-7，历史 v5 指针保留，官网未替换或启动。

新的真人输入前 ledger 与切换前字节一致，仍为 1 个需求、6 个输入、4 个交接、0 个在途协调记录，项目租约为 0。有限 PM 诊断 connection/ready，0600 输出，不能当作模型或群闭环证明。项目 HEAD/status/diff、目标文档及已知项目外台账指纹已保存。下一轮使用新的显式只读需求；不重放旧消息、不因独立观察窗口到期要求重发或重启。18、原 C 失败、其他真实场景及最终用户验收保持未完成。

私有证据：`cold-inspection-owner-recovery/result.json`、`cold-inspection-install.private.json`、`cold-inspection-installed-verify.json`、`cold-inspection-postswitch-ledger-summary.json`、`readonly-g-before.private.json`。

### local.6 真实派单通过，回报参数提示与错误校正

新的真人只读需求通过 Local 受理，PM 的 Read 和 collaboration/dispatch 工具完成，投递 settled，执行者入站 accepted 并完成 Read。两个实际 CLI canonical input 均带匹配需求及角色的 readOnly 约束。需求仍 active，执行者随后使用 report 多传 targetBotId；该值匹配当前 PM，但原 report 严格形状只有 kind，Core 只读 guard 因而拒绝。没有 report handoff、PM 回报输入或最终汇报，不能记作整体验收通过。选定项目 HEAD/status/diff、README 和已知外部台账 hash 前后均不变。有限观察窗口在本次入站前已过期，以上来自原 ledger、Bot v3 和 CLI 工具事实，不冒充完整逐阶段诊断，也没有因窗口到期重发。

源码中 ReplyToChannel 的工具说明把 dispatch/report/question/final 都写为使用 configured targetBotId，与共享严格 union 矛盾。实际调用与这条错误提示一致，但不把单句提示认定为模型选择的唯一决定因素。现按原已批准合同校正描述：仅 dispatch/question 可含目标/职责，report/final/accept/silent/stop 的 collaboration 只含 kind。Provider flat schema 兼容边界保持，未放宽 runtime schema 或 Host 目标绑定。

原 guard 仍先于准备、Hook、权限和 handler 拒绝；仅将原生协作工具已提供但不合法的意图分类为可修正参数错误，提供固定格式说明，不回显原文/目标、不裁字段、不执行发送。缺少意图、普通额外发送、MCP 同名、写工具仍按权限拒绝。模型需自行提交新的合法调用，重新走完整授权，程序不自动重试。Core 实际 executor/app-tool 回归先复现 permission_denied 与参数错误的区别，再验证无效不触发 Hook/Host、合法修正才发送。

Core 相关 4 文件 41/41；根相关 6 文件 218 通过/1 专用入口跳过。根 typecheck、CLI 32/32 类型（24 缓存）、根 Lint 0 errors/97 存量 warnings、CLI 0 errors/72 warnings/11 原样上游行数诊断通过，架构 0 新违规，变更范围格式通过。未执行完整根/CLI UT。当前只交付源码，尚待固定两轴复审和下一候选；运行中仍 local.6，旧输入不重放，18 未完成。

私有证据：`readonly-g-evaluation.private.json`、`readonly-g-after.private.json`、`report-arguments-core-red.json`、`report-arguments-core-final.json`、`report-arguments-root-related.json`、`report-arguments-root-types.json`、`report-arguments-cli-types.json`、`report-arguments-root-lint.json`、`report-arguments-cli-lint.json`。

固定 `27e562b9...b9f2144d3c75019e9d06e94e39c417ee03e8b3d5` 的 Standards/Spec 各 0 项发现。源码普通 fork 推送的 pre-push 通过；affected 选择 0/2064，没有执行根 UT，CLI 验证仍以前述显式命令为准。GitHub API 独立核对一致，官方基线仍 3c5b2276。严格版本门要求下一修订，分支及根版本进入 `3.16.2-local.7`；当前只准备下一候选，运行中仍 local.6，旧输入不重放，18 与最终验收未完成。证据：`report-arguments-review-final.json`、`report-arguments-source-push.log`。

### local.7 已受控安装，新真人回报验证待执行

版本增量 `11ca7b1530280f41d394c2c4af195d734620af1b` 两轴复核 0/0，原维护构建生成 local.7 / candidate-8。类型、Lint、架构和 50/50 维护测试通过；affected 全选按合同跳过，不算全量。独立核对完整应用树、源码和签名、两份归档大小/hash、ZIP 全成员/CRC 及只读 DMG 内完整树/签名，挂载已解除，无 tag 发布。

本次旧 local.6 的 launcher/应用与 owner/runtime 均正常，原 install 实际走运行中应用的 idle→commit→accepted 正常退出、当前备份及独立 verify、staging/原子替换、takeover 与 Host-ready。没有人工解除 owner、强杀、清计数或恢复真实数据。安装后独立重验目标签名、完整树和来源，local.7 的 launcher/应用存活，owner/runtime/PID/token 匹配，gate 已释放，当前清单指针为 candidate-8，历史 v6 指针保留。

额外只读核对候选与实际安装的 CLI bundle 字节一致：存在新参数错误及正确字段说明，旧矛盾说明已移除；不把源码通过冒充已打包生效。新真人输入前 ledger 字节不变，仍为 2 个需求、8 个输入、5 个交接、0 个在途协调记录，项目租约为 0。有限 PM 观察器 connection/ready，输出权限 0600；项目及已知外部台账指纹基线已保存。未重放 G 或旧消息，下一轮由真人发送新的只读需求；真实 report→PM 审核→待验收与其他真实场景/最终用户验收仍未完成，18 保持 in-progress。

私有证据：`report-arguments-review-candidate-source.json`、`report-arguments-candidate-build.json`、`candidate-8/candidate.json`、`report-arguments-candidate-verify.json`、`report-arguments-install.private.json`、`report-arguments-installed-verify.json`、`report-arguments-packaged-cli-check.json`、`report-arguments-postswitch-ledger-summary.json`、`readonly-h-before.private.json`。
