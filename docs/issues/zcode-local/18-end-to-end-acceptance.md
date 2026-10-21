# 18: 完成整体回归与真实群只读验收

Status: ready-for-agent

Issue-Tracker: local-markdown

## Parent

[ZCode Local spec](../../local-edition/spec.md)

**What to build:** 汇总所有子项证据，在项目群空闲时验证真实闭环与关键异常，形成待用户确认的最终交付。

**Blocked by:** [13 落实 PM 审核、依赖推进与用户验收闭环](13-pm-review-acceptance.md)；[17 分开提供程序回退与数据快照恢复](17-rollback-restore.md)

## Background

单项合成测试和安装成功不能证明完整 PM 协作与长期维护可交付。

## Modules

集成与界面回归、隔离维护演练、真实群只读场景、交付证据。不预先固定源码文件名；以实施基线的受控模块上下文为准。

## Acceptance criteria

- [ ] 覆盖父 spec T01–T36，明确合成、真实、受限和未执行证据，所需检查真实执行且失败有归属。
- [ ] 指定群空闲时走通用户→PM→执行者→PM→用户，以及静默、错角色/卡片、长链、停止和恢复关键场景，不改业务代码、不部署、不打断工作。
- [ ] 核对最少诊断和公开内容边界，用户明确验收后才视为整体通过；不擅自关闭或改写父 spec。

## Spec coverage

用户故事：12、13、14、15、16、17、19、21、22、25、41、49、67、69、70、72。
验收场景：T36。

## Execution notes

一次只处理本 issue。实现遵循已确认测试边界和 TDD，保留无关改动；验证记录区分实际执行、合成场景与待真实验收。完成后记录改动、验证结果和既有逻辑影响，再置 done。

