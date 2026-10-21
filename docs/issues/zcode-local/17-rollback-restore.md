# 17: 分开提供程序回退与数据快照恢复

Status: ready-for-agent

Issue-Tracker: local-markdown

## Parent

[ZCode Local spec](../../local-edition/spec.md)

**What to build:** 维护入口能选择兼容的程序回退，必要时在明确确认后恢复旧数据，并保护当前结果。

**Blocked by:** [16 从维护入口安全切换到候选版本](16-safe-installation.md)

## Background

退回旧程序可能还能保留当前数据，直接恢复旧快照则会丢失新增内容。

## Modules

维护命令的回退/恢复能力、版本兼容检查、备份清单与应用启动。不预先固定源码文件名；以实施基线的受控模块上下文为准。

## Acceptance criteria

- [ ] 旧程序兼容时保留当前业务数据；不兼容时禁止直接打开。
- [ ] 必须恢复旧数据时先备份当前数据，展示旧快照时间和损失影响，明确确认前不覆盖。
- [ ] 恢复失败保留可核对状态与有效快照，不宣称无损跨版合并，隔离演练验证可恢复结果。

## Spec coverage

用户故事：62、63、64、65。
验收场景：T32、T33。

## Execution notes

一次只处理本 issue。实现遵循已确认测试边界和 TDD，保留无关改动；验证记录区分实际执行、合成场景与待真实验收。完成后记录改动、验证结果和既有逻辑影响，再置 done。

