# 02: 构建可独立启动的 ZCode Local 候选应用

Status: ready-for-agent

Issue-Tracker: local-markdown

## Parent

[ZCode Local spec](../../local-edition/spec.md)

**What to build:** 产出固定 Local 身份、可在隔离数据下启动的本机签名候选包，并阻断官方包覆盖入口。

**Blocked by:** [01 确定官方基线与可重复的隔离候选](01-baseline-candidate.md)

## Background

旧安装包沿用官方身份，不能明确区分安装来源，也可能走回官方更新流程。

## Modules

桌面产品身份、构建与签名、启动及更新入口、运行时数据定位。不预先固定源码文件名；以实施基线的受控模块上下文为准。

## Acceptance criteria

- [ ] 应用显示固定 Local 名称，安装标识、运行时和相关集成一致，官网版和 Preview 身份不被改写。
- [ ] 普通更新和启动强更等入口不会安装官方包或伪造版本绕过远端限制；不能支持的依赖如实报告。
- [ ] 以本机正常签名、隔离数据完成构建和启动检查；不降低系统保护、不切换日常数据。

## Spec coverage

用户故事：44、46、57、66。
验收场景：T28、T30、T34。

## Execution notes

一次只处理本 issue。实现遵循已确认测试边界和 TDD，保留无关改动；验证记录区分实际执行、合成场景与待真实验收。完成后记录改动、验证结果和既有逻辑影响，再置 done。

