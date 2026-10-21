import { describe, expect, it, vi } from "vitest";
import type { BotConfig } from "@zcode/shared";
import * as f from "./botsService.fixtures.js";

const actor = {
  provider: "webhook" as const,
  botId: "webhook-1",
  providerUserId: "user-1",
  chatType: "private" as const,
};

function createTestProvider(params: {
  id: string;
  name: string;
  models: string[];
}): f.TestModelSelectionProvider {
  return {
    id: params.id,
    name: params.name,
    models: params.models,
  };
}

describe("botsService config", () => {
  it("Bot 主动选模型保存目标最高档位，不继承旧模型的 low", async () => {
    const repo = f.createMemoryRepo(
      {
        ...f.baseConfig,
        bots: [
          {
            ...f.baseConfig.bots[0]!,
            providerUserId: "user-1",
          },
        ],
      },
      {
        version: 3,
        bots: {
          "webhook-1": {
            botId: "webhook-1",
            workspacePath: "/tmp/workspace",
            mode: "draft",
            activeTaskId: null,
            updatedAt: 1,
            draftOptions: {
              provider: "zcode",
              modelSelection: {
                providerId: "target",
                modelId: "old",
                options: { reasoningLevel: "low" },
              },
            },
          },
        },
      },
    );
    const service = f.createBotsService({
      repo: repo as never,
      credentialService: f.createCredentialService({ "secret-1": "secret" }),
      modelSelectionService: f.createModelSelectionService([
        {
          id: "target",
          name: "Target",
          models: [
            {
              id: "new",
              config: { optionSpecs: { reasoningLevel: { values: ["low", "high", "max"] } } },
            },
          ],
        },
      ]),
    });
    try {
      await service.handleInboundMessage({
        botId: "webhook-1",
        text: "/model custom:target:new",
        actor,
      });
      expect((await repo.readState()).bots["webhook-1"]?.draftOptions?.modelSelection).toEqual({
        providerId: "target",
        modelId: "new",
        options: { reasoningLevel: "max" },
      });
    } finally {
      service.disposeAll();
    }
  });

  it("accepts v3 bots config and rejects legacy bot config fields", () => {
    expect(f.botsConfigFileSchema.safeParse(f.baseConfig).success).toBe(true);
    // Bugfix: Bots v3 不做旧 channels.json 隐式迁移；schema 必须 strict，避免未知字段被 Zod strip。
    expect(f.botsConfigFileSchema.safeParse({ version: 1, channels: [] }).success).toBe(false);
    expect(f.botsConfigFileSchema.safeParse({ ...f.baseConfig, channels: [] }).success).toBe(false);
  });

  it("binds a private actor to the requested bot", async () => {
    const repo = f.createMemoryRepo(f.baseConfig);
    const service = f.createBotsService({
      credentialService: f.createCredentialService({ "secret-1": "secret" }),
      legacyTaskService: f.createLegacyTaskService(),
      repo: repo as never,
    });

    const bind = await service.createBindCode({ botId: "webhook-1" });
    const replies = await service.handleInboundMessage({
      botId: "webhook-1",
      text: `/bind ${bind.code}`,
      actor,
    });

    expect(replies[0]?.text).toContain("绑定成功");
    expect((await repo.readConfig()).bots[0]).toMatchObject({
      id: "webhook-1",
      providerUserId: "user-1",
      allowedWorkspaces: ["*"],
    });
    service.disposeAll();
  });

  it("rejects duplicate enabled provider bindings", async () => {
    const repo = f.createMemoryRepo({
      ...f.baseConfig,
      bots: [
        {
          ...f.baseConfig.bots[0]!,
          providerUserId: "user-1",
        },
        {
          ...f.baseConfig.bots[0]!,
          id: "webhook-2",
          name: "Webhook 2",
          providerUserId: "user-1",
        },
      ],
    });
    const service = f.createBotsService({
      credentialService: f.createCredentialService({ "secret-1": "secret" }),
      legacyTaskService: f.createLegacyTaskService(),
      repo: repo as never,
    });

    await expect(service.saveBot({ bot: (await repo.readConfig()).bots[1]! })).rejects.toThrow(
      /provider user/,
    );
    service.disposeAll();
  });

  describe.each(["feishu", "lark"] as const)("%s multiple bots", (provider) => {
    function createPair(overrides: Partial<BotConfig> = {}) {
      const first = { ...f.feishuConfig.bots[0]!, provider };
      const second = {
        ...first,
        id: "feishu-2",
        name: "Second bot",
        credentialRef: "feishu-secret-2",
        feishuAppId: "cli_yyy",
        ...overrides,
      };
      const repo = f.createMemoryRepo({ ...f.feishuConfig, bots: [first, second] });
      const service = f.createBotsService({
        credentialService: f.createCredentialService({
          "feishu-secret": "secret",
          "feishu-secret-2": "secret-2",
        }),
        legacyTaskService: f.createLegacyTaskService(),
        repo: repo as never,
      });
      return { first, second, repo, service };
    }

    function privateMessage(botId: string, providerUserId = "ou_user", text = "/status") {
      return {
        botId,
        text,
        actor: { provider, botId, providerUserId, chatType: "private" as const },
      };
    }

    it("allows one actor to bind distinct enabled apps", async () => {
      const { second, repo, service } = createPair();
      try {
        await service.saveBot({ bot: second });
        expect((await repo.readConfig()).bots.filter((bot) => bot.enabled)).toHaveLength(2);
      } finally {
        service.disposeAll();
      }
    });

    it.each(["cli_xxx", " cli_xxx "])("rejects duplicate enabled app %j", async (appId) => {
      const { second, service } = createPair({ feishuAppId: appId });
      try {
        await expect(service.saveBot({ bot: second })).rejects.toThrow(
          "An enabled bot with this Feishu app already exists.",
        );
      } finally {
        service.disposeAll();
      }
    });

    it("allows a disabled bot to retain the same app", async () => {
      const { second, service } = createPair({ feishuAppId: "cli_xxx", enabled: false });
      try {
        await expect(service.saveBot({ bot: second })).resolves.toMatchObject({ enabled: false });
      } finally {
        service.disposeAll();
      }
    });

    it("rejects enabling a disabled duplicate app", async () => {
      const { second, service } = createPair({ feishuAppId: "cli_xxx", enabled: false });
      try {
        await expect(service.saveBot({ bot: { ...second, enabled: true } })).rejects.toThrow(
          /Feishu app/,
        );
      } finally {
        service.disposeAll();
      }
    });

    it("returns status for the second bot bound to the same actor", async () => {
      // 回归：按绑定用户反查会命中第一个 bot；必须验证第二个 bot 的成功回复而非仅排除一条错误文案。
      const { second, service } = createPair();
      try {
        const replies = await service.handleInboundMessage(privateMessage(second.id));
        expect(replies).toHaveLength(1);
        expect(replies[0]?.botId).toBe(second.id);
        expect(replies[0]?.text).toContain("工作区");
        expect(replies[0]?.text).toContain("模型: default");
      } finally {
        service.disposeAll();
      }
    });

    it("keeps each bot's private task context separate", async () => {
      const { first, second, repo, service } = createPair();
      try {
        await service.handleInboundMessage(privateMessage(first.id, "ou_user", "/new"));
        await service.handleInboundMessage(privateMessage(second.id, "ou_user", "/new"));
        const state = await repo.readState();
        expect(state.bots[first.id]).toMatchObject({ botId: first.id, mode: "draft" });
        expect(state.bots[second.id]).toMatchObject({ botId: second.id, mode: "draft" });
      } finally {
        service.disposeAll();
      }
    });

    it("still requires the target bot's bound user", async () => {
      const { second, service } = createPair({ providerUserId: "ou_other" });
      try {
        const rejected = await service.handleInboundMessage(privateMessage(second.id));
        expect(rejected[0]?.text).toContain("当前 bot 未绑定");
        const accepted = await service.handleInboundMessage(privateMessage(second.id, "ou_other"));
        expect(accepted[0]?.text).toContain("工作区");
      } finally {
        service.disposeAll();
      }
    });

    it("does not authorize a disabled target bot", async () => {
      const { second, service } = createPair({ enabled: false });
      try {
        const replies = await service.handleInboundMessage(privateMessage(second.id));
        expect(replies[0]?.text).toContain("当前 bot 未启用");
      } finally {
        service.disposeAll();
      }
    });

    it("does not authorize a mismatched provider or inbound bot id", async () => {
      const { first, second, service } = createPair();
      try {
        const mismatchedProvider = privateMessage(second.id);
        mismatchedProvider.actor.provider = provider === "feishu" ? "lark" : "feishu";
        const replies = await service.handleInboundMessage(mismatchedProvider);
        expect(replies[0]?.text).toContain("当前 bot 未启用");
        const mismatchedId = { ...privateMessage(first.id), botId: second.id };
        const crossed = await service.handleInboundMessage(mismatchedId);
        expect(crossed[0]?.text).toContain("当前 bot 未启用");
      } finally {
        service.disposeAll();
      }
    });
  });

  it("normalizes empty allowedWorkspaces to wildcard", async () => {
    const repo = f.createMemoryRepo(f.baseConfig);
    const service = f.createBotsService({
      credentialService: f.createCredentialService({ "secret-1": "secret" }),
      legacyTaskService: f.createLegacyTaskService(),
      repo: repo as never,
    });

    await service.saveBot({
      bot: {
        ...f.baseConfig.bots[0]!,
        allowedWorkspaces: [],
      },
    });

    expect((await repo.readConfig()).bots[0]?.allowedWorkspaces).toEqual(["*"]);
    service.disposeAll();
  });

  it("does not run remote-disabled bot background work after config changes", async () => {
    const repo = f.createMemoryRepo(f.baseConfig);
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchImpl);
    const modelSelectionService = f.createModelSelectionService([
      createTestProvider({
        id: "new-provider",
        name: "DeepSeek",
        models: ["deepseek-v4-flash"],
      }),
    ]);
    const service = f.createBotsService({
      repo: repo as never,
      modelSelectionService,
      credentialService: f.createCredentialService({
        "secret-1": "secret",
        "telegram-token": "telegram-secret",
      }),
      runStartupBackgroundTasks: false,
      warmCandidateCachesOnStartup: false,
    });

    await service.saveConfig(f.telegramConfig);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(modelSelectionService.getView).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    service.disposeAll();
  });

  it("allows an unnamed bot so UI can show a fallback display name", async () => {
    const repo = f.createMemoryRepo(f.baseConfig);
    const service = f.createBotsService({
      credentialService: f.createCredentialService({ "secret-1": "secret" }),
      legacyTaskService: f.createLegacyTaskService(),
      repo: repo as never,
    });

    await service.saveBot({
      bot: {
        ...f.baseConfig.bots[0]!,
        name: "   ",
      },
    });

    expect((await repo.readConfig()).bots[0]?.name).toBe("");
    service.disposeAll();
  });

  it("/model 展示当前候选，但不把已保存选择按同名模型换到其他供应商", async () => {
    const repo = f.createMemoryRepo(
      {
        ...f.baseConfig,
        bots: [
          {
            ...f.baseConfig.bots[0]!,
            providerUserId: "user-1",
          },
        ],
      },
      {
        version: 3,
        bots: {
          "webhook-1": {
            botId: "webhook-1",
            workspacePath: "/tmp/workspace",
            workspaceIdentity: "remote:server:test-owner:/tmp/workspace",
            mode: "draft",
            activeTaskId: null,
            draftOptions: {
              provider: "glm",
              modelSelection: { providerId: "old-provider", modelId: "deepseek-v4-flash" },
            },
            updatedAt: 1,
          },
        },
      },
    );
    const currentProvider = createTestProvider({
      id: "new-provider",
      name: "DeepSeek",
      models: ["deepseek-v4-flash"],
    });
    const service = f.createBotsService({
      repo: repo as never,
      modelSelectionService: f.createModelSelectionService([currentProvider]),
      credentialService: f.createCredentialService({ "secret-1": "secret" }),
    });

    const replies = await service.handleInboundMessage({
      botId: "webhook-1",
      text: "/model",
      actor,
    });

    expect(replies[0]?.selection?.options.some((option) => option.id === "new-provider")).toBe(
      true,
    );
    await expect(repo.readState()).resolves.toMatchObject({
      bots: {
        "webhook-1": {
          draftOptions: {
            modelSelection: {
              providerId: "old-provider",
              modelId: "deepseek-v4-flash",
            },
          },
        },
      },
    });
    service.disposeAll();
  });

  it("/model 标记当前生效的账号模型，但只读菜单不覆盖原草稿", async () => {
    const original = {
      providerId: "account:bigmodel-individual-coding-plan",
      modelId: "GLM-5.3",
      options: { reasoningLevel: "high" },
    };
    const effective = { ...original, providerId: "account:bigmodel-team-coding-plan" };
    const repo = f.createMemoryRepo(
      { ...f.baseConfig, bots: [{ ...f.baseConfig.bots[0]!, providerUserId: "user-1" }] },
      {
        version: 3,
        bots: {
          "webhook-1": {
            botId: "webhook-1",
            workspacePath: "/tmp/workspace",
            mode: "draft",
            activeTaskId: null,
            draftOptions: { provider: "glm", modelSelection: original },
            updatedAt: 1,
          },
        },
      },
    );
    const selectionService = f.createModelSelectionService([
      { id: effective.providerId, name: "Team", models: [effective.modelId] },
    ]);
    const view = await selectionService.getView();
    selectionService.getView.mockImplementation(async (input) => ({
      ...view,
      ...(input ? { effectiveSelection: effective } : {}),
    }));
    const service = f.createBotsService({
      repo: repo as never,
      modelSelectionService: selectionService,
      credentialService: f.createCredentialService({ "secret-1": "secret" }),
    });
    try {
      const replies = await service.handleInboundMessage({
        botId: "webhook-1",
        text: "/model",
        actor,
      });
      expect(replies[0]?.selection?.currentId).toBe(effective.providerId);
      expect((await repo.readState()).bots["webhook-1"]?.draftOptions?.modelSelection).toEqual(
        original,
      );
    } finally {
      service.disposeAll();
    }
  });

  it("/model 每次打开都与当前 Model Selection View 对齐", async () => {
    const repo = f.createMemoryRepo({
      ...f.baseConfig,
      bots: [
        {
          ...f.baseConfig.bots[0]!,
          providerUserId: actor.providerUserId,
        },
      ],
    });
    const oldProvider = createTestProvider({
      id: "old-provider",
      name: "Old Provider",
      models: ["old-model"],
    });
    const newProvider = createTestProvider({
      id: "new-provider",
      name: "New Provider",
      models: ["new-model"],
    });
    let currentProviders = [oldProvider];
    const modelSelectionService = f.createModelSelectionService();
    vi.mocked(modelSelectionService.getView).mockImplementation(async () =>
      f.createModelSelectionService(currentProviders).getView(),
    );
    const service = f.createBotsService({
      repo: repo as never,
      modelSelectionService,
      credentialService: f.createCredentialService({ "secret-1": "secret" }),
    });

    const firstReplies = await service.handleInboundMessage({
      botId: "webhook-1",
      text: "/model",
      actor,
    });
    expect(firstReplies[0]?.selection?.options.map((option) => option.id)).toContain(
      "old-provider",
    );

    currentProviders = [newProvider];
    const secondReplies = await service.handleInboundMessage({
      botId: "webhook-1",
      text: "/model",
      actor,
    });
    const secondProviderIds = secondReplies[0]?.selection?.options.map((option) => option.id);
    expect(secondProviderIds).toContain("new-provider");
    expect(secondProviderIds).not.toContain("old-provider");
    service.disposeAll();
  });

  it("同路径的远端读取失败不使用之前本地菜单缓存，恢复后显示目标模型", async () => {
    const repo = f.createMemoryRepo(
      {
        ...f.baseConfig,
        bots: [{ ...f.baseConfig.bots[0]!, providerUserId: actor.providerUserId }],
      },
      {
        version: 3,
        bots: {
          "webhook-1": {
            botId: "webhook-1",
            workspacePath: "/tmp/workspace",
            workspaceId: "/tmp/workspace",
            mode: "draft",
            activeTaskId: null,
            updatedAt: 1,
            draftOptions: {
              provider: "zcode",
              modelSelection: {
                providerId: "local-only",
                modelId: "m",
                options: { reasoningLevel: "high" },
              },
            },
          },
        },
      },
    );
    const local = f.createModelSelectionService([
      { id: "local-only", name: "Local Only", models: ["m"] },
    ]);
    const remote = f.createModelSelectionService([
      { id: "remote-only", name: "Remote Only", models: ["m"] },
    ]);
    const getRemote = vi.fn(async () => remote);
    const settingService = f.createSettingService({
      locale: "zh-CN",
      lastWorkspaceSession: [{ kind: "local", workspacePath: "/tmp/workspace" }],
    });
    const service = f.createBotsService({
      ...f.createBotProjectServices([{ workspacePath: "/tmp/workspace" }]),
      repo: repo as never,
      modelSelectionService: local,
      settingService,
      remoteWorkspaceService: {
        isConnected: vi.fn(async () => true),
        ensureConnected: vi.fn(async () => ({ ok: true })),
        getZCodeTaskService: vi.fn(async () => f.createLegacyTaskService()),
        getModelSelectionService: getRemote,
      },
      credentialService: f.createCredentialService({ "secret-1": "secret" }),
    });
    const menu = () => service.handleInboundMessage({ botId: "webhook-1", text: "/model", actor });
    try {
      expect((await menu())[0]?.selection?.options.map((option) => option.id)).toContain(
        "local-only",
      );
      const state = await repo.readState();
      const contextKey = Object.keys(state.bots)[0]!;
      const original = state.bots[contextKey]!;
      await repo.writeState({
        ...state,
        bots: {
          ...state.bots,
          [contextKey]: {
            ...original,
            workspaceId: JSON.stringify(["remote:server:other-owner", "project-0"]),
            hostId: "remote:server:other-owner",
            workspaceIdentity: "remote:server:other-owner:/tmp/workspace",
          },
        },
      });
      const before = structuredClone(await repo.readState());
      remote.getView.mockRejectedValue(new Error("remote offline"));
      const unavailable = await menu();
      expect(getRemote).toHaveBeenCalledWith({
        workspacePath: "/tmp/workspace",
        workspaceIdentity: "remote:server:other-owner:/tmp/workspace",
      });
      expect(unavailable[0]?.text).toContain("未找到模型供应商");
      expect(unavailable[0]?.selection).toBeUndefined();
      expect((await repo.readState()).bots[contextKey]?.draftOptions).toEqual(
        before.bots[contextKey]?.draftOptions,
      );
      remote.getView.mockImplementation(
        f.createModelSelectionService([{ id: "remote-only", name: "Remote Only", models: ["m"] }])
          .getView,
      );
      const restored = (await menu())[0]?.selection?.options.map((option) => option.id);
      expect(restored).toContain("remote-only");
      expect(restored).not.toContain("local-only");
      expect(getRemote).toHaveBeenCalled();
    } finally {
      service.disposeAll();
    }
  });

  it("空 Model Selection View 不回退持久化的旧 Provider 菜单", async () => {
    const repo = f.createMemoryRepo({
      ...f.baseConfig,
      bots: [
        {
          ...f.baseConfig.bots[0]!,
          providerUserId: actor.providerUserId,
        },
      ],
    });
    const service = f.createBotsService({
      repo: repo as never,
      modelSelectionService: f.createModelSelectionService(),
      credentialService: f.createCredentialService({ "secret-1": "secret" }),
    });

    const replies = await service.handleInboundMessage({
      botId: "webhook-1",
      text: "/model",
      actor,
    });

    expect(replies[0]?.text).toContain("未找到模型供应商");
    service.disposeAll();
  });
});
