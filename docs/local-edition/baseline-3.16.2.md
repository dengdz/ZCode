# 3.16.2 官方基线候选核对

日期：2026-10-21。对应 [issue 01](../issues/zcode-local/01-baseline-candidate.md) 与父规格 T29。

## 选择与源码锚点

- 官方公开源码候选：`3c5b227649371507ddc4eb46ac5133afe6db1cab`，`package.json` 版本 `3.16.2`，官方同步提交日期 2026-10-20。已固定提交，避免把移动的 `main` 当作发布锚点。
- 本地集成目标：`3.16.2-local.1`。原批准文档基线 `6598e641c2445bd4f9b5990ebf5feb9274fc3463`，官方源码合并提交 `0e1f0490`；随后合入协调文档提交 `445390d4`，合并结果 `973ad6a4`。
- 已安装官方应用的**只读元数据**为 bundle `dev.zcode.app`、版本 `3.16.2`、内部版本 `3.16.2.8769`；本轮没有启动官方应用。
- 官方下载页也列出 3.16.2，但公开远端当前没有 `v3.16.2` 标签。公开源码与官网下载二进制的完整能力一致性没有证明，版本相同不构成该证明。

官方依据：[源码提交](https://github.com/zai-org/ZCode/commit/3c5b227649371507ddc4eb46ac5133afe6db1cab)、[版本声明](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/package.json)、[下载页](https://zcode.z.ai/en#downloads)。

## 既有补丁结论

保留 `efae59158847d23c11930310b81dcae965caf547`（同一飞书用户绑定多个应用、按 Bot ID 授权）。官方 3.16.2 的 `findAuthorizedBot` 对普通私聊仍按 `provider + providerUserId` 反查，`validateBotConfig` 仍禁止同 provider/user 的多个启用 Bot；没有退役依据。

合并使用 Git 三方合并保留官方 Bot 服务变化，并保留该补丁的四文件差异：`docs/bots.md`、`botConfigHelpers.ts`、`botsService.ts`、`botsService.config.test.ts`。仅手工解决 `docs/agents/issue-tracker.md` 的并列清单冲突，官方与 Local 工单入口均保留。本票没有新增业务行为，没有新增内部测试接口；按已确认 TDD 边界重新执行既有集成回归。

## 用户依赖能力与风险处置

| 能力 | 当前证据与差异 | 核验位置 / 去向 |
|---|---|---|
| 多应用绑定、私聊身份及上下文 | 既有 Local 补丁保留；Feishu/Lark 同用户、不同应用，重复 app、目标用户授权及独立上下文的回归通过 | `packages/services/test/botsService.config.test.ts`；后续群角色授权仍按 issue 04–06 实现 |
| 飞书原生提及、Provider 请求、交互卡片及群投递 | 合成 Provider/服务测试通过；无真实飞书连接，不能据此声称真实群可用 | `botsFeishuProvider`、`feishuGroupMentions`、`botGroupDelivery`、`groupQueueCard`、`botsGroupSessions` 等测试；真实群归 issue 18 |
| 项目与工作区 | 3.16.2 已改用项目目录、`projectId`、`hostId` 和附加目录；合并保留新实现，未复制旧服务覆盖它 | `botsService.fixtures.ts`、项目服务及群回归 |
| 真实停止 | 上游已有 topic 停止 primitive 与运行时结果观察；跨 Bot 的 PM 停止闭环尚未实现 | `botsService.groups.test.ts` 和原生任务接口；issue 11 的实际停止场景 |
| 恢复与去重 | 上游已有持久 topic、投递与取消屏障；群重启、私聊投递、删除任务恢复合成回归通过 | `botsService.groups`、`privateSync`、`deletedTask`；跨 Bot、结果不明和卡片恢复仍属 issue 12 |
| 原需求归属、完整静默、正常长链 | 上游仍会从当前 sender 设置 initiator，部分空输出仍生成完成消息，机器人连续消息仍有五条守卫 | issue 05、07、10；本票不宣称已实现这些父规格行为 |
| Computer Use | 公开源码 `@zcode/zcode-cua` 明确是 fail-closed 占位包，Computer Use runtime、原生 Helper 等报告 unavailable；启动日志出现该服务 unavailable，与包声明一致 | `packages/zcode-cua/README.md`。这是已确认公开能力缺口；用户于 2026-10-21 已接受首版暂不包含原生桌面控制，具体原文见下文 |
| 独立 Local 身份、签名与更新 | 当前只有官方/Preview 产品身份；候选使用合成运行时名。尚无 `ZCode Local.app`，普通更新、强更和协议入口仍需完整处理 | issue 02；本票只交付隔离源码候选 |
| 业务数据共用与凭据 | 业务根 `{base}/.zcode/v2` 与 Electron profile 分开；设置另读 desktop home。3.16.2 的 Bot v3 严格格式新增字段，旧 3.15.1 Reader 可能拒绝。当前 cipher 不按签名绑定，但实际已有凭据访问尚未验证 | `services/src/paths.ts`、`credentialCipherProvider`、`shared/src/bots.ts`、`desktopRuntimeEnv.ts`；issue 03。所有启动均为空白隔离数据 |
| 双向互斥与不得强杀 | Electron 的共享 userData 单实例锁在正常响应时有可行性；尚未验证两个应用身份的双向顺序。Chromium POSIX 的无响应 owner 路径可能 SIGKILL；失败锁路径后续 ready 与 pre-lock IO 也需核实 | issue 03 必须先用可丢弃进程验证正常、挂起、未就绪和竞争，再决定方案；**日常数据切换暂停**，不能只做两个正常进程就判定通过 |

互斥限制的主要依据：[Electron 41.0.3 锁实现](https://github.com/electron/electron/blob/v41.0.3/shell/browser/api/electron_api_app.cc#L973)、[Electron Chromium singleton patch](https://github.com/electron/electron/blob/v41.0.3/patches/chromium/process_singleton.patch)、[固定 Chromium 146.0.7680.80 的 POSIX 无响应恢复](https://github.com/chromium/chromium/blob/146.0.7680.80/chrome/browser/process_singleton_posix.cc#L874)。Electron 锁依赖 userData 的源码事实不能代替完整的无强杀契约实测。

2026-10-21，用户在得知原生 Computer Use 缺口后确认：「可以，首版优先完成飞书协作」。该接受覆盖首版暂不包含原生桌面控制这一能力边界。业务数据兼容、实际凭据访问和双向无强杀互斥仍由 issue 03 验证，日常数据切换继续受这些门禁约束。

## 实际执行

macOS arm64；以 `mise.toml` 的 Node `24.14.0` / pnpm `10.33.2` 执行。该工作树独立 `pnpm install --frozen-lockfile --ignore-scripts`，没有共享其他源码版本的 node_modules。随后显式安装当前依赖的 Electron 41.0.3、按仓库 postinstall 重建 node-pty，并构建本工作树 Agent、官方插件 runtime、原生搜索工具、macOS window-bounds 和 Desktop JS。没有复制日常安装应用作为构建结果。

| 执行项 | 真实结果 |
|---|---|
| 新鲜度检查 | exit 0；原起点相对已获取官方为 ahead 2 / behind 2，随后采用固定官方候选 |
| 合并前架构检查 / services context | exit 0，0 新违规；services 为未托管旧模块，检查通过不等于覆盖全部 Bot 运行语义 |
| 合并后架构检查 | exit 0，0 新违规 |
| 绑定、消息流、连接锁、提及、Provider 请求、身份及 runtime 路径 | 7 文件 / 171 项通过 |
| 群受理、实际停止与恢复、私聊同步、任务删除恢复、强更及生产构建计划 | 5 文件 / 150 项通过 |
| 飞书 Provider、群会话、实际组装投递与队列卡片 | 4 文件 / 129 项通过 |
| 群成员目录 | 1 文件 / 3 项通过 |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0；96 条现有上游警告，0 errors，没有顺手修改 |
| `ZCODE_ENV=test pnpm prepare:desktop-runtime` | exit 0；实际完成 Agent 和平台资源构建 |
| `ZCODE_ENV=test pnpm --filter @zcode/desktop build:no-runtime-assets` | exit 0；types 检查结束后顺序重建完成，Vite 有体积提示 |
| 两个独立空白环境启动 | 两次均在迁移加载结束后进入“欢迎来到 ZCode”登录页；隔离路径断言通过、pageErrors 为空、正常关闭 exit 0；证据 startup-3/、startup-4/ |

基线集成共 **17 文件 / 453 项通过**。本票没有运行全库单测或真实群场景。

首次探针失败记录保留：并行的 root typecheck 会 emit 到 `packages/desktop/out/host`，覆盖先完成的 tsup bundle，导致 Host 裸包导入找不到 `cloudContent.js`。已确认属于本轮验证顺序错误；类型检查完成后重新构建即可恢复。第二次探针只观察到初始化界面，未算启动完成。最终探针必须等 `root-startup-loading` / database startup 元素消失，再核对欢迎界面；不能把窗口出现记作启动通过。

## 可重复构建与隔离启动

从此分支的干净工作树执行，使用仓库声明的 mise 运行时；测试、类型检查和 lint 先结束，再构建，避免多个命令争写 `out/host`。

```sh
mise exec -- pnpm install --frozen-lockfile --ignore-scripts
mise exec -- node node_modules/electron/install.js
mise exec -- pnpm --filter @zcode/desktop postinstall
mise exec -- pnpm typecheck
mise exec -- pnpm lint
mise exec -- pnpm architecture:check --changed
mise exec -- env ZCODE_ENV=test pnpm prepare:desktop-runtime
mise exec -- env ZCODE_ENV=test pnpm --filter @zcode/desktop build:no-runtime-assets
```

本次临时固定 Node 下载目录仅用于执行证据，不作为长期工具链契约；长期入口继续使用 `mise.toml`。

可用下列一次性探针重复欢迎页启动。它只使用新建临时目录，拦截 OS 全局 `zcode://` 默认处理程序注册，运行刚构建的 JS，记录可见欢迎页、真实 runtime 路径并正常关闭。该拦截属于测试 harness，未修改产品；协议、签名与独立 .app 的验证归 issue 02。

```sh
mise exec -- node --input-type=module <<'JS'
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const root = process.cwd();
const require = createRequire(resolve(root, 'package.json'));
const { _electron } = require('playwright-core');
const probe = await mkdtemp(join(tmpdir(), 'zcode-baseline-'));
const home = join(probe, 'home');
await mkdir(home);
const entry = join(probe, 'entry.cjs');
await writeFile(entry, `const {app}=require('electron');\napp.setAsDefaultProtocolClient=()=>false;\napp.setAppPath(${JSON.stringify(join(root, 'packages/desktop'))});\nimport(${JSON.stringify(join(root, 'packages/desktop/out/main/index.js'))});\n`);
const env = {
  PATH: process.env.PATH,
  HOME: home,
  USER: 'synthetic-baseline-user',
  LOGNAME: 'synthetic-baseline-user',
  LANG: 'en_US.UTF-8',
  ZCODE_ENV: 'test',
  ZCODE_DATA_BASE_DIR: home,
  ZCODE_DESKTOP_HOME_DIR: home,
  ZCODE_DESKTOP_USER_DATA_DIR: join(probe, 'profile'),
  ZCODE_DESKTOP_SESSION_DATA_DIR: join(probe, 'session'),
  ZCODE_DESKTOP_APPLICATION_NAME: 'ZCode Baseline Candidate Issue 01',
};
let application;
try {
  application = await _electron.launch({
    executablePath: require('electron'), args: [entry], cwd: root, env, timeout: 45000,
  });
  const window = await application.firstWindow();
  await window.waitForFunction(() =>
    !document.querySelector('[data-testid=root-startup-loading]') &&
    /欢迎来到 ZCode|Welcome to ZCode/.test(document.body.innerText),
    undefined, { timeout: 60000 });
  const paths = await application.evaluate(({ app }) => ({
    home: app.getPath('home'), userData: app.getPath('userData'),
    sessionData: app.getPath('sessionData'),
  }));
  if (paths.home !== home || paths.userData !== env.ZCODE_DESKTOP_USER_DATA_DIR ||
      paths.sessionData !== env.ZCODE_DESKTOP_SESSION_DATA_DIR) throw Error('isolation mismatch');
  await window.screenshot({ path: join(probe, 'welcome.png') });
  await writeFile(join(probe, 'result.json'), JSON.stringify(paths, null, 2));
  console.log('baseline-welcome-ready', probe);
} finally {
  if (application) await application.close();
}
JS
```

## 私有证据目录

本机证据根为 `~/.local/share/zcode-local/research/issue-01/`，不提交原始日志、截图或空白运行数据库。主要文件：

- `install-before-merge.log`、`install-3.16.2.log`、`electron-install.log`、`node-pty-rebuild.log`。
- `architecture-before-merge.log`、`services-context-before-merge.md`、`architecture-after-merge.log`、`typecheck-first.log`、`lint.log`。
- `baseline-tests-first.log`、`baseline-risk-tests.log`、`baseline-provider-tests.log`、`baseline-member-tests.log`。
- `prepare-runtime.log`、`build-desktop.log`、`build-desktop-after-typecheck.log`、`build-artifacts.sha256`；最终编译元数据 `packages/desktop/out/metadata/build-meta.json` 为版本 `3.16.2`、源码 `0e1f0490`。
- `startup-1/` 为失败运行，`startup-2/` 为未等初始化结束的探针；均不算通过。
- `startup-3/`、`startup-4/` 和各自 `startup-smoke-*.log` 为最终隔离欢迎页探针；`startup-smoke.mjs`、`smoke-entry.cjs` 保存实际执行 harness。
- 同目录上一级 `01-upstream-baseline.md` 为上游探索原始报告。

后续继续从该官方锚点实施 issue 02。每日应用、真实登录、既有业务数据和真实机器人继续保持未接管状态；用户已接受首版的 Computer Use 能力缺口，业务数据兼容、实际凭据访问和双向无强杀互斥仍须通过 issue 03，才可进入受影响的日常切换。
