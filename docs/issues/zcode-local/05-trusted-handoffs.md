# 05: 走通可信派单、回报与原需求用户归属

Status: ready-for-agent

Issue-Tracker: local-markdown

## Parent

[ZCode Local spec](../../local-edition/spec.md)

**What to build:** 从可信用户输入走通一次用户→PM→执行者→PM→用户的短链，明确发送意图，保持原需求归属。

**Blocked by:** [04 从设置启用协作群并保存身份、职责与项目绑定](04-group-collaboration-settings.md)

## Background

当前轮次发送者会覆盖 initiator，普通群成员也可能被当作任务来源。

## Modules

Provider 入站身份、共享任务来源协议、Bot 受理与投递、Agent 渠道回复契约。不预先固定源码文件名；以实施基线的受控模块上下文为准。

## Acceptance criteria

- [ ] 授权用户、PM 和执行者按配置路由；用户直派引导回 PM，执行者不能互派，其他真人不能改任务。
- [ ] 原需求用户跨轮保留，最终汇报原生提及正确用户，不跟随当前回报者或正文身份声明。
- [ ] 复用已有多应用绑定与投递路径，记录必要本机来源/结果诊断；集成测试观察实际收件人与任务受理。

## Spec coverage

用户故事：1、2、3、4、7、13、26、69。
验收场景：T02、T03、T04、T05、T16、T35。

## Execution notes

一次只处理本 issue。实现遵循已确认测试边界和 TDD，保留无关改动；验证记录区分实际执行、合成场景与待真实验收。完成后记录改动、验证结果和既有逻辑影响，再置 done。

