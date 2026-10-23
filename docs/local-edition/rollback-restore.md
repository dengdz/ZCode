# 17 程序回退与数据快照恢复

Status: in-progress

对应[工单 17](../issues/zcode-local/17-rollback-restore.md)。产品规则、所有者、事件顺序和验收范围以该工单及冻结父规格为准，不复制验收矩阵。

## 使用

使用 `mise.toml` 的 Node/pnpm，在仓库根运行统一维护入口。先让当前 Local 正常退出，再在同一真实 home/data 身份下生成计划；正在运行、未知 owner、遗留 gate、损坏快照或参数身份不符都会停止。以下路径均须替换成主动选择的绝对路径，示例不指向日常数据。

```sh
mise exec -- pnpm local:maintain backup-list --backup-root /absolute/private-backups
mise exec -- pnpm local:maintain rollback-plan \
  --id backup-UUID --current-manifest /absolute/current-candidate/candidate.json \
  --home /absolute/selected-home --data-root /absolute/selected-data \
  --local-app '/absolute/Applications/ZCode Local.app' \
  --official-app '/absolute/Applications/ZCode.app' \
  --backup-root /absolute/private-backups
```

计划保存为备份根 `recovery-UUID/plan.json`，stdout 包含 id、planSha256、currentDataSha256、from/to、snapshotTime、loss 和 warning。计划不是兼容证明；版本号、签名和 `local-host-ready` 也不证明数据格式、真实登录、模型或机器人连接兼容。

维护者检查两端存储/迁移源码并用隔离 Reader 等证据确认兼容后，另存私有 JSON：schema=1、kind=`local-rollback-compatibility`、decision=`compatible`；planSha256、currentDataSha256 和完整 from/to 对象逐项取自本次计划，evidence 写明可核对依据。from/to 包含候选原有的 version、branch、commit、tree、tag、tagCreated；不可只抄短 SHA。程序要求计划和当前数据未变化且审阅完全匹配，未知或 incompatible 一律不启动旧程序。

```sh
mise exec -- pnpm local:maintain rollback \
  --backup-root /absolute/private-backups --plan recovery-UUID \
  --compatibility /absolute/private-compatibility-review.json
```

回退只替换 Local 应用，保留当前业务数据，先按 15 创建并独立 verify 当前备份。支持维护协议 1 的目标复用 16 的正常退出、staging、原子替换、takeover 和 Host-ready；成功返回 rolled-back。早期无该协议的目标返回 rolled-back-stopped，替换后保持停止，不对其发送 SIGUSR2、不伪造连接核对。目标来源是重验的 ready backup；16 留下的 previous app 是人工核对线索，不能只凭文件名安装。

## 恢复旧数据

```sh
mise exec -- pnpm local:maintain restore-plan \
  --id backup-UUID --current-manifest /absolute/current-candidate/candidate.json \
  --home /absolute/selected-home --data-root /absolute/selected-data \
  --local-app '/absolute/Applications/ZCode Local.app' \
  --official-app '/absolute/Applications/ZCode.app' \
  --backup-root /absolute/private-backups
```

先阅读 snapshotTime、loss 和 warning。loss 的 added 是当前新增、恢复后丢失的文件/链接数，modified 是会被旧值覆盖的数量，removed 是当前已删除、恢复后重新出现的旧成员数；不输出正文，也不声称识别数据库内每条任务的差异。恢复是旧快照的全量业务替换，不是跨版合并。真实数据必须由用户主动选择并明确确认；本轮只验证合成数据。

```sh
mise exec -- pnpm local:maintain restore \
  --backup-root /absolute/private-backups --plan recovery-UUID \
  --confirm '<该计划返回的完整 planSha256>'
```

缺少或不匹配的确认不会退出应用或覆盖数据。确认后仍重验计划、当前数据和快照；已变更需重新生成预览。入口使用原两阶段退出和 switching owner，在数据替换前创建并独立 verify 当前应用/数据备份，输出 currentBackupId。恢复业务条目及 Local v1；保留现有 owner、控制目录和 profile。成功返回 restored-stopped，应用文件不变且保持停止。随后启动哪一程序，必须另行确认它兼容恢复数据。

计划和恢复前备份会在对应组写 `.recovery-pin`。普通备份仍保留最近三组有效基线，并额外保留所有 pin；pin 不证明载荷有效。确定计划、journal 和恢复前材料不再需要后，才可由维护者人工归档并清理 pin。入口不按时间自动解除 pin、owner 或 gate。

## 故障核对与人工边界

恢复日志在备份根 `recovery-UUID/journal.json`，包括 currentBackupId、phase、每个 current/before/after 路径、改名意图及完成标记。工作副本在各显式根 `.zcode-restore-recovery-UUID/`，与目标同文件系统。替换失败会逆序恢复当前条目并核对原数据指纹，确认后才释放 owner/gate；失败或进程崩溃保留所有材料并阻止后续受控启动。

人工处理必须先完成以下核对，无法证明时继续停止，不能仅删除锁再试：

1. 私有归档两个根的 `.zcode/local/launch-owner.json`，数据根 maintenance 内 gate.json、request/response/commit、runtime.json 与 launcher.log，以及计划、journal 和所有 before/after。记录原 token、PID、版本和路径，不外传正文或凭据。
2. 对照两根 owner 和 gate token，检查 launcher、child、整个进程组以及配置的两类 .app 下所有进程。仅观察退出不能证明所有业务副作用已结束；还需核对 09/12 原任务、项目执行租约和恢复证据。要求用户正常退出残留应用，不强杀、不按 PID 消失或超时自动夺权。部分/损坏记录、未配置副本或无法确认的写进程都保留阻塞。
3. 程序切换失败区分尚未产生新 PID 与新应用已经启动。前者仅在原 token 的 switching owner 与 gate 一致且无进程时可走原 abortSwitch；后者不自动覆盖目标。核对目标、previous、原 ready backup 的完整树、签名、源码与数据兼容，再决定程序回退输入。
4. 数据恢复半途崩溃时，journal 是意图记录：进程可能在改名后、完成标记落盘前退出。逐条对照 current/before/after 实际存在和哈希，不只信 moved/placed。优先将 before 中的当前数据完整恢复；缺少或不可核对时，使用已独立 verify 的 currentBackupId 在另一个私有目录演练后再制定恢复操作。home setting.json 也须还原且 dataBaseDir 与显式根一致。
5. 只有写进程确实结束、每个数据条目与所选完整基线一致、当前应用可核对且原证据已归档时，维护者才可人工解除精确匹配的遗留控制记录。此步骤没有 force/TTL 命令，不是日常切换步骤。真实覆盖仍需用户主动触发和明确确认。

## 验证与交付

实施与复审进行中。证据位于仓库外 `~/.local/share/zcode-local/research/issue-17/`；最终结果在本节收尾记录。当前不涉及日常应用安装、日常数据接管、真实凭据/模型/机器人、发布标签或 18 的整体真实验收。
