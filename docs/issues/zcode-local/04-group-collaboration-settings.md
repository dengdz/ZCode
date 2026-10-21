# 04: 从设置启用协作群并保存身份、职责与项目绑定

Status: ready-for-agent

Issue-Tracker: local-markdown

## Parent

[ZCode Local spec](../../local-edition/spec.md)

**What to build:** 用户能在 Local 设置中完成每群配置、必要的一次原生提及核验，并在重启后继续使用。

**Blocked by:** [03 验证共用业务数据并实现双向接管保护](03-data-compatibility-ownership.md)

## Background

现有群开关没有完整表达 PM、执行者职责、唯一授权用户和固定工作区。

## Modules

共享配置协议、Bot 服务与 Local 持久存储、机器人设置界面、工作区身份。不预先固定源码文件名；以实施基线的受控模块上下文为准。

## Acceptance criteria

- [ ] 通过界面选择群、一个 PM、执行者及职责、授权用户和工作区，保存后重启一致；其他群不受影响。
- [ ] 缺可信机器人身份时一次原生提及核验，不能用昵称或手填平台 ID 绕过；改名不改职责。
- [ ] 在办时拒绝关键配置变更，变更成功递增授权版本；Local 新配置不破坏官网旧 Reader。

## Spec coverage

用户故事：26、33、34、35、36、37、38、39、40、68。
验收场景：T01、T06、T16、T17、T24、T25。

## Execution notes

一次只处理本 issue。实现遵循已确认测试边界和 TDD，保留无关改动；验证记录区分实际执行、合成场景与待真实验收。完成后记录改动、验证结果和既有逻辑影响，再置 done。

