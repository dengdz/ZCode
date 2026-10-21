# 06: 在派发前拦截错误角色与错误引用

Status: ready-for-agent

Issue-Tracker: local-markdown

## Parent

[ZCode Local spec](../../local-edition/spec.md)

**What to build:** 派单声明所需角色，实际收件人不匹配时保持未派发，并给出可纠正的原因。

**Blocked by:** [05 走通可信派单、回报与原需求用户归属](05-trusted-handoffs.md)

## Background

合法引用仍可能指向不适合该任务的机器人。

## Modules

Agent 渠道回复契约、角色校验、Bot 投递及结果展示。不预先固定源码文件名；以实施基线的受控模块上下文为准。

## Acceptance criteria

- [ ] 合法但指向错误角色的引用被发送前拦截，不产生错误目标消息或执行任务。
- [ ] 原生身份、群授权和当前职责共同核对，用户选人也不能暗改职责。
- [ ] 语义归类仍由 PM 判断，测试与说明不把角色绑定校验写成通用语义识别。

## Spec coverage

用户故事：27、32、42。
验收场景：T07。

## Execution notes

一次只处理本 issue。实现遵循已确认测试边界和 TDD，保留无关改动；验证记录区分实际执行、合成场景与待真实验收。完成后记录改动、验证结果和既有逻辑影响，再置 done。

