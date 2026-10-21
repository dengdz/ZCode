# 13: 落实 PM 审核、依赖推进与用户验收闭环

Status: ready-for-agent

Issue-Tracker: local-markdown

## Parent

[ZCode Local spec](../../local-edition/spec.md)

**What to build:** 通过通用角色上下文和既有需求记录，让 PM 按已确认规则持续推进，并区分代码保证与模型判断。

**Blocked by:** [10 允许合法协作长链持续推进](10-collaboration-chain-admission.md)；[12 在断线和重启后核对状态再恢复](12-state-reconciliation.md)

## Background

机制可发送不代表 PM 会正确核验、判断等待依赖或结束无进展整改。

## Modules

Bot 角色上下文与规则注入、PM 需求记录接口、受控行为场景。不预先固定源码文件名；以实施基线的受控模块上下文为准。

## Acceptance criteria

- [ ] 目标内连续推进；等待用户时只派发无依赖工作，不编造答复，不把待验收视为关闭。
- [ ] 核对产物和验证证据；同一问题三轮无进展向用户说明，正常阶段交接不误计。
- [ ] 最终汇报后仅明确用户通过才关闭，反馈继续原需求；不接入 Jev，不改业务仓库章程，不把脚本输出当作真实模型可靠性证明。

## Spec coverage

用户故事：5、6、10、11、12、14、15、16、17、42、43。
验收场景：T19、T20、T23。

## Execution notes

一次只处理本 issue。实现遵循已确认测试边界和 TDD，保留无关改动；验证记录区分实际执行、合成场景与待真实验收。完成后记录改动、验证结果和既有逻辑影响，再置 done。

