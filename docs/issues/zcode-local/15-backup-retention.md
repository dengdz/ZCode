# 15: 备份应用与业务数据并验证保留策略

Status: ready-for-agent

Issue-Tracker: local-markdown

## Parent

[ZCode Local spec](../../local-edition/spec.md)

**What to build:** 通过维护入口创建、核对和列出应用/数据备份，保留最近三组可用恢复基线。

**Blocked by:** [14 从维护入口生成可追溯的版本候选](14-versioned-candidates.md)

## Background

没有一致且可恢复的备份，就不能安全替换日常应用。

## Modules

维护命令的备份能力、数据定位、版本与备份清单、本机私有存储。不预先固定源码文件名；以实施基线的受控模块上下文为准。

## Acceptance criteria

- [ ] 应用、业务数据和 Local 必要记录形成一致备份，可对应版本/时间/源码锚点并验证恢复可用性。
- [ ] 备份失败、空间不足或不完整时不继续替换，失败快照不挤掉有效备份。
- [ ] 只清理明确备份目录，保留最近三组可用备份并保护在用数据和唯一恢复基线，不上传 fork。

## Spec coverage

用户故事：62、63。
验收场景：T27、T32。

## Execution notes

一次只处理本 issue。实现遵循已确认测试边界和 TDD，保留无关改动；验证记录区分实际执行、合成场景与待真实验收。完成后记录改动、验证结果和既有逻辑影响，再置 done。

