# bot-collaboration

每 Provider/群的配置只有此模块写入，保存到实际数据根 .zcode/local/v1/collaboration.json，version 1。复用 shared 短锁和私有原子写入；未知版本/坏文件不覆盖。官网配置、任务索引格式不扩字段。

getSettings/readBinding 读取权威配置；save 严格校验选项、身份、职责、实际空闲和 expectedRevision，成功变更才递增 revision。beginVerification 产生绑定群、机器人、应用和既有用户的限时一次命令；observeInbound 仅由 Bot Provider 入站调用，校验原生提及、应用、当前绑定用户、租户与 union_id，不是设置 RPC。

withInbound 在同一锁内持久登记接收调用令牌，再调用一次原处理函数，finally 按令牌释放；其他 Host 也能观察。save 在锁内同时核对令牌与注入运行时，不能与正在受理的输入交错变更授权。令牌不含正文，不是执行队列或已受理事实；崩溃遗留记录按未知拒绝变更，实际运行事实仍由既有任务运行时判断，后续恢复由 12 核对。不新建待生效队列。

核验成功由 Bot 服务复用原群激活流程，connected 仍只从原 Repo 读取，普通消息不会自动重开群。配置版本变更后原群卡片授权轮换，原格式只写既有字符串字段。
