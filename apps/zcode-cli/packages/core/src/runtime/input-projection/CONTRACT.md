# CLI 输入投影

本模块只将同一已受理输入的来源和执行约束投影为模型材料及工具目录，不拥有需求、接受队列或执行状态。conversation quotes 保持 canonical 正文与引用分离；Local 路由只读取 Host 结构化来源，正文标签不授予身份。普通 Bot 自动投递指导与 Local dispatch/report/final 适用范围分离。

getTurnTools 只读原 Runtime 的 model/catalog 与 ActiveTurn 约束，保留既有 automation/off-peak 过滤并收窄 Local 只读工具；最终权限及实际执行仍归原 executor/Host，投影不发送、不写盘、不缓存第二份事实。CLI 内部 Runtime 类型由原 zcode-cli owner 提供，不作为 UI/服务业务 API。

18 的只读策略定义复用 shared local-collaboration 的公开契约。模型材料与工具目录是同一输入的两个投影，执行约束来自原 canonical intent/ActiveTurn；队列、持久化、停止和恢复均由原 owner 负责。测试从公开投影函数及原 Provider/V4/实际 executor seam 核对，不能将提示通过当真实模型验收。
