import { constants } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import { createHmac } from "node:crypto";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import {
  receiveDiagnosticOutcomes,
  receiveDiagnosticStages,
  type LocalReceiveDiagnostic,
  type ReceiveDiagnosticFacts,
} from "./contract.js";

const MAX_RECORDS = 200;
const MAX_DURATION_MS = 30 * 60_000;
const requestSchema = z
  .object({
    schema: z.literal(1),
    botId: z.string().min(1).max(256),
    chatId: z.string().min(1).max(256),
    salt: z.string().regex(/^[a-f0-9]{64}$/u),
    expiresAt: z.number().int().positive(),
    maxRecords: z.number().int().min(1).max(MAX_RECORDS),
  })
  .strict();

function sanitizeFacts(value: ReceiveDiagnosticFacts | undefined): ReceiveDiagnosticFacts {
  const facts: ReceiveDiagnosticFacts = {};
  if (!value || typeof value !== "object") return facts;
  for (const key of [
    "senderIdPresent",
    "threadPresent",
    "botIdentityResolved",
    "selfSender",
    "nativeMentionMatched",
    "ignoredInteraction",
  ] as const) {
    if (typeof value[key] === "boolean") facts[key] = value[key];
  }
  for (const key of ["mentionCount", "parsedCount", "guardCount"] as const) {
    const count = value[key];
    if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0)
      facts[key] = Math.min(count, key === "guardCount" ? 5 : 100);
  }
  if (["user", "bot", "app", "other"].includes(value.senderType ?? ""))
    facts.senderType = value.senderType;
  if (["text", "post", "interactive", "other"].includes(value.messageType ?? ""))
    facts.messageType = value.messageType;
  return facts;
}

/** 显式请求只读取一次；不能验证 POSIX 私有权限的平台保持关闭。 */
export function createLocalReceiveDiagnostic(localEnabled: boolean): LocalReceiveDiagnostic {
  const file = localEnabled ? process.env.ZCODE_LOCAL_RECEIVE_DIAGNOSTIC_FILE : undefined;
  if (!file || !isAbsolute(file) || typeof process.getuid !== "function")
    return { record() {}, async dispose() {} };
  const uid = process.getuid();
  const directory = dirname(file);
  const ready = (async () => {
    const folder = await lstat(directory);
    if (
      !folder.isDirectory() ||
      folder.uid !== uid ||
      (folder.mode & 0o777) !== 0o700 ||
      (await realpath(directory)) !== resolve(directory)
    )
      return undefined;
    // 私有请求仍可能误选 FIFO；非阻塞打开后先验普通文件，不能卡住 Host 的退出收口。
    const input = await open(
      file,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const info = await input.stat();
      if (
        !info.isFile() ||
        info.uid !== uid ||
        info.nlink !== 1 ||
        (info.mode & 0o777) !== 0o600 ||
        info.size > 4096
      )
        return undefined;
      const text = await input.readFile("utf8");
      if (Buffer.byteLength(text) > 4096) return undefined;
      const request = requestSchema.parse(JSON.parse(text));
      const remaining = request.expiresAt - Date.now();
      if (remaining <= 0 || remaining > MAX_DURATION_MS) return undefined;
      return { ...request, monotonicDeadline: performance.now() + remaining };
    } finally {
      await input.close();
    }
  })().catch(() => undefined);
  let output: FileHandle | undefined;
  let pending = 0;
  let count = 0;
  let stopped = false;
  let failed = false;
  let writes = Promise.resolve();
  const close = async () => {
    const handle = output;
    output = undefined;
    await handle?.close().catch(() => undefined);
  };
  const expired = (request: NonNullable<Awaited<typeof ready>>) =>
    Date.now() >= request.expiresAt || performance.now() >= request.monotonicDeadline;
  return {
    record(scope, observation) {
      // 诊断错误不能改变原始回调结果；只接受固定枚举及主动挑选的事实，绝不序列化入参。
      try {
        if (
          stopped ||
          failed ||
          pending >= MAX_RECORDS ||
          !receiveDiagnosticStages.includes(observation.stage) ||
          !receiveDiagnosticOutcomes.includes(observation.outcome)
        )
          return;
        const stage = observation.stage;
        const outcome = observation.outcome;
        const connection = stage === "connection";
        if (connection && outcome !== "ready") return;
        // 连接记录不属于任何群消息，不能借缺失 chatId 带出其他 scope 的事实或摘要。
        const facts = connection ? {} : sanitizeFacts(observation.facts);
        const { provider, botId, chatId } = scope;
        const messageId = connection ? undefined : scope.messageId;
        const senderId = connection ? undefined : scope.senderId;
        const at = Date.now();
        pending++;
        writes = writes
          .then(async () => {
            const request = await ready;
            if (
              failed ||
              !request ||
              !["feishu", "lark"].includes(provider ?? "") ||
              botId !== request.botId ||
              (chatId !== request.chatId && !(stage === "connection" && chatId === undefined)) ||
              expired(request) ||
              count >= request.maxRecords
            )
              return;
            if (!output) {
              // 独占领取和输出都不跟随已有路径；其他 Host/重建实例不得续写旧诊断。
              const claim = await open(join(directory, "claimed"), "wx", 0o600);
              await claim.close();
              output = await open(join(directory, "events.jsonl"), "wx", 0o600);
            }
            if (expired(request)) return;
            const eventRef = createHmac("sha256", Buffer.from(request.salt, "hex"))
              .update(
                "message\0" +
                  (typeof messageId === "string" && messageId.length <= 1024 ? messageId : ""),
              )
              .digest("hex")
              .slice(0, 32);
            const senderRef =
              typeof senderId === "string" && senderId.length <= 1024
                ? createHmac("sha256", Buffer.from(request.salt, "hex"))
                    .update("sender\0" + senderId)
                    .digest("hex")
                    .slice(0, 32)
                : undefined;
            await output.writeFile(
              JSON.stringify({
                schema: 1,
                at,
                sequence: ++count,
                eventRef,
                senderRef,
                stage,
                outcome,
                facts,
              }) + "\n",
            );
          })
          .catch(async () => {
            failed = true;
            await close();
          })
          .finally(() => {
            pending--;
          });
      } catch {
        failed = true;
      }
    },
    async dispose() {
      stopped = true;
      await ready;
      await writes;
      await close();
    },
  };
}
