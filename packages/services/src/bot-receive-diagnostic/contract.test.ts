import {
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
  realpath,
  readdir,
  chmod,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import { createLocalReceiveDiagnostic } from "./index.js";
afterEach(() => vi.unstubAllEnvs());

it.skipIf(process.platform === "win32")("18 非普通请求文件不能阻塞诊断和 Host 退出", async () => {
  const f = await diagnosticRequest();
  try {
    await rm(f.file);
    await promisify(execFile)("mkfifo", [f.file]);
    const diagnostic = createLocalReceiveDiagnostic(true);
    diagnostic.record(f.scope, { stage: "native", outcome: "received" });
    await expect(diagnostic.dispose()).resolves.toBeUndefined();
    await expect(stat(join(f.root, "events.jsonl"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

async function diagnosticRequest(overrides: Record<string, unknown> = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "receive-contract-")));
  const file = join(root, "request.json");
  await writeFile(
    file,
    JSON.stringify({
      schema: 1,
      botId: "synthetic-bot",
      chatId: "synthetic-chat",
      salt: "22".repeat(32),
      expiresAt: Date.now() + 60_000,
      maxRecords: 2,
      ...overrides,
    }),
    { mode: 0o600 },
  );
  vi.stubEnv("ZCODE_LOCAL_RECEIVE_DIAGNOSTIC_FILE", file);
  return {
    root,
    file,
    scope: {
      provider: "feishu",
      botId: "synthetic-bot",
      chatId: "synthetic-chat",
      messageId: "sensitive-message-id",
    },
  };
}

it("18 指定 WebSocket owner 的无消息连接记录证明观察器已就绪", async () => {
  const f = await diagnosticRequest();
  try {
    const diagnostic = createLocalReceiveDiagnostic(true);
    diagnostic.record(
      { provider: "feishu", botId: "other-bot" },
      { stage: "connection", outcome: "ready" },
    );
    diagnostic.record(
      {
        provider: "feishu",
        botId: "synthetic-bot",
        senderId: "OUTSIDE-SENDER",
        messageId: "OUTSIDE-MESSAGE",
      },
      { stage: "connection", outcome: "ready", facts: { senderType: "user", mentionCount: 10 } },
    );
    diagnostic.record(
      { ...f.scope, chatId: "other-chat" },
      { stage: "native", outcome: "received" },
    );
    await diagnostic.dispose();
    const events = (await readFile(join(f.root, "events.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ stage: "connection", outcome: "ready", facts: {} });
    expect(events[0].facts).toEqual({});
    expect(events[0].senderRef).toBeUndefined();
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

it("18 诊断公开入口默认关闭、官网禁用且不生成输出", async () => {
  const f = await diagnosticRequest();
  try {
    const official = createLocalReceiveDiagnostic(false);
    official.record(f.scope, { stage: "native", outcome: "received" });
    await official.dispose();
    vi.stubEnv("ZCODE_LOCAL_RECEIVE_DIAGNOSTIC_FILE", "");
    const normal = createLocalReceiveDiagnostic(true);
    normal.record(f.scope, { stage: "native", outcome: "received" });
    await normal.dispose();
    expect(await readdir(f.root)).toEqual(["request.json"]);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

it("18 诊断仅观察指定 scope、白名单事实，限量且重建不能续写", async () => {
  const f = await diagnosticRequest();
  try {
    const diagnostic = createLocalReceiveDiagnostic(true);
    diagnostic.record(
      { ...f.scope, chatId: "other-chat" },
      { stage: "native", outcome: "received" },
    );
    diagnostic.record({ ...f.scope, botId: "other-bot" }, { stage: "native", outcome: "received" });
    const untrustedFacts = {
      senderType: "bot" as const,
      mentionCount: 1,
      senderIdPresent: true,
      text: "SENSITIVE-BODY",
      token: "SENSITIVE-SECRET",
      unknown: { nested: "SENSITIVE" },
    };
    diagnostic.record(f.scope, {
      stage: "native",
      outcome: "received",
      facts: untrustedFacts,
    });
    diagnostic.record(f.scope, { stage: "parse", outcome: "empty" });
    diagnostic.record(f.scope, { stage: "complete", outcome: "ready" });
    await diagnostic.dispose();
    const file = join(f.root, "events.jsonl");
    const raw = await readFile(file, "utf8");
    const events = raw
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events).toHaveLength(2);
    expect(events[0].facts).toEqual({ senderType: "bot", mentionCount: 1, senderIdPresent: true });
    expect(events[0].eventRef).toBe(events[1].eventRef);
    expect(raw).not.toMatch(
      /SENSITIVE|sensitive-message-id|synthetic-chat|synthetic-bot|other-chat/u,
    );
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    const restarted = createLocalReceiveDiagnostic(true);
    restarted.record(f.scope, { stage: "native", outcome: "received" });
    await restarted.dispose();
    expect(await readFile(file, "utf8")).toBe(raw);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

it.each([
  "expired",
  "too-long",
  "extra-field",
  "file-permission",
  "directory-permission",
  "request-link",
  "output-link",
])("18 诊断拒绝无效私有请求且不覆盖目标：%s", async (kind) => {
  const f = await diagnosticRequest(
    kind === "expired"
      ? { expiresAt: Date.now() - 1 }
      : kind === "too-long"
        ? { expiresAt: Date.now() + 31 * 60_000 }
        : kind === "extra-field"
          ? { extra: "SENSITIVE" }
          : {},
  );
  try {
    const target = join(f.root, "preserve.txt");
    await writeFile(target, "PRESERVE", { mode: 0o600 });
    if (kind === "file-permission") await chmod(f.file, 0o644);
    if (kind === "directory-permission") await chmod(f.root, 0o755);
    if (kind === "request-link") {
      await rm(f.file);
      await symlink(target, f.file);
    }
    if (kind === "output-link") await symlink(target, join(f.root, "events.jsonl"));
    const diagnostic = createLocalReceiveDiagnostic(true);
    diagnostic.record(f.scope, { stage: "native", outcome: "received" });
    await expect(diagnostic.dispose()).resolves.toBeUndefined();
    expect(await readFile(target, "utf8")).toBe("PRESERVE");
    if (kind !== "output-link")
      await expect(stat(join(f.root, "events.jsonl"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

it("18 已启用诊断到期后不再写入", async () => {
  const f = await diagnosticRequest({ maxRecords: 100 });
  const originalNow = Date.now;
  try {
    const diagnostic = createLocalReceiveDiagnostic(true);
    diagnostic.record(f.scope, { stage: "native", outcome: "received" });
    const file = join(f.root, "events.jsonl");
    await vi.waitFor(async () => expect((await readFile(file, "utf8")).trim()).not.toBe(""));
    const before = await readFile(file, "utf8");
    vi.spyOn(Date, "now").mockReturnValue(originalNow() + 120_000);
    diagnostic.record(f.scope, { stage: "parse", outcome: "parsed" });
    await diagnostic.dispose();
    expect(await readFile(file, "utf8")).toBe(before);
  } finally {
    vi.restoreAllMocks();
    await rm(f.root, { recursive: true, force: true });
  }
});
