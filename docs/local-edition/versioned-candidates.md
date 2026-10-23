# 14 版本候选维护入口

Status: done

对应[工单 14](../issues/zcode-local/14-versioned-candidates.md)。设计源、状态顺序和验收范围继续由该工单及冻结父规格负责。

## 使用

在仓库根使用 `mise.toml` 固定的 Node/pnpm，先安装依赖。长期工具链入口是 `mise exec --`，本机研究目录中的临时 Node 链接不是部署要求。GitHub CLI `gh` 需可访问公开 GitHub API；普通 fork 推送仍需用户已有 Git 权限。

```sh
mise install
mise exec -- pnpm install --frozen-lockfile --ignore-scripts
mise exec -- pnpm local:maintain check --fork dengdz/ZCode --review docs/local-edition/maintenance-review.json --output /absolute/new-check-directory
mise exec -- pnpm local:maintain build --fork dengdz/ZCode --review docs/local-edition/maintenance-review.json --output /absolute/new-candidate-directory
```

每次 output 使用不同的全新目录，其父目录需先创建。check 获取实时上游/公开 fork 和发布标签事实，并核对所选基线、版本分支、补丁审阅、公开内容；它不构建。build 在相同门禁后执行现有 frozen install、原生准备、类型/Lint/架构/维护入口测试/affected 选择、runtime 准备、Desktop 生产构建与 bundle 链。构建的 HOME 和业务根均在候选目录内，输出不接触日常 Local。

`candidate.json` 记录完整源码 commit/tree、预期固定标签、官方基线、review hash、锁文件 hash、声明/实际工具链、包内 build-meta、平台版本和 DMG/ZIP 哈希。只有全部包与签名检查通过才有 ready 清单。已有目录不会覆盖；失败后查该目录的 check 和 logs，并换新目录重试。ready 仅表示产物验证通过，不能代表启动、日常数据接管、真实模型或群协作已经验收。

公开检查覆盖分叉以来历史中的新增/修改 blob，不只看 HEAD：删除文件不会清除历史泄露。路径/密钥模式检查是语义隐私审阅的补充。review 中不得塞入私有访谈、原始群聊、凭据或业务数据；日志与候选留在仓库外本机私有目录。构建产生的诊断不自动上传。

## 上游与版本维护

先实时比较上游源码与公开 release，再更新 review 的固定上游 SHA、能力差异、阻塞和补丁取舍；上游与 review 不同、精确等价补丁仍生效、冲突或任一验证失败，均不能产出 ready 候选。命令不自动 merge/rebase/revert。官方语义上修复的补丁由维护者依据源码和回归手工退役，保留历史；只靠 patch-id 不能判断语义正确性。

根 package.json 版本必须等于当前分支 `官方版本-local.N`，N=1..999。预期发布标签为 `v版本`；已有同名本地或远端标签必须解析到当前完整源码，差异要求新修订。build 只记录预期标签，不擅自发布或改写它。未发布候选可在同一版本分支继续准备；正式发布后修改须进入新修订/分支并同步根版本，换官方基线从 local.1 开始。

包内版本仍由现有 Desktop build-meta 和产品身份规则负责；维护入口只核对它们，不产生第二份包内版本 owner。重建以同一源码、锁文件和工具链为依据，时间戳与签名不保证逐字节相同。

## 远端与防误推

2026-10-23 已通过 GitHub API 核实公开 `dengdz/ZCode` 的 owner、fork/source 为 `zai-org/ZCode`。旧 origin 已 rename 为 upstream，旧 origin/_ 引用与 main 的跟踪关系随之保留为 upstream/_；新增 origin 指向用户 fork，upstream push URL 为 `DISABLED`，remote.pushDefault=origin，push.default=simple。没有修改本地版本分支历史或发布 tag。

当前版本分支首次推送前，架构和 affected 检查显式选择官方 `upstream/main`，避免新 fork/main 或首次 push 的空远端 SHA 改变比较语义：

```sh
mise exec -- pnpm architecture:check --changed --base upstream/main
ZCODE_PRE_PUSH_BASE=upstream/main ARCHITECTURE_BASE=upstream/main mise exec -- git push --no-follow-tags -u origin HEAD:refs/heads/3.16.2-local.1
```

普通 fork 分支备份不等于发布候选、创建发布标签或安装。本票不包含官方推送、强推、删除历史、日常应用替换或启动。

## 实际验证

2026-10-23 完成。实现提交 `4fb0ea73318963d7141e81057b2166c13cd00540`，补正及最终候选源码
`7d6141bcef0c5c79968532ea895dd1401b567d88`。父规格冻结 blob
`25efc393d4c8d5cf0fb44cbbd4ca8b04dd6c1387` 保持不变。收尾提交仅归档本报告，不改变候选源码。

候选清单为本机仓库外 `${HOME}/.local/share/zcode-local/research/issue-14/candidate-2/candidate.json`，
2026-10-23 12:12:39（Asia/Shanghai）生成 ready。应用位于其 `artifacts/mac-arm64/ZCode Local.app`。
展示/分支版本 `3.16.2-local.1`，包内 build-meta 锚点 `7d6141bc`，身份 `dev.zcode.app.local`，
macOS 短版本 `3.16.2`、内部版本 `3.16.2001`。Node `24.14.0`、pnpm `10.33.2`、
electron-builder `26.8.1`；工具链声明与锁文件 hash 均写入清单。

| 产物                                     |    字节数 | SHA-256                                                            |
| ---------------------------------------- | --------: | ------------------------------------------------------------------ |
| ZCode Local-3.16.2-local.1-mac-arm64.dmg | 204585113 | `fd9328dba75c45443bf7b5cf3296278f205494b176e1ec34e493e9b67fea95a7` |
| ZCode Local-3.16.2-local.1-mac-arm64.zip | 195273664 | `35806c1c5603f54ed65af4cfa8098166f82497f922360f09bc319376184a6046` |

维护入口实际完成 ASAR/package/build-meta、平台数字版本与架构核对，签名 deep/strict 验证，
ZIP CRC 及全部应用文件/链接的类型、权限和内容一致性，DMG 完整性及只读挂载后的完整应用树/签名检查。
随后独立执行 codesign 与 shasum，签名为 ad-hoc + hardened runtime，哈希与清单一致；DMG 已正常卸载。
应用树 SHA-256 为 `67d2b14d370f73708c242abada3ecc936b3e91f1e17a518e964ff067e580cb3c`。

| 验证               | 真实结果                                                                                                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 开工新鲜度         | 原官方 origin fetch 成功；相对 origin/main ahead 42 / behind 0，无分支远端跟踪                                                                                                                |
| 维护入口进程场景   | 最终 22/22 通过；覆盖干净源码、进行中 Git 操作、远端保护、公开历史、过期审阅、固定标签、补丁退役、失败中止、候选不可覆盖、签名、完整 ZIP/DMG、symlink 数据根、Intel 工具约定及隔离 HOME/store |
| 完整根全量（一次） | 2061 文件通过、2 跳过；20160 项通过、11 跳过，499.56 秒，退出码 0；使用独立 HOME，未覆盖/修改 vitest setup 的数据根处理                                                                       |
| 类型               | 初次及最终候选入口内 `pnpm typecheck` 均通过                                                                                                                                                  |
| Lint               | 初次、补正后及最终入口均 0 errors / 97 条存量 warnings                                                                                                                                        |
| 架构/格式          | 显式官方 upstream/main，0 违规；本票变更范围 oxfmt 通过；scripts 未被架构策略托管，不能据此声称所有运行语义已验证                                                                             |
| affected           | Vitest 官方选中 2063/2063，按仓库合同跳过 UT，退出 0；这不是再次执行全量，独立全量结果见上行                                                                                                  |
| 原构建链           | frozen install、Electron/node-pty、runtime、Desktop 生产构建、bundle 与闭包/体积审计通过；没有另建打包链                                                                                      |
| fork 备份          | 普通 pre-push 检查通过（schema 8 项、架构工具 36 项及 Lint/架构/affected）；源码锚点已推送并通过 GitHub API 核对为用户 fork 对应分支 HEAD                                                     |

完整根全量发生在实现阶段；之后仅维护脚本补正，已重跑该边界的最终 22 项、类型/Lint/架构/格式及真实构建，
没有把先前全量数字改写成最终维护用例数量。命令测试使用真实临时 Git/ASAR/ZIP 和受控 GitHub/签名/构建进程，
不把这些合成场景当成真实签名或真实模型验收。macOS arm64 产物为实际执行；Intel 仅有系统边界 fixture，
其他平台 build 明确拒绝，未声称实测。

### 失败与补正记录

- `check-1` 在 `4fb0ea73` 上实际成功，区分官方 main 的 3.16.2 固定源码与 latest release `v3.14.3`。
  最终候选入口再次通过实时 GitHub API 观测相同官方锚点；不是用旧本地 ref 冒充网络检查。
- `candidate-1` 在 frozen install 阶段以 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` 安全停止，
  原因为隔离 HOME 改变默认 pnpm store；没有 ready 清单。进程回归先红后绿，改为显式复用已有依赖缓存，
  保持隔离 HOME/数据根且不修改全局配置，重新从干净 `7d6141bc` 生成 `candidate-2`。
- 历史扫描初次把三方合并中的官方测试假密钥判成秘密。现只排除能从固定官方历史证明相同的 Git blob，
  不豁免测试目录；本地新增密钥内容和所有敏感路径仍拒绝。公开进程回归先红后绿。
- 两轴审查发现日常根 symlink 隔离漏洞、Intel `mac/` 与 `x86_64` 映射错误，以及 ZIP 仅核对三成员可漏
  Framework；均通过公开进程红→绿补正。ZIP 采用流式完整成员比较，避免解压任意路径；与已独立 deep/strict
  验签的完整应用建立同一性。yauzl 旧式 stream 在 Node 24 的 async iterator 会悬空，已改用其公开 data/end/error
  契约，入口使用顶层 await，避免悬空任务以成功退出。
- Git HTTPS 访问 github.com 后续超时，未记作拉取/推送成功。通过 GitHub 公布的主机密钥严格核对 SSH 443，
  认证为用户 fork owner 后，使用单次 origin push URL 覆盖完成普通分支备份；保存的 origin/upstream 地址与
  官方禁推规则未变。没有降低主机验证或写全局 SSH 配置。

### 两轴审查

固定起点 `13abd82002f517c672dbbf56238bb9ddbb1f5dd5`，命令 `git diff <起点>...HEAD`。
两个独立并行代理分别按 Standards 和 Spec 审查，补正后再次独立复审：

- Standards：初次 1 项 P2（日常根符号链接），已关闭；最终 0 项遗留，无需报告的启发式代码味道。
- Spec：初次 2 项 P2（Intel 映射、残缺 ZIP），已关闭；最终 0 项遗留。Spec 代理独立重跑相关 4 个进程场景通过。

证据根 `${HOME}/.local/share/zcode-local/research/issue-14/` 中保留 `logs/full-unit.log`、初次/最终类型与
Lint/架构/格式/维护测试日志、`check-1`、失败 `candidate-1` 和最终 `candidate-2`（含每阶段 logs、签名、ZIP/DMG
检查及 candidate.json）；独立签名和哈希在 `logs/codesign-independent.log`、`logs/artifacts-independent.sha256`。
原始日志、HOME、数据根、候选产物和 SSH 主机密钥临时文件均不提交。

本票没有启动候选、安装或替换日常 Local、接管日常数据、连接真实机器人或模型；没有创建发布标签、强推或向官方推送。
02 的 `f8fbaaa0` 候选及其截图仍只证明 02。15–18 未开始，实际安装/恢复与真实群只读验收继续由后续门禁负责。
