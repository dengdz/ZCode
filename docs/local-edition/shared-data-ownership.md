# 03：共用数据与受控启动

对应 [03 工单](../issues/zcode-local/03-data-compatibility-ownership.md)。官方基线为 `3c5b227649371507ddc4eb46ac5133afe6db1cab`（3.16.2），Local 为 `3.16.2-local.1`。实现与验证日期：2026-10-21。

## 支持的使用方式

官网版与 Local 共用既有业务数据，两版均从 `pnpm local:launch` 进入。入口持有占用记录并等待应用完全退出；发现占用时提示用户退出原应用，不启动第二版、不强杀。官网原始程序保留，入口不修改签名应用。

用户已明确接受该边界，原文及问题全文见 [03 补充裁定](../issues/zcode-local/03-data-compatibility-ownership.md#启动方式补充裁定)。直接打开原始 .app 或其他副本可绕过入口，不能宣称仍有双向保护。02 的 .app 是原始候选，尚未成为带受控入口的日常安装包；可分发入口与安装、备份、恢复归 14–17。

## 选择依据与所有权

Electron 41.0.3 的 POSIX singleton 默认允许处理无响应进程。最小 Electron 隔离实测中，正常响应时两种顺序均拒绝第二进程；暂停第一个进程后，两种顺序均在约 20.4 秒终止旧进程并接管。日志实际记录 `SIGKILL`，因此不能把共享 native profile 称为无强杀保护。

源码依据：[Electron v41.0.3 app 实现](https://github.com/electron/electron/blob/v41.0.3/shell/browser/api/electron_api_app.cc)、[Chromium 146.0.7680.80 POSIX singleton](https://chromium.googlesource.com/chromium/src/+/refs/tags/146.0.7680.80/chrome/browser/process_singleton_posix.cc)。下载副本与四组最小复现结果保存在本机证据目录；没有暂停或终止用户的官网应用。

新托管模块 `local-launch` 是启动占用的唯一所有者，CLI 只解析参数并调用其契约：

| 边界 | 规则 |
|---|---|
| 数据身份 | home 与实际业务根共同参与；占用文件父目录 realpath 去重、按固定顺序加锁；两个 home 指向同一业务根也互斥 |
| 自定义目录 | 异步读取 home 设置中的 dataBaseDir；`--data-root` 显式选择实际根，默认 home；保存的根与选择不一致时拒绝启动，不创建重定向目标 |
| 原有业务数据 | 继续由原服务读写 `.zcode/v2`，不新增官网文件字段，不改 SQLite schema |
| Electron profile | 两版各用 `.zcode/local/profiles/official`、`local`；session 子目录独立 |
| 占用记录 | home 与业务根各自的 `.zcode/local/launch-owner.json`，相同目录去重；version 1，短锁内原子写入同一 token、版本身份、启动器/子进程 PID 与阶段 |
| Local 业务扩展 | 预留 `.zcode/local/v1/`；本票只使用合成兼容标记，不提前实现 04 的协作设置 |
| 进入顺序 | 规范化 home 与显式业务根 → 在固定顺序的短锁内检查全部记录与现存应用进程 → 全部保存 preparing → spawn → 全部保存 running |
| 释放条件 | 退出码 0、无退出信号、实际进程组结束，且配置的应用包下没有剩余进程，再按原 token 释放 |
| 异常处理 | 损坏、未知版本、入口崩溃、异常退出及子进程未确认结束均拒绝下一次启动；不按时间自动夺锁 |

观察进程只使用信号 0。3 秒观察期限只会产生 `unconfirmed`，不会把超时解释为退出。入口不接管 Bot 任务、会话或数据写入权限。首次使用还会观察两个配置的 .app 路径下是否已有主进程或 Helper；其他未配置副本及绕过入口的启动竞争属于已披露的使用边界。

异常保留的占用记录没有自动清理或强行接管命令。先核对进程和数据状态，再按后续维护流程恢复；不要将手动删除记录作为日常切换步骤。

## 验证结果

| 检查 | 结果与证据边界 |
|---|---|
| 受控入口集成测试 | 审查补正后 16 项实际子进程测试通过；覆盖两种占用顺序、无响应、并发启动、入口崩溃、残留子进程、目录别名、未知/损坏记录、直接运行的已配置应用、业务文件保留和自定义业务根 |
| 模块契约测试 | 1 项通过；无效应用在创建业务 home 前被拒绝 |
| 既有存储回归 | 6 文件 / 43 项通过，包含 Bot 迁移、凭据、项目降级与任务数据库迁移 |
| 固定官网 Reader | 从官方基线独立 worktree 安装冻结依赖。Local 写入合成项目/历史/禁用机器人 → 官网 Reader 读取并更新 → Local 读回，全部断言通过；扩展目录标记保持完整 |
| 实际签名应用 | 原样复制官网 3.16.2，与 02 已签名 Local 候选分别验证默认根、自定义根及两种先后顺序；最终探针记录欢迎页、无 pageErrors、占用请求退出 2、正常退出 0 后全部记录释放和另一版可切换，自定义根实际生成任务索引数据库 |
| 实际路径 | 最终探针不调用 `app.setPath`；由入口环境和应用原有路径逻辑生效，运行时断言同一 home、独立 userData / sessionData |
| 应用签名 | 测试后官网副本与 Local 候选均通过 `codesign --verify --deep --strict`；原 `/Applications/ZCode.app` 未改动 |
| 既有凭据机制 | 正常宿主上下文调用既有凭据服务，只返回计数：present 2、readable 2、failed 0。系统沙箱禁止文件写入及网络，未输出值、未复制凭据 |
| 源码兼容 | 相对固定官网基线，任务索引、项目存储、Bot repo/config、凭据与共享校验源码差异为空；03 没有调整官网格式 |
| 类型、Lint、架构 | 类型检查通过；Lint 0 errors、96 条既有警告；架构检查 0 新违规，新增启动模块已托管 |
| 全量单测（审查补正前，仅一次） | 2051 文件通过、1 文件失败、2 文件跳过；19970 项通过、1 项失败、10 项跳过，537.91 秒。失败是既有 `gen-ui/adapters/stateStorage.test.ts` 原生文件监听用例 30 秒超时；该文件单独重跑 3 项全部通过，未改源码或断言。超时原因未确认，不能将全量写成通过 |
| 补正后相关回归 | 启动入口与契约共 2 文件 / 17 项通过；自定义根新增 3 项均保留红→绿日志，另保留上述文件监听用例的独立重跑结果；未重复全量 |

项目与历史是存储服务边界的合成数据，不代表已登录的 Agent 会话在 UI 中执行过任务；实际应用测试使用空白隔离数据，只验证欢迎页与进程切换。凭据可解密不等于远端登录、OAuth 回调或真实机器人连接已验收。后续真实群配置继续回归同一数据契约，最终验收归 18。

实际应用探针通过 Inspector 在打包 JS 执行前拦截全局协议注册与更新器检查/下载/安装，以免改变日常默认协议或让官网副本执行更新。没有改动签名文件、应用名、版本或身份，没有修改受控入口的占用判定。早期探针额外设置过路径，`controlled-env-*` 重跑去除了这一设置；自定义目录补正后再以 `controlled-final-*`、`controlled-custom-*` 完成八次启动和四次占用拒绝，均未设置路径，仅以最终结果作为入口环境生效的依据。

## 命令与退出结果

从仓库根使用固定 Node 24.14.0、pnpm 10.33.2。以下是隔离验证示例，三个路径必须替换为实际候选与新建测试 home：

```sh
pnpm local:launch --edition local \
  --home /absolute/path/to/isolated-home \
  --official-app /absolute/path/to/official-copy/ZCode.app \
  --local-app '/absolute/path/to/candidate/ZCode Local.app'
```

切换官网时使用同一组路径并改为 `--edition official`。命令会一直等待应用退出，不能把“命令尚未返回”当作卡死。入口支持 macOS；其他平台启动逻辑保持既有行为。应用参数可在 `--` 后按数组透传，不经 shell 拼接。

已有设置指定自定义业务目录时，保留原 home，并增加 `--data-root /absolute/path/to/selected-business-root`；该参数必须与保存的目录一致，符号链接按实际路径比较。测试 home 中复制了日常 `setting.json` 时，默认会拒绝重定向，不能依靠环境变量覆盖它来宣称隔离。

| 退出码 | 含义 |
|---|---|
| 0 | 应用正常退出且占用释放 |
| 2 | 已占用、记录不明或保存的数据根未显式选择；所选应用未启动 |
| 3 | 应用退出码为 0，但相关进程未确认结束；占用保留 |
| 其他 | 参数、应用路径、权限或应用异常；核对占用后处理，不自动重试接管 |

不传 `--home` 时使用当前用户的 home，默认应用路径为 `/Applications/ZCode.app` 与 `/Applications/ZCode Local.app`。本票未以这些日常默认路径启动，也未安装或替换应用。

## 本机证据

证据根为 `~/.local/share/zcode-local/research/issue-03/`，日志、截图、隔离数据库与官方源码 worktree 均不入库。

- 原生机制：`native-singleton.log`、`native-official-first/`、`native-local-first/`、`native-official-hung/`、`native-local-hung/`。
- TDD：`launch-red/green.log`、`exclusive-red/green.log`、`helper-red/green.log`、`launcher-crash-red/green.log`、`raw-process-red/green.log`。首次 `launch-first-red.log` 是夹具路径错误，不计作行为红证据。
- 最终相关测试：`launch-post-review.log`、`data-root-red/green.log`、`storage-baseline.log`。
- 真实应用：`controlled-final-pair.log`、`controlled-final-official-first/`、`controlled-final-local-first/`；自定义根另见 `controlled-custom-pair.log` 与两组 `controlled-custom-*/`。各组含两版 result、exit、welcome 截图、进程日志和占用拒绝日志。
- 兼容与凭据：`frozen-reader.log`、`frozen-reader-final.log`、`official-reader-checkout.log`、`official-reader-install.log`、`official-storage-diff.txt`（空差异）、`credential-readability.log`。
- 工程检查：`typecheck-post-review.log`、`lint-post-review.log`、`architecture-post-review.log`；全量原始结果在 `full-unit.log`，唯一失败文件独立重跑见 `full-failure-rerun.log`。代码格式检查通过，原 `package.json` 的 license 排序会触发 formatter，保留原顺序以免无关重排。
