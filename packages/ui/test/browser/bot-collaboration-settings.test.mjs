import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { _electron } from "playwright-core";
import electronPath from "electron";
import { ChannelServer, Emitter, ProxyChannel, VSBuffer } from "../../../rpc/src/index.ts";
import { createBotsService } from "../../../services/src/bots/botsService.ts";
import { BotsRepo } from "../../../services/src/bots/repo.ts";
import { TaskIndexRepo } from "../../../services/src/session/taskIndexRepo.ts";
import { createProjectService } from "../../../services/src/project/index.ts";
import { setDataBaseDir } from "../../../services/src/paths.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const entry = "/packages/ui/test/browser/bot-collaboration-settings.fixture.tsx";
const originalFetch = globalThis.fetch;
let service, repo, index, server, app, page, origin, home, artifacts, legacyBefore;
let activeTasks = [];
let rpcServer, rpcInbox;
const rpcCalls = [];
async function choose(label, option) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
const ids = ["pm", "app"];
const bots = ids.map((id) => ({
  id,
  name: id.toUpperCase(),
  provider: "feishu",
  enabled: true,
  credentialRef: `synthetic-${id}`,
  feishuAppId: `cli_${id}`,
  providerUserId: `ou_owner_${id}`,
  allowedWorkspaces: ["*"],
  allowedCommands: {
    status: true,
    new: true,
    workspace: true,
    model: true,
    thoughtLevel: true,
    reply: true,
  },
  currentOptions: {},
  replyMode: "assistant_changes",
}));
const platformRequests = [];
const runtime = new Proxy(
  { listActiveTaskIds: async () => activeTasks, getBotGroupTaskBlockReason: async () => null },
  {
    get: (target, name) =>
      name in target
        ? target[name]
        : async () => {
            throw Error(`Unexpected task execution: ${String(name)}`);
          },
  },
);
let projectService;
const createService = () =>
  createBotsService({
    repo: new BotsRepo(),
    projectService,
    credentialService: {
      load: async () => "synthetic-value",
      save: async () => {
        throw Error("No credentials may be saved");
      },
      delete: async () => {
        throw Error("No credentials may be deleted");
      },
    },
    zcodeTaskService: runtime,
    modelSelectionService: { getView: async () => null },
    localCollaborationEnabled: true,
    runStartupBackgroundTasks: false,
  });

async function action(method, request = {}) {
  if (method === "get") return service.getCollaborationSettings();
  if (method === "save") return service.saveCollaborationSettings(request);
  if (method === "verify") return service.beginCollaborationVerification(request);
  if (method === "busy") {
    activeTasks = request.active ? ["synthetic-running-task"] : [];
    return {};
  }
  if (method === "restart") {
    await service.disposeAllAndWait();
    service = createService();
    return {};
  }
  if (method === "native") {
    const id = request.botId;
    if (!ids.includes(id)) throw Error("Unknown synthetic bot");
    const payload = {
      // 与现有飞书运行端口一致：本机路由附加 botId，平台身份仍由 Provider 查询。
      botId: id,
      schema: "2.0",
      header: {
        app_id: `cli_${id}`,
        tenant_key: "synthetic-tenant",
        event_type: "im.message.receive_v1",
        event_id: `event-${Date.now()}-${id}`,
      },
      event: {
        sender: {
          sender_type: "user",
          tenant_key: "synthetic-tenant",
          sender_id: { open_id: `ou_owner_${id}`, union_id: "on_synthetic_owner" },
        },
        message: {
          message_id: `om_${Date.now()}_${id}`,
          chat_id: "oc_demo",
          chat_type: "group",
          message_type: "text",
          content: JSON.stringify({ text: `@_user_1 ${request.command}` }),
          mentions: [{ key: "@_user_1", name: id.toUpperCase(), id: { open_id: `ou_bot_${id}` } }],
        },
      },
    };
    const replies = await service.handleProviderCallback("feishu", payload);
    const snapshot = await service.getCollaborationSettings();
    const bot = snapshot.groups
      .find((group) => group.chatId === "oc_demo")
      ?.bots.find((bot) => bot.id === id);
    assert.ok(bot?.verified && bot.connected, JSON.stringify({ replies, bot, platformRequests }));
    return {};
  }
  throw Error("Unsupported fixture action");
}

before(
  async () => {
    artifacts =
      process.env.ZCODE_TEST_ARTIFACT_DIR ??
      (await mkdtemp(join(tmpdir(), "collaboration-ui-artifacts-")));
    await mkdir(artifacts, { recursive: true });
    home = await mkdtemp(join(artifacts, "home-"));
    setDataBaseDir(home);
    const workspace = join(home, "project");
    await mkdir(workspace);
    index = new TaskIndexRepo(undefined, "local");
    projectService = createProjectService({
      repository: () => index.getProjectRepository(),
      ownerHostId: "local",
      workspaceDirectory: join(home, "workspaces"),
    });
    const project = await projectService.saveProject({ name: "Demo project", roots: [workspace] });
    repo = new BotsRepo();
    await repo.writeConfig({ version: 3, bots });
    await repo.writeState({
      version: 3,
      bots: Object.fromEntries(
        bots.flatMap((bot) =>
          ["oc_demo", "oc_other"].map((chatId) => [
            JSON.stringify([bot.id, chatId]),
            {
              botId: bot.id,
              projectId: project.id,
              hostId: "local",
              workspacePath: workspace,
              mode: "draft",
              activeTaskId: null,
              updatedAt: 1,
              group: {
                chatId,
                name: chatId === "oc_demo" ? "Demo group" : "Other group",
                enabled: true,
                ownerId: bot.providerUserId,
                taskIds: [],
                currentOptions: {},
              },
            },
          ]),
        ),
      ),
    });
    legacyBefore = await Promise.all(
      ["bot-config.v3.json", "bot-state.v3.json"].map((name) =>
        readFile(join(home, ".zcode/v2", name), "utf8"),
      ),
    );
    globalThis.fetch = async (input, options) => {
      const url = String(input);
      if (!url.startsWith("https://open.feishu.cn/"))
        throw Error("Unexpected external network request");
      const path = new URL(url).pathname;
      platformRequests.push(path);
      if (path.includes("tenant_access_token"))
        return Response.json({
          code: 0,
          tenant_access_token: JSON.parse(options.body).app_id,
          expire: 3600,
        });
      const id = String(options.headers.authorization).includes("cli_app") ? "app" : "pm";
      if (path === "/open-apis/bot/v3/info")
        return Response.json({ code: 0, bot: { open_id: `ou_bot_${id}` } });
      if (path.includes("/members"))
        return Response.json({
          code: 0,
          data: { items: [{ member_id: `ou_owner_${id}`, name: "Demo owner" }], has_more: false },
        });
      if (path.includes("/contact/v3/users/"))
        return Response.json({ code: 0, data: { user: { name: "Demo owner" } } });
      if (path.includes("/messages"))
        return Response.json({ code: 0, data: { message_id: "om_synthetic_response" } });
      if (path.includes("/chats/"))
        return Response.json({ code: 0, data: { name: "Demo group", chat_mode: "group" } });
      throw Error(`Unexpected platform endpoint ${path}`);
    };
    service = createService();
    server = await createServer({
      root,
      configFile: false,
      plugins: [
        react(),
        tailwindcss(),
        {
          name: "collaboration-integration-fixture",
          configureServer(vite) {
            vite.middlewares.use(async (req, res, next) => {
              if (req.url?.startsWith("/fixture?")) {
                res.setHeader("content-type", "text/html");
                res.end(
                  await vite.transformIndexHtml(
                    req.url,
                    `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module" src="${entry}"></script></body></html>`,
                  ),
                );
                return;
              }
              return next();
            });
          },
        },
      ],
      resolve: { alias: { "@": join(root, "packages/ui/src") } },
      optimizeDeps: { entries: [entry.slice(1)] },
      server: { host: "127.0.0.1", port: 0 },
    });
    await server.listen();
    origin = server.resolvedUrls.local[0];
    const profile = join(home, "electron-profile");
    await mkdir(profile);
    const main = join(home, "electron-main.cjs");
    await writeFile(
      main,
      `const {app,BrowserWindow}=require('electron');app.setName('Collaboration Settings Fixture');app.setPath('userData',${JSON.stringify(profile)});app.whenReady().then(()=>{const w=new BrowserWindow({width:1000,height:1000,show:false});w.loadURL('about:blank');});app.on('window-all-closed',()=>app.quit());`,
    );
    app = await _electron.launch({
      executablePath: electronPath,
      args: [main],
      env: { ...process.env, HOME: home },
    });
    page = await app.firstWindow();
    await page.exposeBinding("collaborationRpcSend", (_source, bytes) =>
      rpcInbox.fire(VSBuffer.wrap(Uint8Array.from(bytes))),
    );
    await page.exposeBinding("collaborationRpcReady", () => {
      rpcServer?.dispose();
      rpcInbox?.dispose();
      rpcInbox = new Emitter();
      rpcServer = new ChannelServer(
        {
          onMessage: rpcInbox.event,
          send: (buffer) => {
            void page.evaluate(
              (bytes) =>
                window.dispatchEvent(new CustomEvent("collaboration-rpc", { detail: bytes })),
              Array.from(buffer.buffer),
            );
          },
        },
        "collaboration-fixture",
        1000,
        true,
      );
      rpcServer.registerChannel(
        "bots",
        ProxyChannel.fromService(
          new Proxy(
            {},
            {
              get:
                (_target, name) =>
                (...args) => {
                  rpcCalls.push(String(name));
                  return service[name](...args);
                },
            },
          ),
        ),
      );
      rpcServer.ready();
    });
    await page.goto(origin + "fixture?locale=zh-CN&theme=light");
  },
  { timeout: 120_000 },
);

after(async () => {
  rpcServer?.dispose();
  rpcInbox?.dispose();
  await app?.close().catch(() => {});
  await server?.close();
  await service?.disposeAllAndWait();
  index?.close();
  globalThis.fetch = originalFetch;
  setDataBaseDir(null);
  if (!process.env.ZCODE_TEST_ARTIFACT_DIR && home)
    await rm(home, { recursive: true, force: true });
});

test(
  "原生事件核验→实际设置保存→重建服务读回；在办拒绝且其他群不变",
  { timeout: 120_000 },
  async () => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.getByRole("combobox", { name: "协作群" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "保存协作设置" }).isEnabled(), false);
    for (const id of ids) {
      await page.getByRole("button", { name: `核验 ${id.toUpperCase()}` }).click();
      const command = await page.getByRole("textbox", { name: "身份核验命令" }).inputValue();
      await action("native", { botId: id, command });
      await page.getByRole("button", { name: "刷新", exact: true }).click();
      await page.getByText("已核验", { exact: true }).first().waitFor();
    }
    await choose("PM 机器人", "PM");
    await page.getByRole("checkbox", { name: "执行者：APP" }).check();
    await page.getByRole("textbox", { name: "职责：APP" }).fill("APP development");
    await choose("授权用户", "Demo owner");
    await choose("绑定项目", "Demo project");
    await page.getByRole("switch", { name: "启用 PM 协作" }).check();
    await page.getByRole("button", { name: "保存协作设置" }).click();
    await page.getByText("配置版本：1", { exact: true }).waitFor();
    await action("restart");
    await page.reload();
    await page.getByText("配置版本：1", { exact: true }).waitFor();
    assert.equal(
      await page.getByRole("textbox", { name: "职责：APP" }).inputValue(),
      "APP development",
    );
    await action("busy", { active: true });
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await page.getByText(/群任务在办或状态未确认/).waitFor();
    assert.equal(await page.getByRole("button", { name: "保存协作设置" }).isEnabled(), false);
    const group = (await service.getCollaborationSettings()).groups[0];
    await assert.rejects(
      service.saveCollaborationSettings({
        provider: "feishu",
        chatId: "oc_demo",
        expectedRevision: 1,
        enabled: false,
        pmBotId: "pm",
        executors: [{ botId: "app", duty: "APP development" }],
        authorizedUserId: group.users[0].id,
        workspaceId: group.workspaces[0].id,
      }),
      /collaboration.busy/,
    );
    await action("busy", { active: false });
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await choose("协作群", "Other group");
    await page.getByText("配置版本：0", { exact: true }).waitFor();
    assert.equal(
      (await service.getCollaborationSettings()).groups.find((group) => group.chatId === "oc_other")
        .config,
      null,
    );
    assert.deepEqual(
      await Promise.all(
        ["bot-config.v3.json", "bot-state.v3.json"].map((name) =>
          readFile(join(home, ".zcode/v2", name), "utf8"),
        ),
      ),
      legacyBefore,
    );
    assert.ok(platformRequests.includes("/open-apis/bot/v3/info"));
    assert.ok(rpcCalls.includes("saveCollaborationSettings"));
    assert.deepEqual(errors, []);
    await writeFile(
      join(artifacts, "result.json"),
      JSON.stringify(
        {
          home,
          nativeVerification: true,
          revision: 1,
          restarted: true,
          busyRejected: true,
          otherGroupUnchanged: true,
          officialFilesUnchanged: true,
          actualRpcSerialization: true,
          realTasksExecuted: false,
          realPlatformConnections: false,
        },
        null,
        2,
      ),
    );
  },
);

for (const [width, locale, theme] of [
  [1000, "zh-CN", "light"],
  [1000, "en-US", "dark"],
  [390, "zh-CN", "dark"],
  [390, "en-US", "light"],
]) {
  test(`界面布局 ${width}/${locale}/${theme}`, { timeout: 60_000 }, async () => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${origin}fixture?locale=${locale}&theme=${theme}`);
    await page.getByTestId("bot-collaboration-settings").waitFor();
    await page
      .getByText(locale === "zh-CN" ? "配置版本：1" : "Configuration revision: 1", { exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    assert.equal((await page.locator("body").innerText()).includes("bots.collaboration."), false);
    await page.screenshot({
      path: join(artifacts, `${width}-${locale}-${theme}.png`),
      fullPage: true,
    });
  });
}
