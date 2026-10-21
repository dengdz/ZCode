import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { setDataBaseDir } from "../src/paths.js";
import * as f from "./botsService.fixtures.js";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  setDataBaseDir(null);
});
async function setup() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("tenant_access_token"))
        return Response.json({ code: 0, tenant_access_token: "synthetic-token", expire: 3600 });
      if (url.includes("/im/v1/chats/oc_project"))
        return Response.json({ code: 0, data: { name: "Synthetic project", chat_mode: "group" } });
      throw new Error("Unexpected external request in isolated fixture");
    }),
  );
  const home = await mkdtemp(join(tmpdir(), "collaboration-settings-"));
  setDataBaseDir(home);
  cleanups.push(() => rm(home, { recursive: true, force: true }));
  const first = f.feishuConfig.bots[0]!;
  const repo = f.createMemoryRepo(
    {
      version: 3,
      bots: [
        first,
        {
          ...first,
          id: "executor",
          name: "App",
          feishuAppId: "cli_executor",
          providerUserId: "ou_other_app_user",
        },
      ],
    },
    {
      version: 3,
      bots: {
        [JSON.stringify([first.id, "oc_project"])]: {
          botId: first.id,
          workspacePath: "/project",
          mode: "draft",
          activeTaskId: null,
          updatedAt: 1,
          group: {
            chatId: "oc_project",
            name: "Synthetic project",
            enabled: true,
            authorizationId: "old-card-authorization",
            ownerId: "ou_user",
            taskIds: [],
            currentOptions: {},
          },
        },
      },
    },
  );
  const tasks = f.createLegacyTaskService();
  tasks.listActiveTaskIds = vi.fn(async () => []);
  tasks.getBotGroupTaskBlockReason = vi.fn(async () => null);
  const projects = f.createBotProjectServices([
    { workspacePath: "/project" },
    { workspacePath: "/other" },
  ]);
  const create = (local = true) => {
    const service = f.createBotsService({
      repo: repo as never,
      ...projects,
      credentialService: f.createCredentialService({ "feishu-secret": "synthetic-app-value" }),
      localCollaborationEnabled: local,
      zcodeTaskService: tasks,
      runStartupBackgroundTasks: false,
    });
    cleanups.push(() => service.disposeAllAndWait());
    return service;
  };
  return { create, repo, home, tasks, projects };
}
it("用户通过一次原生提及核验跨应用身份，保存群角色与固定项目后重启仍一致", async () => {
  const { create } = await setup();
  const service = create();
  const initial = await service.getCollaborationSettings!();
  expect(initial?.groups[0]?.bots.every((bot) => !bot.verified)).toBe(true);
  for (const [botId, owner] of [
    ["feishu-1", "ou_user"],
    ["executor", "ou_other_app_user"],
  ]) {
    const challenge = await service.beginCollaborationVerification!({
      provider: "feishu",
      chatId: "oc_project",
      botId: botId!,
    });
    const reply = await service.handleInboundMessage({
      botId: botId!,
      botOpenId: `ou_${botId!.replace(/-/g, "_")}`,
      mentionedBot: true,
      senderType: "user",
      senderUnionId: "on_same_person",
      tenantKey: "tenant",
      text: challenge.command,
      actor: {
        provider: "feishu",
        botId: botId!,
        chatId: "oc_project",
        chatType: "group",
        providerUserId: owner!,
        displayName: "Synthetic owner",
      },
    });
    expect(reply[0]?.text).toContain("核验");
  }
  const options = (await service.getCollaborationSettings!())!.groups[0]!;
  const saved = await service.saveCollaborationSettings!({
    provider: "feishu",
    chatId: "oc_project",
    expectedRevision: 0,
    enabled: true,
    pmBotId: "feishu-1",
    executors: [{ botId: "executor", duty: "APP development" }],
    authorizedUserId: options.users[0]!.id,
    workspaceId: options.workspaces[0]!.id,
  });
  expect(saved.groups[0]?.config).toMatchObject({
    revision: 1,
    pm: { botId: "feishu-1" },
    executors: [{ botId: "executor", duty: "APP development" }],
    workspace: { workspacePath: "/project", projectId: "project-0" },
  });
  await service.disposeAllAndWait();
  expect((await create().getCollaborationSettings!())!.groups[0]!.config).toEqual(
    saved.groups[0]!.config,
  );
});

async function configured() {
  const fixture = await setup();
  const service = fixture.create();
  for (const [botId, owner] of [
    ["feishu-1", "ou_user"],
    ["executor", "ou_other_app_user"],
  ] as const) {
    const challenge = await service.beginCollaborationVerification!({
      provider: "feishu",
      chatId: "oc_project",
      botId,
    });
    await service.handleInboundMessage({
      botId,
      botOpenId: `ou_${botId.replace(/-/g, "_")}`,
      mentionedBot: true,
      senderType: "user",
      senderUnionId: "on_same_person",
      tenantKey: "tenant",
      text: challenge.command,
      actor: {
        provider: "feishu",
        botId,
        chatId: "oc_project",
        chatType: "group",
        providerUserId: owner,
        displayName: "Synthetic owner",
      },
    });
  }
  const group = (await service.getCollaborationSettings!())!.groups[0]!;
  const request = {
    provider: "feishu" as const,
    chatId: "oc_project",
    expectedRevision: 0,
    enabled: true,
    pmBotId: "feishu-1",
    executors: [{ botId: "executor", duty: "APP development" }],
    authorizedUserId: group.users[0]!.id,
    workspaceId: group.workspaces[0]!.id,
  };
  await service.saveCollaborationSettings!(request);
  return { ...fixture, service, request: { ...request, expectedRevision: 1 } };
}

it("旧配置以本机项目路径限定权限时仍能保存协作设置", async () => {
  const { service, request, repo } = await configured();
  const config = await repo.readConfig();
  await repo.writeConfig({
    ...config,
    bots: config.bots.map((bot) => ({ ...bot, allowedWorkspaces: ["/project"] })),
  });
  const saved = await service.saveCollaborationSettings!({
    ...request,
    executors: [{ botId: "executor", duty: "Updated duty" }],
  });
  expect(saved.groups[0]?.config?.revision).toBe(2);
});

it("运行事实读取失败时展示状态未确认且拒绝修改，原授权保留", async () => {
  const { service, request, tasks } = await configured();
  tasks.listActiveTaskIds = vi.fn(async () => {
    throw new Error("runtime disconnected");
  });
  expect((await service.getCollaborationSettings!())!.groups[0]!.busy).toBe(true);
  await expect(service.saveCollaborationSettings!({ ...request, enabled: false })).rejects.toThrow(
    "collaboration.busy",
  );
});

it("另一个Host设置窗口也不能在群输入接收期间更换授权", async () => {
  const { service, create, request, tasks } = await configured();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  tasks.listTasks = vi.fn(async () => {
    entered();
    await waiting;
    return [];
  });
  const inbound = service.handleInboundMessage({
    botId: "feishu-1",
    text: "/status",
    actor: {
      botId: "feishu-1",
      provider: "feishu",
      providerUserId: "ou_user",
      chatType: "group",
      chatId: "oc_project",
    },
  });
  await started;
  try {
    await expect(
      create().saveCollaborationSettings!({ ...request, enabled: false }),
    ).rejects.toThrow("collaboration.busy");
  } finally {
    release();
    await inbound;
  }
});

it("群请求使用保存的固定项目，群内workspace命令不能更改绑定", async () => {
  const { service, request, tasks } = await configured();
  const options = (await service.getCollaborationSettings!())!.groups[0]!;
  await service.saveCollaborationSettings!({ ...request, workspaceId: options.workspaces[1]!.id });
  const actor = {
    botId: "feishu-1",
    provider: "feishu" as const,
    providerUserId: "ou_user",
    chatType: "group" as const,
    chatId: "oc_project",
  };
  const reply = await service.handleInboundMessage({ botId: actor.botId, actor, text: "/status" });
  expect(tasks.listTasks).toHaveBeenCalledWith(
    expect.objectContaining({ workspacePath: "/other" }),
  );
  expect(reply[0]?.text).toContain("other");
  const blocked = await service.handleInboundMessage({
    botId: actor.botId,
    actor,
    text: "/workspace",
  });
  expect(blocked[0]?.text).toContain("固定项目");
  expect(
    (await service.getCollaborationSettings!())!.groups[0]!.config!.workspace.workspacePath,
  ).toBe("/other");
});

it("关闭既有群开关后，协作设置不会在下一条消息自动重开群", async () => {
  const { service } = await configured();
  await service.setGroupEnabled!({ botId: "feishu-1", chatId: "oc_project", enabled: false });
  const replies = await service.handleInboundMessage({
    botId: "feishu-1",
    text: "/status",
    actor: {
      botId: "feishu-1",
      provider: "feishu",
      providerUserId: "ou_user",
      chatType: "group",
      chatId: "oc_project",
    },
  });
  expect(replies[0]?.text).toContain("尚未启用");
});

it("角色授权版本改变后旧群卡片不能沿用原授权", async () => {
  const { service, request } = await configured();
  await service.saveCollaborationSettings!({
    ...request,
    executors: [{ botId: "executor", duty: "new duty" }],
  });
  const replies = await service.handleInboundMessage({
    botId: "feishu-1",
    text: "/status",
    groupCardAction: true,
    groupCard: { chatId: "oc_project", taskId: null, authorizationId: "old-card-authorization" },
    actor: {
      botId: "feishu-1",
      provider: "feishu",
      providerUserId: "ou_user",
      chatType: "group",
      chatId: "oc_project",
    },
  });
  expect(replies[0]?.text).toMatch(/失效|过期/);
});

it("机器人伪造核验命令既不建立身份也不触发工作或回复回环", async () => {
  const { create, tasks } = await setup();
  const service = create();
  const challenge = await service.beginCollaborationVerification!({
    provider: "feishu",
    chatId: "oc_project",
    botId: "feishu-1",
  });
  const replies = await service.handleInboundMessage({
    botId: "feishu-1",
    text: challenge.command,
    senderType: "app",
    botOpenId: "ou_pm",
    mentionedBot: true,
    senderUnionId: "on_owner",
    tenantKey: "tenant",
    actor: {
      botId: "feishu-1",
      provider: "feishu",
      providerUserId: "ou_user",
      chatType: "group",
      chatId: "oc_project",
    },
  });
  expect(replies).toEqual([]);
  expect((await service.getCollaborationSettings!())!.groups[0]!.bots[0]!.verified).toBe(false);
  expect(tasks.createTask).not.toHaveBeenCalled();
});

it.each(["plain-name", "other-user", "other-group", "missing-union"])(
  "核验拒绝不可信输入：%s",
  async (kind) => {
    const { create, tasks } = await setup();
    const service = create();
    const challenge = await service.beginCollaborationVerification!({
      provider: "feishu",
      chatId: "oc_project",
      botId: "feishu-1",
    });
    await service.handleInboundMessage({
      botId: "feishu-1",
      text: challenge.command,
      mentionedBot: kind !== "plain-name",
      senderType: "user",
      botOpenId: "ou_pm",
      senderUnionId: kind === "missing-union" ? undefined : "on_owner",
      tenantKey: "tenant",
      actor: {
        botId: "feishu-1",
        provider: "feishu",
        providerUserId: kind === "other-user" ? "ou_intruder" : "ou_user",
        chatType: "group",
        chatId: kind === "other-group" ? "oc_elsewhere" : "oc_project",
      },
    });
    expect(
      (await service.getCollaborationSettings!())!.groups[0]!.bots.every((bot) => !bot.verified),
    ).toBe(true);
    expect(tasks.createTask).not.toHaveBeenCalled();
  },
);

it("核验命令过期或重放时不重新建立授权", async () => {
  const { create } = await setup();
  const service = create();
  const challenge = await service.beginCollaborationVerification!({
    provider: "feishu",
    chatId: "oc_project",
    botId: "feishu-1",
  });
  const clock = vi.spyOn(Date, "now").mockReturnValue(challenge.expiresAt + 1);
  try {
    const replies = await service.handleInboundMessage({
      botId: "feishu-1",
      text: challenge.command,
      mentionedBot: true,
      senderType: "user",
      botOpenId: "ou_pm",
      senderUnionId: "on_owner",
      tenantKey: "tenant",
      actor: {
        botId: "feishu-1",
        provider: "feishu",
        providerUserId: "ou_user",
        chatType: "group",
        chatId: "oc_project",
      },
    });
    expect(replies[0]?.text).toContain("未完成");
    expect((await service.getCollaborationSettings!())!.groups[0]!.bots[0]!.verified).toBe(false);
  } finally {
    clock.mockRestore();
  }
});

it("在办拒绝关键变更，结束后递增版本，无变化不递增，旧窗口不能覆盖", async () => {
  const { service, tasks, request } = await configured();
  tasks.listActiveTaskIds = vi.fn(async () => ["active-task"]);
  await expect(service.saveCollaborationSettings!({ ...request, enabled: false })).rejects.toThrow(
    "collaboration.busy",
  );
  expect((await service.getCollaborationSettings!())!.groups[0]!.config!.revision).toBe(1);
  tasks.listActiveTaskIds = vi.fn(async () => []);
  const changed = {
    ...request,
    executors: [{ botId: "executor", duty: "Revised responsibility" }],
  };
  expect((await service.saveCollaborationSettings!(changed)).groups[0]!.config!.revision).toBe(2);
  expect(
    (await service.saveCollaborationSettings!({ ...changed, expectedRevision: 2 })).groups[0]!
      .config!.revision,
  ).toBe(2);
  await expect(service.saveCollaborationSettings!(changed)).rejects.toThrow("collaboration.stale");
});

it.each(["duplicate", "manual-id", "unknown-bot"])("保存不允许绕过可信选项：%s", async (kind) => {
  const { service, request } = await configured();
  const invalid =
    kind === "duplicate"
      ? { ...request, pmBotId: "executor" }
      : kind === "manual-id"
        ? { ...request, openId: "ou_forged" }
        : { ...request, pmBotId: "Feishu" };
  await expect(service.saveCollaborationSettings!(invalid)).rejects.toThrow();
  expect((await service.getCollaborationSettings!())!.groups[0]!.config!.revision).toBe(1);
});

it("机器人改名不改变职责，替换应用则必须重新核验", async () => {
  const { service, request, repo } = await configured();
  const before = (await service.getCollaborationSettings!())!.groups[0]!.config;
  const config = structuredClone(await repo.readConfig());
  config.bots[1]!.name = "Renamed App";
  await repo.writeConfig(config);
  const renamed = (await service.getCollaborationSettings!())!.groups[0]!;
  expect(renamed.bots.find((bot) => bot.id === "executor")!.name).toBe("Renamed App");
  expect(renamed.config).toEqual(before);
  config.bots[1]!.feishuAppId = "cli_replaced";
  await repo.writeConfig(config);
  expect(
    (await service.getCollaborationSettings!())!.groups[0]!.bots.find(
      (bot) => bot.id === "executor",
    )!.verified,
  ).toBe(false);
  await expect(
    service.saveCollaborationSettings!({
      ...request,
      executors: [{ botId: "executor", duty: "Changed duty" }],
    }),
  ).rejects.toThrow("collaboration.identityUnavailable");
});

it.each(["disabled-member", "deleted-members", "replaced-app", "deleted-project"])(
  "失效配置仍可撤销，关闭不借机改变原身份：%s",
  async (kind) => {
    const { service, request, repo, tasks, projects } = await configured();
    const previous = (await service.getCollaborationSettings!())!.groups[0]!.config!;
    const config = structuredClone(await repo.readConfig());
    if (kind === "deleted-members") config.bots = [];
    else if (kind === "disabled-member") config.bots[1]!.enabled = false;
    else if (kind === "replaced-app") config.bots[1]!.feishuAppId = "cli_replaced";
    else projects.projectService.readProjects.mockResolvedValue([]);
    await repo.writeConfig(config);
    const group = (await service.getCollaborationSettings!())!.groups.find(
      (item) => item.chatId === request.chatId,
    );
    expect(group?.name).toBe("Synthetic project");
    tasks.listActiveTaskIds = vi.fn(async () => ["active-task"]);
    await expect(
      service.saveCollaborationSettings!({ ...request, enabled: false }),
    ).rejects.toThrow("collaboration.busy");
    tasks.listActiveTaskIds = vi.fn(async () => []);
    const saved = await service.saveCollaborationSettings!({
      ...request,
      enabled: false,
      pmBotId: "forged-id",
      workspaceId: "invalid-project",
    });
    expect(saved.groups[0]?.config).toEqual({ ...previous, revision: 2, enabled: false });
  },
);

it.each(["{invalid", '{"version":999}'])("未知或损坏Local存储不被默认值覆盖：%s", async (raw) => {
  const { service, home, request } = await configured();
  const file = join(home, ".zcode/local/v1/collaboration.json");
  await writeFile(file, raw);
  await expect(service.getCollaborationSettings!()).rejects.toThrow();
  await expect(service.saveCollaborationSettings!(request)).rejects.toThrow();
  expect(await readFile(file, "utf8")).toBe(raw);
});

it("非Local宿主不提供新设置，配置不会跨Provider套用", async () => {
  const { create } = await setup();
  expect(await create(false).getCollaborationSettings!()).toBeNull();
  await expect(
    create(false).beginCollaborationVerification!({
      provider: "feishu",
      chatId: "oc_project",
      botId: "feishu-1",
    }),
  ).rejects.toThrow("collaboration.unavailable");
  await expect(
    create().beginCollaborationVerification!({
      provider: "lark",
      chatId: "oc_project",
      botId: "feishu-1",
    }),
  ).rejects.toThrow("collaboration.groupUnavailable");
});

it("两个配置ID指向同一个平台应用时不能分饰PM与执行者", async () => {
  const { service, request, repo } = await configured();
  const config = structuredClone(await repo.readConfig());
  config.bots[1]!.feishuAppId = config.bots[0]!.feishuAppId;
  config.bots[1]!.providerUserId = "ou_user";
  await repo.writeConfig(config);
  const challenge = await service.beginCollaborationVerification!({
    provider: "feishu",
    chatId: "oc_project",
    botId: "executor",
  });
  await service.handleInboundMessage({
    botId: "executor",
    text: challenge.command,
    mentionedBot: true,
    senderType: "user",
    botOpenId: "ou_feishu_1",
    senderUnionId: "on_same_person",
    tenantKey: "tenant",
    actor: {
      botId: "executor",
      provider: "feishu",
      providerUserId: "ou_user",
      chatType: "group",
      chatId: "oc_project",
    },
  });
  await expect(service.saveCollaborationSettings!(request)).rejects.toThrow(
    "collaboration.duplicateRole",
  );
});
