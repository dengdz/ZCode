import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect } from "vitest";
import { createSqliteSessionStore } from "@zcode/adapters/storage";
import { zcodeProtocolMethods, type ZCodeProtocolMessage } from "@zcode/shared";
import {
  V4_METHODS,
  conversationTopic,
  reassembleTopicWireFrames,
  routedTopicWireFrameSchema,
  conversationTopicFrameSchema,
  type CommandAck,
} from "@zcode/shared/zcode-protocol-v4";
import { ZCodeProtocolAgentServer } from "../../src/zcode-protocol/server.js";
import { createRegistryBackedTestApp } from "../helpers/registry-backed-test-app.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

export async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "zcode-project-serial-"));
  const store = await createSqliteSessionStore({ dbPath: ":memory:" });
  const started: string[] = [];
  const releases: Array<() => void> = [];
  const apps = new Map<string, Awaited<ReturnType<typeof createRegistryBackedTestApp>>>();
  let closing = false;
  let active = 0;
  let maximumActive = 0;
  const servers: ZCodeProtocolAgentServer[] = [];
  const makeServer = () => {
    const server = new ZCodeProtocolAgentServer({
      cwd: home,
      sessionStore: store,
      projectExecutionDirectory: join(home, "local", "project-execution"),
      createZCodeApp: async (options) => {
        const app = await createRegistryBackedTestApp({
          ...options,
          env: { ZCODE_HOME: home },
          sessionStore: store,
          skipUserConfig: true,
          configuredDefaultModelSelection: { providerId: "zai", modelId: "glm-4.6" },
          runtimeConfig: {
            ...options?.runtimeConfig,
            workingDirectory: options?.runtimeConfig?.workingDirectory ?? home,
            titleGeneration: { enabled: false },
            memory: { enabled: false },
            mcp: { enabled: false },
          },
          modelExecutor: {
            async generateText() {
              if (!closing) {
                active += 1;
                maximumActive = Math.max(maximumActive, active);
                started.push(String(options?.sessionId));
                await new Promise<void>((resolve) => releases.push(resolve));
                active -= 1;
              }
              return {
                finishReason: "stop",
                text: "done",
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
              };
            },
          },
        });
        apps.set(String(app.sessionId), app);
        return app;
      },
    });
    server.setNotificationSink((message) => {
      if (
        "id" in message &&
        message.method === zcodeProtocolMethods.sessionRequestRuntimePreferences
      )
        void server.handleMessage({
          id: message.id,
          result: { memoryEnabled: false, nativeSearchEnhancementsEnabled: false },
        });
    });
    servers.push(server);
    return server;
  };
  cleanups.push(async () => {
    closing = true;
    releases.splice(0).forEach((release) => release());
    for (const server of servers) {
      await server.shutdown();
      server.disposeProjections();
    }
    store.close();
    await rm(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
  });
  let counter = 0;
  const client = (server: ZCodeProtocolAgentServer) => {
    const request = async (message: ZCodeProtocolMessage) => {
      const result = await server.handleMessage(message);
      if (!result || !("result" in result)) throw new Error(JSON.stringify(result));
      return result.result;
    };
    const command = async (
      sessionId: string | null,
      type: string,
      payload: unknown,
      extra: Record<string, unknown> = {},
    ): Promise<CommandAck> => {
      const id = `command-${++counter}`;
      return (await request({
        id,
        method: V4_METHODS.command,
        params: {
          sessionId,
          commandId: id,
          clientId: "synthetic-bot",
          issuedAt: counter,
          type,
          payload,
          ...extra,
        },
      })) as CommandAck;
    };
    const query = async (sessionId: string, commandId: string) =>
      request({
        id: `query-${++counter}`,
        method: V4_METHODS.commandsQuery,
        params: { commands: [{ sessionId, commandId }] },
      });
    const create = async (workspaceId = home) => {
      await mkdir(workspaceId, { recursive: true });
      const ack = await command(null, "createSession", { workspaceId });
      expect(ack.status, JSON.stringify(ack)).toBe("accepted");
      return (ack.result as { sessionId: string }).sessionId;
    };
    const snapshot = async (
      sessionId: string,
      clientMode: "desktop-continuous" | "web-remote-replayable" = "desktop-continuous",
    ) => {
      const id = `subscribe-${++counter}`;
      await request({
        id,
        method: V4_METHODS.conversationSubscribe,
        params: { clientMode, connectionId: id, topic: conversationTopic(sessionId) },
      });
      const assembled = reassembleTopicWireFrames(
        server
          .takePostResponseMessages(id)
          .map((message) => routedTopicWireFrameSchema.parse(message.params)),
        conversationTopicFrameSchema,
      );
      if (assembled.kind !== "complete" || assembled.frame.payload.kind !== "snapshot")
        throw new Error("Expected snapshot");
      return assembled.frame.payload.snapshot;
    };
    return { server, command, create, snapshot, query };
  };
  const first = client(makeServer());
  return {
    ...first,
    otherClient: () => client(makeServer()),
    home,
    started,
    releases,
    apps,
    maximumActive: () => maximumActive,
  };
}
