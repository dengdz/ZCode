# 12: 在断线和重启后核对状态再恢复

Status: ready-for-agent

Issue-Tracker: local-markdown

## Parent

[ZCode Local spec](../../local-edition/spec.md)

**What to build:** 重建协作状态时先核对执行、停止、卡片和投递记录，安全续接或明确报告状态不明。

**Blocked by:** [08 通过候选卡片选人并自动续发原消息](08-recipient-selection.md)；[11 将用户叫停连接到实际任务停止](11-stop-execution.md)

## Background

缺回报或确认丢失既可能未执行，也可能已执行，自动重派会重复产生副作用。

## Modules

Bot 持久恢复、任务运行时查询、渠道投递核对、卡片待发记录。不预先固定源码文件名；以实施基线的受控模块上下文为准。

## Acceptance criteria

- [ ] 已经执行或发送的工作不因重启/缺回报重复派发，未执行且可安全继续的才恢复。
- [ ] 发送可能成功但收据丢失时先核对，未知状态明确说明，不靠超时重发或假定成功。
- [ ] 旧卡片和旧授权不能复活，停止状态与已有成果保持，重启不改变需求归属。

## Spec coverage

用户故事：21、22、31、38。
验收场景：T12、T15、T22。

## Execution notes

一次只处理本 issue。实现遵循已确认测试边界和 TDD，保留无关改动；验证记录区分实际执行、合成场景与待真实验收。完成后记录改动、验证结果和既有逻辑影响，再置 done。

