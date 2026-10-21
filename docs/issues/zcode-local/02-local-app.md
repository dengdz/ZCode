# 02: 构建可独立启动的 ZCode Local 候选应用

Status: done

Issue-Tracker: local-markdown

## Parent

[ZCode Local spec](../../local-edition/spec.md)

**What to build:** 产出固定 Local 身份、可在隔离数据下启动的本机签名候选包，并阻断官方包覆盖入口。

**Blocked by:** [01 确定官方基线与可重复的隔离候选](01-baseline-candidate.md)

## Background

旧安装包沿用官方身份，不能明确区分安装来源，也可能走回官方更新流程。

## Modules

桌面产品身份、构建与签名、启动及更新入口、运行时数据定位。不预先固定源码文件名；以实施基线的受控模块上下文为准。

## Acceptance criteria

- [x] 应用显示固定 Local 名称，安装标识、运行时和相关集成一致，官网版和 Preview 身份不被改写。
- [x] 普通更新和启动强更等入口不会安装官方包或伪造版本绕过远端限制；不能支持的依赖如实报告。
- [x] 以本机正常签名、隔离数据完成构建和启动检查；不降低系统保护、不切换日常数据。

## Spec coverage

用户故事：44、46、57、66。
验收场景：T28、T30、T34。

## Execution notes

一次只处理本 issue。实现遵循已确认测试边界和 TDD，保留无关改动；验证记录区分实际执行、合成场景与待真实验收。完成后记录改动、验证结果和既有逻辑影响，再置 done。

### 实施约定（2026-10-21）

- 本轮只完成 02，汇报后停在 03 之前。父规格保持不变。
- 构建身份由现有 `desktop-product-identity.mjs` 单独维护：新增 `local` flavor，显式 `ZCODE_LOCAL_IDENTITY=1` 选择；与 Preview 开关同时开启或非法开关值直接拒绝构建。名称 `ZCode Local`、安装标识 `dev.zcode.app.local`，编译期注入身份，安装后无需环境变量保持名称。
- “关于”面板与窗口标题使用 Local 名称，保留现有官方/Preview 面板文案；完整应用内版本沿用现有 `app.getVersion()` 与构建元数据，不把 macOS 数字字段当作展示版本。
- 后端环境继续由 `ZCODE_ENV` 决定，Local 不伪造官方版本。候选展示 `3.16.2-local.1`，内部平台版本保留合法数字版本。日后版本化维护命令归 14。
- macOS 的短版本为官方数字基线，构建版本为 `major.minor.(patch × 1000 + Local 修订)`；修订范围 1–999，越界拒绝构建，避免四段版本的末段被系统忽略。本票对应 `3.16.2` / `3.16.2001`，应用内与源码仍显示完整 `3.16.2-local.1`。
- Local 的更新权限在共享构建能力与更新器入口内关闭；普通检查、直接下载、强更和安装均不得触碰官方更新器。既有 production / Preview 行为保留。
- 架构不匹配提示仍告知性能影响，但 Local 提示重新构建对应架构的 Local，不提供官网下载按钮。
- Local macOS 候选采用 ad-hoc 本机签名，不请求付费证书或公证，不改系统安全策略。保留现有资源闭包与原生依赖检查。
- OAuth 延续 `zcode://` 协议及既有后端回调；协议展示名称跟随 Local。系统同一 scheme 只有一个默认处理程序，启动候选探针拦截全局注册，不能据此宣称与官网版同时处理 OAuth。实际凭据、日常接管及双向互斥归 03。
- 在已确认的桌面身份、更新入口和构建产物测试边界内逐项红→绿；最后验证真实签名 .app 的欢迎界面与隔离路径。原生 Computer Use 仍为用户已接受的公开源码占位实现。

## Completion（2026-10-21）

- 独立 Local 身份、官方更新拦截、架构提示、macOS 数字版本与关于面板已实现。官网版和 Preview 的产品身份与原有路径保留。
- 实际构建 macOS arm64 DMG、ZIP 与 ad-hoc 签名 .app；最终包源码锚点 `f8fbaaa0`。启动前后签名 deep / strict 校验通过；隔离环境进入欢迎页与 Local 关于面板，pageErrors 为空，应用与 Host 正常退出 0。
- 全量单测首轮 19950 项通过 / 10 项跳过；后续补正的最终相关回归 13 文件 / 227 项通过。类型、Lint（0 errors / 96 条既有 warnings）、架构均通过。
- Standards、Spec 两路审查及补正复验完成，无未关闭发现。详见[候选报告、执行证据及边界](../../local-edition/local-app-candidate.md)。
- 没有安装到日常目录、访问实际凭据或发送真实群消息；没有创建发布标签或推送。03 尚未开始，本轮到此结束。

