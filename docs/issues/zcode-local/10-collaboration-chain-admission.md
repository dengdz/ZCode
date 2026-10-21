# 10: 允许合法协作长链持续推进

Status: ready-for-agent

Issue-Tracker: local-markdown

## Parent

[ZCode Local spec](../../local-edition/spec.md)

**What to build:** 仅为启用协作的群改造接收策略，让合法长链持续运行，同时保持身份、去重、串行和静默保护。

**Blocked by:** [06 在派发前拦截错误角色与错误引用](06-dispatch-role-validation.md)；[07 让纯确认轮真正静默结束](07-silent-acknowledgments.md)；[09 保证同一项目实际执行串行](09-project-serial-execution.md)

## Background

固定五条机器人消息守卫会截断正常工作，直接移除又会失去终止保护。

## Modules

Bot 群消息受理、持久去重、角色与任务作用域。不预先固定源码文件名；以实施基线的受控模块上下文为准。

## Acceptance criteria

- [ ] 超过五条的正常派单/回报链仍可推进，不以调大固定数字作为实现。
- [ ] 无授权来源、重复事件和纯确认不会借长链策略重新开始工作。
- [ ] 未启用群的原保护不被全局移除，多轮与重启场景有证据。

## Spec coverage

用户故事：17、41。
验收场景：T11、T12。

## Execution notes

一次只处理本 issue。实现遵循已确认测试边界和 TDD，保留无关改动；验证记录区分实际执行、合成场景与待真实验收。完成后记录改动、验证结果和既有逻辑影响，再置 done。

