# bot-collaboration

冷检查先取得原 readBotCollaborationTask/inspectOwnedWork 证明，再读 blocker；证据适配先发原检查命令，再订阅快照，不让纯核对先启动 MCP 预热。CLI 只对该命令引起的冷恢复延迟预启动；已有 runtime 的真实工作及未知仍严格核对，不能关闭 MCP、忽略 blocking work 或清空旧引用。执行沿原 initializeMcp 入口启动。

空闲核对补正：workspace 活动引用仅用于发现候选，逐项沿原 SDK blocker 与 owned-work 证据核对；不能因非终态列表包含纯内存 draft 就判忙，也不能直接豁免 draft。实际工作、未知、异常或缺失能力均拒绝，全局活动索引不改。isIdle 的可选观察上下文仅含当前机器人/消息/发送者标识，供原有限诊断作 scope/HMAC 关联，不参与判断、不持久化正文或工作状态。

每 Provider/群的配置只有此模块写入，保存到实际数据根 .zcode/local/v1/collaboration.json，version 1。复用 shared 短锁和私有原子写入；未知版本/坏文件不覆盖。官网配置、任务索引格式不扩字段。

readSettings 统一读取界面概览或指定群的权威绑定；save 严格校验选项、身份、职责、实际空闲和 expectedRevision，成功变更才递增 revision。beginVerification 产生绑定群、机器人、应用和既有用户的限时一次命令；observeInbound 仅由 Bot Provider 入站调用，校验原生提及、应用、当前绑定用户、租户与 union_id，不是设置 RPC。

已启用配置的关闭是纯撤销，只核对版本与实际空闲，保留原身份/职责/项目，不采纳请求中的其他字段。已保存群名用于成员全部移除后的撤销入口，不是身份依据。新建、重新启用及其他变更仍严格核对可信选项。

withInbound 在同一锁内持久登记接收调用令牌，再调用一次原处理函数，finally 按令牌释放；其他 Host 也能观察。save 在锁内同时核对令牌与注入运行时，不能与正在受理的输入交错变更授权。令牌不含正文，不是执行队列或已受理事实；崩溃遗留记录按未知拒绝变更，实际运行事实仍由既有任务运行时判断，后续恢复由 12 核对。不新建待生效队列。

核验成功由 Bot 服务复用原群激活流程，connected 仍只从原 Repo 读取，普通消息不会自动重开群。配置版本变更后原群卡片授权轮换，原格式只写既有字符串字段。

05：同一所有者在 Local 文件保存原需求、执行输入关联及渠道交接索引，不保存执行队列；05 交接索引不保存正文，08 原待发消息按其契约另存原文。入站只接受授权真人→PM、已确认发送的PM→执行者/执行者→PM；交接必须核对原生消息ID、身份、群/线程与当前版本。ReplyToChannel 明确意图后由所有者重读 inputId/taskId/workspace 与原需求，生成唯一原生收件人并关联既有 deliveryId；发送与结果仍由原渠道投递 owner 维护。新归属不写官网 Bot v3；CLI 获得精简上下文材料，不把模型声明当作身份事实。

构造端口单独声明于 port.ts，与提供给调用方的业务接口分离；两者仍由同一服务实现，不增加所有者。首次可信派单可沿既有话题创建入口接入，显式停用不重开；来源输入已停止/取消/丢弃或投递结果未知时不受理迟到交接。发送前核对目标群及当前项目目录与权限。

authorizeDelivery 由既有投递 owner 在最终发送前重读 Local 配置、来源索引及目标接入/权限；准备后失效返回 false，由原 owner 记录 invalidated。它不重试、不发送、不复制结果状态，普通未启用群保持原路径。

ledger.ts 只定义本模块 Local 持久格式及规范化规则，供同一所有者读写与幂等比较复用，不提供第二个业务服务。

06：prepareReply 接收 Host 从实际执行来源解析的可信引用，只允许一个匹配当前核验目标的 mention；声明职责必须与当前配置精确相同，否则返回 blocked 并不写交接。Local handoff 保存 requiredDuty，最终发送和输入受理也核对；不做正文语义识别，不因用户选择改职责。

dispatchValidation.ts 是同一模块内的纯职责/引用校验，无 IO 或状态；服务先从实际配置取得目标与职责后调用它，再由原 owner 保存关联和投递。

07：prepareReply 接受 silent，保存当前输入 replyIntent 并返回严格 silent 控制结果，不创建 handoff/delivery；inputOrigin 返回该意图。正式发送尝试先写 visible，后续 silent 拒绝；静默不覆盖已发生投递或错误。调用者在终态按实际输入重读，不跨输入缓存权威意图。

08：候选选择按 08-recipient-selection 工单合同执行。Local sidecar 是原待发请求与选择领取的唯一 owner，Bot 投递记录仍为唯一外部送达事实；awaiting_selection 不表示送达。recipientSelection 的 present/render/respond 命令分别领取卡片、投影原卡和核对原生选择，属于同一能力，不新建状态服务。

replyRouting.ts 是同一 owner 的私有实现：沿原 ledger/read/write 与同一 file lock 处理回复准备和 present/render/respond。卡片使用公开 SELECTION_CARD_PREFIX 稳定 key，经既有投递 owner 发送；领取状态不代表外部送达，真实结果仅查原 Bot 投递记录。

10：只有 authorize 对当前事件返回 allow 时，Bot 入站不受原连续五条计数截断。原消息 ID 去重、身份/职责/任务/版本及 sent 收据核对继续生效；withInbound 保持配置变更与受理协调。计数到五后饱和，以兼容官网 Bot v3；legacy 不豁免，停用或非 Local 宿主仍保留五条防护。计数不是新队列，也不承担 PM 无进展语义判断；silent 沿 07 的同一投递边界终止，不生成新交接。

11：stop 接受可信原生叫停或实际 PM 真人输入的工具意图，Local owner 先保存原需求屏障与调用关联。stopTasks 仅沿原 bot/group/thread/workspace/input 控制；运行时结果区分 stopped/stopping/unavailable。通知授权 key 保存在 Local，外部结果与重投去重仍归原 delivery owner。重复旧调用固定原需求，已停止后不再发停止命令。新需求受理前只对已确认结束、旧队列为空的原任务恢复 autoDrain；不恢复旧目标或旧输入。旧卡片与迟到交接不可越过屏障。

11 补充：同一 Local 文件锁对最终输入 admission、停止控制核对与已确认后的新需求恢复互斥；停止屏障先落盘，控制前重读确认事实，锁不延伸到模型执行生命周期。不同停止调用不能携带旧计划越过新需求，配置读取统一为 readSettings 的 snapshot/binding 查询。

12：原 stop 能力统一为 control 的 stop/recover 命令，同一 owner 与同一锁处理生命周期核对，公开 RPC 和工具入口不变。recover 经原任务 SDK 读取原 commandId/队列/执行来源及 owned-work，修正已证明受理的原 Bot 输入，不重放。readTask 端口的跨边界证据使用 shared 严格 schema；未知不授权继续派发。未知投递仅按原消息 ID、群/线程与核验应用发送者读取；原 delivery owner 的 confirm 是唯一状态写入路径，无 ID 或不匹配仍 unknown。有效且未领取发送的卡片/选择沿原 request 续接；claimed、旧授权、过期和停止屏障不复活。恢复仅继续原停止核对，不恢复旧队列；死进程的入站协调 token 必须同时有原输入受理或停止证据才可清理，不释放项目执行租约。recoveryNoticeIds 只领取通知 key，锁外经原 delivery owner 发送并保存真实结果；通知丢收据也不自动重发。

13：语义章程由 roleContext.ts 注入，PM 负责依赖、证据、整改和三轮无进展判断，执行者只回报 PM；代码不解析正文或按交接次数推断。既有 requirements 增加 active/awaiting_acceptance/closed 阶段。prepare 只登记 final/dispatch/question 的最小 stageDeliveries 意图；只有原投递 owner 确认 sent 后才结算，final 进入待验收，dispatch/question 在反馈后回到 active，旧投递重放不覆盖后续阶段。accept 是 PM-only 控制结果，要求单个空 text，当前输入必须晚于已送达 final 且来自可信真人；关闭后同一输入不能再发送或派单，后续真人消息创建新需求。真实模型是否遵守语义章程不由此契约保证，留真实群验收。

18：经用户批准的 bot-receive-diagnostic 独立拥有本机有限观察输出，Bot 服务通过其公开入口调用，不参与协作状态或业务判定，不扩张本协作契约。诊断的默认关闭、scope、私有请求、脱敏、时限/数量和生命周期见该模块 CONTRACT.md 及 18 局部实施合同；本模块原授权、去重、守卫、受理和持久格式不变。

18 授权补正：原生 bot/app 事件的派单来源由原投递 owner 的精确 Provider 消息回执绑定，不把发出应用配置中的 bot openId 直接当作接收应用事件的 sender ID。原始 sender ID 仍保留审计。消息必须属于同群/线程/当前版本的合法方向交接，当前成员和固定项目权限有效，原来源 task/input/authorization/sourceCommandId 一致，原 delivery=sent 且 providerMessageId 精确相同，来源输入 accepted 且未停止/取消/丢弃、需求未停止/关闭。无匹配回执的机器人、自报身份、错消息或未知结果仍拒绝。去重、真人授权、循环守卫及持久格式不变；不增加身份映射或新查询/发送路径。详见 05/18 的 2026-10-24 局部补正合同。

18 只读验收：授权真人原生发给 PM 的首行 `[ZCODE-LOCAL-READONLY]` 加非空正文是显式新需求命令。仅在端口证明原群工作全部 idle 时创建，busy/unknown 拒绝；旧需求不改、不重放。requirement 的可选 readOnly=true 只由本 owner 持有，交接及真人后续输入继承，到明确关闭/停止后的新普通需求才不继承；机器人、引用和历史不能启用或解除。bindInput 同次返回 context 与严格 turn 元数据 requirementId/role/readOnly，调用者送入原 V4 Local scope，不扩官网 Bot v3。CLI 原入队/持久化与 executor 消费这份约束，不增队列。模型章程明确协作工具与普通自动回复范围，派单不能取消 Host 路由；ordinary final 仍不生成 handoff。详细规则、失败和验证 seam 见 18 已批准合同。

18 真人验收格式补正：原 Provider 对真人省略 senderType；bindInput 先以当前 owner/union/tenant 授权，再为新真人记录明确保存 user，新机器人记录仍为 app。accept 继续只接受显式 user，不推断 13 以前同样可能来自机器人的缺字段记录；旧记录重放比较保留缺省值，不回填或授予验收权限。不新建身份来源、不改 Provider 或 Local 格式、不迁移真实记录；已 sent final、后续输入、PM-only、同需求/版本/停止与幂等约束保持。Provider 回调 seam 覆盖新真人验收与错误身份拒绝，显式 app 和历史缺字段机器人后续回报均不可关闭。

18 不重放回归：已授权 Local 显式只读命令由原 Bot autoReplyGuard 在同一串行写入路径登记原生 ID；即使首次在 Local 绑定前因 busy/unknown 退出、尚无 input，跨重建重投也不再进入准备/绑定/admission。原持久守卫仍由 Bot 唯一写入，本模块不新增 seen 状态或重试入口。真人另发新原生 ID 才走完整原路径，普通真人重试、已受理输入核对、恢复和长链契约不改；不回填或手工关闭真实旧需求。
