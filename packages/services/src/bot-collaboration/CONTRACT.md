# bot-collaboration

每 Provider/群的配置只有此模块写入，保存到实际数据根 .zcode/local/v1/collaboration.json，version 1。复用 shared 短锁和私有原子写入；未知版本/坏文件不覆盖。官网配置、任务索引格式不扩字段。

getSettings/readBinding 读取权威配置；save 严格校验选项、身份、职责、实际空闲和 expectedRevision，成功变更才递增 revision。beginVerification 产生绑定群、机器人、应用和既有用户的限时一次命令；observeInbound 仅由 Bot Provider 入站调用，校验原生提及、应用、当前绑定用户、租户与 union_id，不是设置 RPC。

已启用配置的关闭是纯撤销，只核对版本与实际空闲，保留原身份/职责/项目，不采纳请求中的其他字段。已保存群名用于成员全部移除后的撤销入口，不是身份依据。新建、重新启用及其他变更仍严格核对可信选项。

withInbound 在同一锁内持久登记接收调用令牌，再调用一次原处理函数，finally 按令牌释放；其他 Host 也能观察。save 在锁内同时核对令牌与注入运行时，不能与正在受理的输入交错变更授权。令牌不含正文，不是执行队列或已受理事实；崩溃遗留记录按未知拒绝变更，实际运行事实仍由既有任务运行时判断，后续恢复由 12 核对。不新建待生效队列。

核验成功由 Bot 服务复用原群激活流程，connected 仍只从原 Repo 读取，普通消息不会自动重开群。配置版本变更后原群卡片授权轮换，原格式只写既有字符串字段。

05：同一所有者在 Local 文件保存原需求、执行输入关联及渠道交接索引，不保存正文或执行队列。入站只接受授权真人→PM、已确认发送的PM→执行者/执行者→PM；交接必须核对原生消息ID、身份、群/线程与当前版本。ReplyToChannel 明确意图后由所有者重读 inputId/taskId/workspace 与原需求，生成唯一原生收件人并关联既有 deliveryId；发送与结果仍由原渠道投递 owner 维护。新归属不写官网 Bot v3；CLI 获得精简上下文材料，不把模型声明当作身份事实。

构造端口单独声明于 port.ts，与提供给调用方的业务接口分离；两者仍由同一服务实现，不增加所有者。首次可信派单可沿既有话题创建入口接入，显式停用不重开；来源输入已停止/取消/丢弃或投递结果未知时不受理迟到交接。发送前核对目标群及当前项目目录与权限。

authorizeDelivery 由既有投递 owner 在最终发送前重读 Local 配置、来源索引及目标接入/权限；准备后失效返回 false，由原 owner 记录 invalidated。它不重试、不发送、不复制结果状态，普通未启用群保持原路径。

ledger.ts 只定义本模块 Local 持久格式及规范化规则，供同一所有者读写与幂等比较复用，不提供第二个业务服务。

06：prepareReply 接收 Host 从实际执行来源解析的可信引用，只允许一个匹配当前核验目标的 mention；声明职责必须与当前配置精确相同，否则返回 blocked 并不写交接。Local handoff 保存 requiredDuty，最终发送和输入受理也核对；不做正文语义识别，不因用户选择改职责。

dispatchValidation.ts 是同一模块内的纯职责/引用校验，无 IO 或状态；服务先从实际配置取得目标与职责后调用它，再由原 owner 保存关联和投递。

07：prepareReply 接受 silent，保存当前输入 replyIntent 并返回严格 silent 控制结果，不创建 handoff/delivery；inputOrigin 返回该意图。正式发送尝试先写 visible，后续 silent 拒绝；静默不覆盖已发生投递或错误。调用者在终态按实际输入重读，不跨输入缓存权威意图。
