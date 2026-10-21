# 03: 验证共用业务数据并实现双向接管保护

Status: ready-for-agent

Issue-Tracker: local-markdown

## Parent

[ZCode Local spec](../../local-edition/spec.md)

**What to build:** 在隔离条件验证官网与 Local 的两种启动顺序，避免双重接管，确认历史数据、凭据及 Local 扩展存储域的兼容边界。

**Blocked by:** [02 构建可独立启动的 ZCode Local 候选应用](02-local-app.md)

## Background

独立 App 和单个连接锁不足以保证官网版与 Local 能安全共用业务数据；该核心可行性须在群协作扩展前验证。

## Modules

桌面启动与进程占用、数据访问边界、Bot 连接所有权、Local 兼容存储。不预先固定源码文件名；以实施基线的受控模块上下文为准。

## Acceptance criteria

- [ ] 官网先启动和 Local 先启动均验证；普通启动提示退出占用方，不强杀，不以 Local 私有锁宣称双向完成。
- [ ] 官网 Reader、项目/会话历史和机器人配置可用，验证 Local 扩展存储域不会破坏共用格式；后续实际群配置继续回归这一契约。
- [ ] 使用隔离数据和既有凭据机制核对可用性，不读取 Secret 或接管真实机器人；不兼容先报告，不能降级保护后推进日常运行。

## Spec coverage

用户故事：45、47、48、66、67、68。
验收场景：T25、T26、T27、T34。

## Execution notes

一次只处理本 issue。实现遵循已确认测试边界和 TDD，保留无关改动；验证记录区分实际执行、合成场景与待真实验收。完成后记录改动、验证结果和既有逻辑影响，再置 done。

