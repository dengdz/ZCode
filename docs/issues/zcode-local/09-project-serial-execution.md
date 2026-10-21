# 09: 保证同一项目实际执行串行

Status: ready-for-agent

Issue-Tracker: local-markdown

## Parent

[ZCode Local spec](../../local-edition/spec.md)

**What to build:** 依据固定项目身份复用运行时受理与排队，使新工作等待在办执行结束，不新增平行调度器。

**Blocked by:** [05 走通可信派单、回报与原需求用户归属](05-trusted-handoffs.md)

## Background

多个机器人会话各自串行，并不代表同一项目不会同时执行。

## Modules

群工作区绑定、任务运行时受理与队列、Bot 任务关联及可见状态。不预先固定源码文件名；以实施基线的受控模块上下文为准。

## Acceptance criteria

- [ ] 同项目不同机器人上下文同时收到工作时，实际执行不重叠，新需求有明确排队状态。
- [ ] 其他群或桌面切换不改本群项目；工作区身份及现有 owner/lease 防护保持。
- [ ] 停止或失效后队列状态可核对，界面和 Bot 服务不各保存一份已受理队列。

## Spec coverage

用户故事：8、9、36、37。
验收场景：T16、T17、T18。

## Execution notes

一次只处理本 issue。实现遵循已确认测试边界和 TDD，保留无关改动；验证记录区分实际执行、合成场景与待真实验收。完成后记录改动、验证结果和既有逻辑影响，再置 done。

