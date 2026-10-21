# 16: 从维护入口安全切换到候选版本

Status: ready-for-agent

Issue-Tracker: local-markdown

## Parent

[ZCode Local spec](../../local-edition/spec.md)

**What to build:** 用户发起安装后，条件满足即自动完成切换；有在办任务或状态不明时仅准备候选并等待。

**Blocked by:** [09 保证同一项目实际执行串行](09-project-serial-execution.md)；[15 备份应用与业务数据并验证保留策略](15-backup-retention.md)

## Background

构建与备份各自成功，还不等于能安全完成退出、替换、启动和连接核对。

## Modules

维护命令的安装能力、运行时任务状态、桌面进程生命周期、连接核对。不预先固定源码文件名；以实施基线的受控模块上下文为准。

## Acceptance criteria

- [ ] 候选验证通过、任务结束和备份成功后提示并正常退出、替换 Local、启动和核对连接，不逐步重复审批。
- [ ] 忙碌、未知、退出失败、备份失败或兼容检查失败时停止切换，不强杀，不覆盖官网应用。
- [ ] 隔离安装演练成功，故障如实报告并保留恢复依据；真实日常切换仍遵守用户主动发起和系统权限条件。

## Spec coverage

用户故事：56、58、60、61、67。
验收场景：T27、T31、T34。

## Execution notes

一次只处理本 issue。实现遵循已确认测试边界和 TDD，保留无关改动；验证记录区分实际执行、合成场景与待真实验收。完成后记录改动、验证结果和既有逻辑影响，再置 done。

