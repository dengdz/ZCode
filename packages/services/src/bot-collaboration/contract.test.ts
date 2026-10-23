import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { createBotCollaboration } from "./index.js";
import type { BotCollaborationContract } from "./contract.js";
it("只读空配置不生成默认授权或覆盖业务文件", async () => {
  const root = await mkdtemp(join(tmpdir(), "collaboration-contract-"));
  const file = join(root, "local/v1/collaboration.json");
  try {
    const service: BotCollaborationContract = createBotCollaboration({
      file,
      readConfig: async () => ({ version: 3, bots: [] }),
      readStates: async () => [],
      listWorkspaces: async () => [],
      canUseWorkspace: () => false,
      isIdle: async () => true,
    });
    expect(await service.readSettings({ kind: "snapshot" })).toEqual({
      kind: "snapshot",
      snapshot: { groups: [] },
    });
    expect(
      await service.recipientSelection({ kind: "present", selectionId: "unknown-card" }),
    ).toBeUndefined();
    expect(
      await service.control({
        kind: "stop",
        message: {
          botId: "pm",
          text: "/stop",
          senderType: "user",
          actor: {
            botId: "pm",
            provider: "feishu",
            chatType: "group",
            chatId: "oc_synthetic",
            providerUserId: "ou_synthetic",
            providerMessageId: "om_stop",
          },
        },
      }),
    ).toBeUndefined();
    await expect(stat(file)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("既有 v1 需求记录缺少验收字段时仍可只读解析且不会被改写", async () => {
  const root = await mkdtemp(join(tmpdir(), "collaboration-contract-legacy-"));
  const file = join(root, "local/v1/collaboration.json");
  const legacy = JSON.stringify({
    version: 1,
    groups: [],
    requirements: [
      {
        provider: "feishu",
        chatId: "oc_synthetic",
        id: "requirement-1",
        revision: 1,
        unionId: "on_synthetic",
        tenantKey: "tenant",
        name: "Original user",
      },
    ],
  });
  try {
    await mkdir(join(root, "local/v1"), { recursive: true });
    await writeFile(file, legacy);
    const service: BotCollaborationContract = createBotCollaboration({
      file,
      readConfig: async () => ({ version: 3, bots: [] }),
      readStates: async () => [],
      listWorkspaces: async () => [],
      canUseWorkspace: () => false,
      isIdle: async () => true,
    });
    await expect(service.readSettings({ kind: "snapshot" })).resolves.toEqual({
      kind: "snapshot",
      snapshot: { groups: [] },
    });
    expect(await readFile(file, "utf8")).toBe(legacy);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
