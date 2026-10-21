# 11: 将用户叫停连接到实际任务停止

Status: ready-for-agent

Issue-Tracker: local-markdown

## Parent

[ZCode Local spec](../../local-edition/spec.md)

**What to build:** PM 能停止后续派发，向原执行任务发出真实停止请求并核对状态，保留现有工作成果。

**Blocked by:** [09 保证同一项目实际执行串行](09-project-serial-execution.md)

## Background

一句收到停止不能证明当前执行或后续排队工作已经结束。

## Modules

PM 控制意图、任务运行时停止接口、群队列与结果回报。不预先固定源码文件名；以实施基线的受控模块上下文为准。

## Acceptance criteria

- [ ] 只有可信授权用户可以叫停，PM 停止后续派发并作用到原任务。
- [ ] 区分已停止、正在停止、无法立即停止，不能以请求成功代替实际结果。
- [ ] 已有文件、改动及外部结果保留；队列不在叫停后继续派发被停止的工作。

## Spec coverage

用户故事：18、19、20。
验收场景：T02、T21。

## Execution notes

一次只处理本 issue。实现遵循已确认测试边界和 TDD，保留无关改动；验证记录区分实际执行、合成场景与待真实验收。完成后记录改动、验证结果和既有逻辑影响，再置 done。

