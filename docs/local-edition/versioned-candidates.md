# 14 版本候选维护入口

Status: in-progress

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

执行证据将在本票收尾回填。02 的 `f8fbaaa0` 候选及截图仍只证明 02；03–14 的新候选须有本票新的源码锚点和产物证据。
