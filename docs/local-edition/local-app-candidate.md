# 02：独立 Local 候选应用

状态：02 已完成（2026-10-21）。对应 [02 工单](../issues/zcode-local/02-local-app.md)，官方基线固定为 `3c5b227649371507ddc4eb46ac5133afe6db1cab`（3.16.2）。本票不进入日常数据切换，03 尚未开始。

## 实现

- 新增真实 `local` 产品身份：`ZCode Local` / `dev.zcode.app.local`，Linux 名称 `zcode-local`，Windows AUMID 与安装标识一致。已有官方、Preview 标识保留。`ZCODE_LOCAL_IDENTITY=1` 显式选择，非法拼写及与 Preview 同时开启均拒绝构建。
- 构建将身份编入 Main、Host、Preload 和 Renderer。打包后无需保留构建环境变量，应用名、Electron 缓存目录、Helper 变体、菜单与关于面板仍识别为 Local。后端环境独立由 `ZCODE_ENV` 决定。
- Local 在共享能力、更新器初始化、检查/下载/强更/安装入口关闭官方更新；菜单无官方更新项，启动不进入官方强更流程。架构不匹配仍告知转译影响，但只提示重建对应架构的 Local，不打开官网安装入口。没有设置虚假官方版本来规避限制。
- 本机候选采用 ad-hoc 签名和 hardened runtime；不请求付费证书或公证，不修改系统保护。Local 对随包原生资源实际签名，不沿用只适用于官方预签名资源的跳过列表。
- 应用展示版本、源码分支和包名为 `3.16.2-local.1`。macOS 短版本 `3.16.2`，构建版本 `3.16.2001`；映射规则为 `major.minor.(patch × 1000 + Local 修订)`，修订限制 1–999，越界停止构建。Mac 字段只接受数字，系统忽略第四段，因此不直接写入 `-local.1` 或第四段修订。[Apple CFBundleVersion](https://developer.apple.com/documentation/BundleResources/Information-Property-List/CFBundleVersion)、[CFBundleShortVersionString](https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleshortversionstring) 支持这一格式约束。

## 验证记录

| 检查 | 实际结果 |
|---|---|
| 全量单测（首轮实现后） | 2050 文件通过、2 文件跳过；19950 项通过、10 项跳过，退出码 0，401.42 秒 |
| 审查补正后的相关回归 | 13 文件 / 227 项通过；包含身份、编译注入、运行时、更新器、菜单、强更、架构提示、关于面板与版本边界 |
| 类型检查 | 通过；在最后 Desktop 构建前顺序完成，避免 tsc 覆盖 Host bundle |
| Lint | 0 errors、96 条既有警告；没有重排无关源码 |
| 架构检查 | 0 新违规；Desktop / Shared 是未托管旧模块，不将检查通过等同于全部运行语义证明 |
| Agent、平台资源与 Desktop 生产构建 | 通过；从本工作树准备，未把官网安装应用复制为产物 |
| macOS arm64 候选打包与资源闭包 | 完成 DMG、ZIP 与独立 .app；资源闭包及体积审计通过，ZIP 186.2 MiB |
| 签名、隔离欢迎页与关于面板 | 启动前后签名 deep / strict 校验通过，adhoc + runtime；空白环境进入欢迎页、打开 Local 关于面板、pageErrors 为空、应用及 Host 正常退出 0 |

全量仅运行一次。此后发现的架构提示、macOS 数字字段、关于名称问题均按相关边界补测并重建；没有把此前全量数字改写为最终新增用例数量。身份、非法开关、共享身份、运行时名称、更新器、架构外链、数字字段、关于名称均保留红→绿日志；版本上界与非法格式另有公开构建配置测试。

## Standards

独立规范审查读取根 AGENTS、架构技能、政策和词汇表。首轮无发现；增量提出两项 P3：架构修复缺少中文原因注释，以及版本格式拒绝规则缺少边界测试。分别补齐原因说明与非法格式、0、1000、999 测试后复验关闭。最终无未关闭发现。

## Spec

独立规格审查发现架构不匹配提示仍引导下载官网包，已通过实际弹框入口测试补正；后续复验确认 Local 身份、更新边界、平台数字版本和关于面板符合 02。候选产物证据由主执行会话实际核对。未提前实现 03 及维护入口 14，最终无未关闭实现发现。

## 重复构建与证据

使用仓库固定 Node 24.14.0 / pnpm 10.33.2。依赖安装后显式准备 Electron 与 node-pty；测试和类型检查先完成，再生产构建，最后打包。以下命令从仓库根执行，输出目录应选择新的本机候选目录：

```sh
pnpm install --frozen-lockfile --ignore-scripts
node node_modules/electron/install.js
pnpm --filter @zcode/desktop postinstall
pnpm typecheck
ZCODE_ENV=production ZCODE_LOCAL_IDENTITY=1 pnpm prepare:desktop-runtime
ZCODE_ENV=production ZCODE_LOCAL_IDENTITY=1 pnpm --filter @zcode/desktop build:no-runtime-assets
ZCODE_ENV=production ZCODE_LOCAL_IDENTITY=1 ZCODE_DESKTOP_DIST_DIR="$candidate_dir" pnpm bundle:desktop -- --os mac --arch arm64 --skip-prepare --skip-build
```

`candidate_dir` 须显式指向隔离候选目录，不是 `/Applications`。本票没有创建发布标签、推送远端或安装到日常目录。长期维护命令和版本发布归 14–17。

本机证据根：`~/.local/share/zcode-local/research/issue-02/`。最终产物位于 `candidate-complete/`，内含 `ZCode Local-3.16.2-local.1-mac-arm64.dmg`、同名 ZIP 和 `mac-arm64/ZCode Local.app`。源码与包内构建锚点均为 `f8fbaaa0`；后续仅归档文档。未创建正式发布标签。

保留 `install.log`、`prepare-runtime.log`、`full-unit.log`、`related-tests-complete.log`、`typecheck-complete.log`、`lint-complete.log`、`architecture-complete.log`、`bundle-complete.log`。最终运行证据为 `startup-4/result.json`、`exit.json`、`welcome.png` 和 `about.png`；签名和元数据为 `codesign-complete-*.log`、`artifact-metadata-complete.json`、`packaged-metadata-complete.json`；产物哈希为 `artifacts-complete.sha256`。DMG 与 ZIP 完整性检查通过，日志为 `dmg-verify.log`、`zip-verify.log`。原始日志、截图与空白数据库不提交。

首次产物曾把带 Local 后缀的展示版本直接写入 macOS 数字字段，仅作中间证据，不能使用 `candidate/` 或 `candidate-final/` 代替最终产物。前三次启动探针也完整保留：第一次在暂停调试器中等待异步求值而超时；第二次把实际正确的完整版本误断言为数字短版本；第三次已完成全部界面断言，但调试器定时退出未完成。最终探针去除暂停态异步等待、修正断言，并直接调用正常退出后通过。只把 `startup-4` 计为完整启动通过。

最终探针没有注入 Local 构建开关，也未覆盖应用显示名；实际读取 `app.isPackaged=true`、`app.name=ZCode Local`、`app.getVersion()=3.16.2-local.1`。home、userData、sessionData 均等于本次新建隔离目录；捕获一次 `zcode` 注册请求并在进程内拦截。主菜单没有官方更新项，实际日志含更新器禁用和 Local 跳过强更记录。关于面板标题、正文名称与完整版本均通过断言和截图检查。

## 兼容边界

- OAuth 沿用 `zcode://` 和既有后端回调；协议展示名称为 Local。同一 scheme 在系统中只有一个默认处理程序。候选探针在打包 JS 执行前拦截全局注册，不更改实际默认处理程序；实际 OAuth、凭据和日常接管继续受 03 门禁约束。
- 本票验证空白合成数据，未访问已有凭据、连接真实机器人、启动或停止官网版。没有完成双向互斥、旧 Reader 兼容或日常数据切换验证。
- 公开源码原生 Computer Use 仍为 fail-closed 占位实现，用户已接受首版缺口。远端登录及服务拒绝旧客户端的兼容情况仍需实际核对；Local 关闭官方强更，不代表远端服务承诺永久支持。
- 官方 / Preview 产品身份和既有更新逻辑保留。Local 不自动安装官方包；首版升级由后续维护流程从源码合并、验证和重建。
