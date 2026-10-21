# Bot渠道回复

登记既有 channelReply.ts 的发送授权边界，保留原公开导入路径。readBinding 从当前 task/input/workspace、群 owner 和原生来源重读授权；投递仍委托同一既有 owner，以 task/input/toolCallId 去重。

Local prepare 端口只负责协作方向与原需求目标，不自行发送。明确协作意图在非 Local 宿主拒绝；未声明意图的普通群行为和既有幂等 hash 保持。查询外部目录后继续重读授权，不接受裸平台 ID。

同一边界同时登记既有 groupResultDelivery owner，保留旧公开导入路径。最终发送前调用协作 authorizeDelivery 校验当前版本、来源及目标；撤销以 deliveryInvalidated 错误标记进入原 owner 的 invalidated 终态，不按网络 failed 重试，也不新建发送路径。
