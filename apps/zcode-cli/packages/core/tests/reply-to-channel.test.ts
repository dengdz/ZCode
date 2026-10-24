import { describe, expect, it, vi } from "vitest";
import { createToolExecutor } from "../src/tool/executor.js";
import { createToolRegistry } from "../src/tool/registry.js";
import { PermissionService } from "../src/permission/service.js";
import {
  replyToChannelHandler,
  replyToChannelToolEntry,
} from "../src/tool/handlers/reply-to-channel.js";
import type { ToolExecutionContext } from "../src/tool/types.js";

function fixture() {
  const node = {
    type: "channelMention",
    refId: "m1",
    name: "Ryan Bot",
    targetId: "ou_target",
    idType: "open_id",
    entityType: "unknown",
    channel: "feishu",
  };
  const source = {
    botId: "bot",
    appId: "app",
    provider: "feishu",
    chatId: "oc_group",
    messageId: "om_input",
    senderId: "ou_sender",
    senderName: "Sender",
    authorizationId: "auth",
    contentParts: [node],
  };
  const user = {
    info: {
      id: "user",
      role: "user",
      metadata: { conversationInputIntent: { sourceCommandId: "input", botGroupSource: source } },
    },
    parts: [],
  };
  const assistant = {
    info: { id: "assistant", role: "assistant", parentID: "user" },
    parts: [{ type: "tool", callID: "call" }],
  };
  const messages = [
    user,
    assistant,
    { info: { id: "queued", role: "user", metadata: {} }, parts: [] },
  ];
  const reply = vi.fn(async () => ({
    status: "sent",
    deliveryId: "delivery",
    providerMessageId: "om_sent",
  }));
  const abort = new AbortController();
  const context = {
    sessionId: "task",
    toolCallId: "call",
    abortSignal: abort.signal,
    sessionStore: { messages: async () => messages },
    topicResourcePort: { reply },
  } as unknown as ToolExecutionContext;
  return { context, reply, abort, user, assistant };
}
const input = {
  parts: [
    { type: "mention", refId: "m1" },
    { type: "text", text: " 请确认" },
  ],
};
describe("ReplyToChannel", () => {
  it.each(["report", "final"] as const)(
    "Local 只读 executor 允许真实渠道 %s 工具，拒绝普通额外发送",
    async (kind) => {
      const f = fixture();
      const registry = createToolRegistry();
      registry.register(replyToChannelToolEntry);
      const executor = createToolExecutor({
        registry,
        sessionId: f.context.sessionId,
        mode: "yolo",
        permissionService: new PermissionService(),
        emitEvent: async () => {},
        sessionStore: { ...f.context.sessionStore!, getSession: async () => null },
        topicResourcePort: f.context.topicResourcePort,
        getLocalCollaboration: () => ({
          requirementId: "synthetic",
          role: kind === "report" ? "executor" : "PM",
          readOnly: true,
        }),
      });
      const result = await executor.execute({
        id: "call",
        name: "ReplyToChannel",
        input: {
          parts: [{ type: "text", text: "Evidence" }],
          collaboration: { kind },
        },
      });
      expect(result.success, result.error?.message).toBe(true);
      expect(f.reply).toHaveBeenCalledOnce();
      const rejected = await executor.execute({ id: "call", name: "ReplyToChannel", input });
      expect(rejected.success).toBe(false);
      expect(rejected.error?.message).toContain("Local read-only");
      expect(f.reply).toHaveBeenCalledOnce();
    },
  );
  it("returns a strict blocked result without claiming delivery or rewriting duty", async () => {
    const f = fixture();
    const blocked = {
      status: "blocked",
      reason: "role_mismatch",
      message: "Nothing sent. Select an APP executor.",
      requiredDuty: "APP",
      actualDuty: "Product",
      targetBotId: "product",
    };
    f.reply.mockResolvedValue(blocked as never);
    const result = await replyToChannelHandler(
      {
        parts: [{ type: "text", text: "Build APP" }],
        collaboration: { kind: "dispatch", targetBotId: "product", requiredDuty: "APP" },
      },
      f.context,
    );
    expect(result).toEqual(blocked);
    expect(replyToChannelToolEntry.runtimeOutputSchema!.parse(result)).toEqual(blocked);
    expect(f.reply).toHaveBeenCalledTimes(1);
    expect(f.reply.mock.calls[0]?.[0]).toMatchObject({
      collaboration: { requiredDuty: "APP", targetBotId: "product" },
    });
    expect(() =>
      replyToChannelToolEntry.runtimeOutputSchema!.parse({
        ...blocked,
        providerMessageId: "forged",
      }),
    ).toThrow();
  });
  it("forwards explicit Local intent while keeping the executing input as authority", async () => {
    const f = fixture();
    await replyToChannelHandler(
      {
        parts: [{ type: "text", text: "Implement the feature" }],
        collaboration: { kind: "dispatch", targetBotId: "app", requiredDuty: "APP" },
      },
      f.context,
    );
    expect(f.reply.mock.calls[0]?.[0]).toMatchObject({
      inputId: "input",
      collaboration: { kind: "dispatch", targetBotId: "app", requiredDuty: "APP" },
    });
    await expect(
      replyToChannelHandler(
        {
          parts: [{ type: "text", text: "Forged" }],
          collaboration: { kind: "final", originalUserId: "forged" },
        },
        f.context,
      ),
    ).rejects.toThrow();
  });
  it("forwards typed names and preserves clarification without claiming delivery", async () => {
    const f = fixture();
    const clarification = {
      status: "needs_clarification",
      unresolved: [
        {
          name: "Alex",
          reason: "ambiguous",
          candidates: [{ ref: "opaque", name: "Alex", label: "Alex (member)", kind: "user" }],
          truncated: false,
        },
        { name: "Missing", reason: "not_found", candidates: [], truncated: false },
      ],
    };
    f.reply.mockResolvedValue(clarification as never);
    const parts = [
      { type: "mentionName", name: "Alex" },
      { type: "mentionName", name: "Missing" },
    ];
    expect(await replyToChannelHandler({ parts }, f.context)).toEqual(clarification);
    expect(f.reply.mock.calls[0]?.[0]).toMatchObject({ parts });
  });
  it("uses executing assistant parent rather than a newer queued user input", async () => {
    const { context, reply } = fixture();
    expect(await replyToChannelHandler(input, context)).toMatchObject({
      status: "sent",
      providerMessageId: "om_sent",
    });
    expect(reply).toHaveBeenCalledWith(
      {
        taskId: "task",
        inputId: "input",
        toolCallId: "call",
        parts: input.parts,
      },
      expect.objectContaining({ signal: context.abortSignal }),
    );
  });
  it.each(["cancelled", "missingCall", "missingSource"])(
    "rejects %s before sending",
    async (kind) => {
      const f = fixture();
      if (kind === "cancelled") f.abort.abort();
      if (kind === "missingCall") f.assistant.parts = [];
      if (kind === "missingSource") f.user.info.metadata = {} as typeof f.user.info.metadata;
      await expect(replyToChannelHandler(input, f.context)).rejects.toThrow();
      expect(f.reply).not.toHaveBeenCalled();
    },
  );
  it("forwards desktop follow-up without botGroupSource for Host binding resolution", async () => {
    const f = fixture();
    f.user.info.metadata = {
      conversationInputIntent: { sourceCommandId: "desktop-input" },
    } as typeof f.user.info.metadata;
    await expect(replyToChannelHandler(input, f.context)).resolves.toMatchObject({
      status: "sent",
    });
    expect(f.reply).toHaveBeenCalledWith(
      { taskId: "task", inputId: "desktop-input", toolCallId: "call", parts: input.parts },
      expect.anything(),
    );
  });
  it("preserves unknown receipt status without claiming success", async () => {
    const f = fixture();
    f.reply.mockResolvedValue({ status: "unknown", deliveryId: "delivery", providerMessageId: "" });
    expect(await replyToChannelHandler(input, f.context)).toMatchObject({ status: "unknown" });
  });
});

it("Local silent is an input-bound control result, not a delivery or completion receipt", async () => {
  const f = fixture();
  f.reply.mockResolvedValue({ status: "silent" } as never);
  const result = await replyToChannelHandler(
    { parts: [{ type: "text", text: "" }], collaboration: { kind: "silent" } },
    f.context,
  );
  expect(result).toEqual({ status: "silent" });
  expect(f.reply.mock.calls[0]?.[0]).toMatchObject({
    taskId: "task",
    inputId: "input",
    toolCallId: "call",
    collaboration: { kind: "silent" },
  });
  expect(replyToChannelToolEntry.runtimeOutputSchema!.parse(result)).toEqual({ status: "silent" });
  expect(() =>
    replyToChannelToolEntry.runtimeOutputSchema!.parse({ status: "silent", deliveryId: "forged" }),
  ).toThrow();
  await expect(
    replyToChannelHandler(
      {
        parts: [{ type: "text", text: "" }],
        collaboration: { kind: "silent", targetBotId: "app" },
      },
      f.context,
    ),
  ).rejects.toThrow();
  const properties = replyToChannelToolEntry.inputSchema!.properties as Record<
    string,
    { properties: Record<string, { enum: string[] }> }
  >;
  expect(properties.collaboration!.properties.kind!.enum).toContain("silent");
});

it("Local acceptance is an input-bound PM control result with no delivery receipt", async () => {
  const f = fixture();
  f.reply.mockResolvedValue({ status: "acceptance_recorded" } as never);
  const result = await replyToChannelHandler(
    { parts: [{ type: "text", text: "" }], collaboration: { kind: "accept" } },
    f.context,
  );
  expect(result).toEqual({ status: "acceptance_recorded" });
  expect(f.reply.mock.calls[0]?.[0]).toMatchObject({
    taskId: "task",
    inputId: "input",
    toolCallId: "call",
    collaboration: { kind: "accept" },
  });
  expect(replyToChannelToolEntry.runtimeOutputSchema!.parse(result)).toEqual({
    status: "acceptance_recorded",
  });
  expect(() =>
    replyToChannelToolEntry.runtimeOutputSchema!.parse({
      status: "acceptance_recorded",
      deliveryId: "forged",
    }),
  ).toThrow();
  expect(() =>
    replyToChannelToolEntry.runtimeInputSchema!.parse({
      parts: [{ type: "text", text: "" }],
      collaboration: { kind: "accept", targetBotId: "app" },
    }),
  ).toThrow();
  const properties = replyToChannelToolEntry.inputSchema!.properties as Record<
    string,
    { properties: Record<string, { enum: string[] }> }
  >;
  expect(properties.collaboration!.properties.kind!.enum).toContain("accept");
});

it("candidate selection retains original task and duty and never claims delivery", async () => {
  const f = fixture();
  const waiting = { status: "awaiting_selection", selectionId: "opaque-card", state: "awaiting" };
  f.reply.mockResolvedValue(waiting as never);
  const result = await replyToChannelHandler(
    {
      parts: [{ type: "text", text: "Original work" }],
      collaboration: { kind: "dispatch", requiredDuty: "APP" },
    },
    f.context,
  );
  expect(result).toEqual(waiting);
  expect(f.reply.mock.calls[0]?.[0]).toMatchObject({
    taskId: "task",
    inputId: "input",
    collaboration: { kind: "dispatch", requiredDuty: "APP" },
  });
  expect(replyToChannelToolEntry.runtimeOutputSchema!.parse(result)).toEqual(waiting);
  expect(() =>
    replyToChannelToolEntry.runtimeOutputSchema!.parse({ ...waiting, deliveryId: "forged" }),
  ).toThrow();
  expect(replyToChannelToolEntry.metadata.description).toContain(
    "awaiting_selection is NOT delivery",
  );
});

it.each(["stopped", "stopping", "unavailable"])(
  "Local stop %s is bound to the executing human input and is never a delivery receipt",
  async (state) => {
    const f = fixture();
    f.reply.mockResolvedValue({ status: "stop_requested", state } as never);
    const result = await replyToChannelHandler(
      { parts: [{ type: "text", text: "" }], collaboration: { kind: "stop" } },
      f.context,
    );
    expect(result).toEqual({ status: "stop_requested", state });
    expect(f.reply.mock.calls[0]?.[0]).toMatchObject({
      taskId: "task",
      inputId: "input",
      toolCallId: "call",
      collaboration: { kind: "stop" },
    });
    expect(replyToChannelToolEntry.runtimeOutputSchema!.parse(result)).toEqual({
      status: "stop_requested",
      state,
    });
    expect(() =>
      replyToChannelToolEntry.runtimeOutputSchema!.parse({
        status: "stop_requested",
        state,
        deliveryId: "forged",
      }),
    ).toThrow();
    expect(() =>
      replyToChannelToolEntry.runtimeInputSchema!.parse({
        parts: [{ type: "text", text: "" }],
        collaboration: { kind: "stop", targetBotId: "app" },
      }),
    ).toThrow();
  },
);
