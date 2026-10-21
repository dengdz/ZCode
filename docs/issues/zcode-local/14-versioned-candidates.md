# 14: 从维护入口生成可追溯的版本候选

Status: ready-for-agent

Issue-Tracker: local-markdown

## Parent

[ZCode Local spec](../../local-edition/spec.md)

**What to build:** 建立统一维护入口的检查/构建能力，结合用户 fork、版本分支和候选清单重复产出可核验版本。

**Blocked by:** [02 构建可独立启动的 ZCode Local 候选应用](02-local-app.md)

## Background

一次手工构建不能承担长期更新、远端备份和版本追溯。

## Modules

本地维护命令、Git 远端与版本元数据、官方构建链、公开内容检查。不预先固定源码文件名；以实施基线的受控模块上下文为准。

## Acceptance criteria

- [ ] origin 为核实归属后的用户 fork，upstream 为官方且不误推；通用代码与私有材料分开。
- [ ] 用户主动触发检查/构建，冲突或验证失败停止；官方已解决的补丁可退役，不后台安装。
- [ ] 候选版本、分支、源码锚点、包元数据对应，发布采用固定标签且不改写已发布内容；工具链可持续复现。

## Spec coverage

用户故事：50、51、52、53、54、55、56、58、59、71、72。
验收场景：T29、T30、T35。

## Execution notes

一次只处理本 issue。实现遵循已确认测试边界和 TDD，保留无关改动；验证记录区分实际执行、合成场景与待真实验收。完成后记录改动、验证结果和既有逻辑影响，再置 done。

