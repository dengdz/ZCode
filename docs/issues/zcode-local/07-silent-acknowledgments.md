# 07: 让纯确认轮真正静默结束

Status: ready-for-agent

Issue-Tracker: local-markdown

## Parent

[ZCode Local spec](../../local-edition/spec.md)

**What to build:** 明确静默意图覆盖整个可见投递链，同时保留正式工作、错误及阻塞消息。

**Blocked by:** [05 走通可信派单、回报与原需求用户归属](05-trusted-handoffs.md)

## Background

普通终答、流式内容和空输出兜底都可能重新提及机器人。

## Modules

Agent 输出契约、Bot 终答与流式投递、Provider 卡片和空输出处理。不预先固定源码文件名；以实施基线的受控模块上下文为准。

## Acceptance criteria

- [ ] 纯确认轮不生成群消息、自动提及、引用或卡片，不先发后撤。
- [ ] 空输出不被补成完成回报，普通终答与流式模式表现一致。
- [ ] 正式派单、回报、追问、错误和最终交付仍能发送，未启用群保持既有行为。

## Spec coverage

用户故事：23、24、25。
验收场景：T08、T09、T10。

## Execution notes

一次只处理本 issue。实现遵循已确认测试边界和 TDD，保留无关改动；验证记录区分实际执行、合成场景与待真实验收。完成后记录改动、验证结果和既有逻辑影响，再置 done。

