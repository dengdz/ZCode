# 08: 通过候选卡片选人并自动续发原消息

Status: ready-for-agent

Issue-Tracker: local-markdown

## Parent

[ZCode Local spec](../../local-edition/spec.md)

**What to build:** 身份不明时给出卡片，合法用户选择后经角色和状态核对，自动续发原消息一次。

**Blocked by:** [06 在派发前拦截错误角色与错误引用](06-dispatch-role-validation.md)；[07 让纯确认轮真正静默结束](07-silent-acknowledgments.md)

## Background

现有澄清结果需要模型重新调用，没有完整的持久待发消息和用户选择闭环。

## Modules

Provider 交互卡片、Bot 待发记录与投递所有者、共享交互协议。不预先固定源码文件名；以实施基线的受控模块上下文为准。

## Acceptance criteria

- [ ] 卡片出现时保持未发送；合法选择后原内容续发，无需重述，且不叠加普通终答或重复发送。
- [ ] 取消、未选、越权点击、错角色、任务或配置已变、无候选及旧卡片均不发送。
- [ ] 并发点击、平台重投和重启后回调沿同一持久去重路径处理；外部结果不明不假报成功。

## Spec coverage

用户故事：28、29、30、31、32、38。
验收场景：T12、T13、T14、T15、T35。

## Execution notes

一次只处理本 issue。实现遵循已确认测试边界和 TDD，保留无关改动；验证记录区分实际执行、合成场景与待真实验收。完成后记录改动、验证结果和既有逻辑影响，再置 done。

