import { expect, it } from "vitest";
import { collaborationReplyIntentSchema, collaborationSaveSchema } from "./contract.js";
const selection = {
  provider: "feishu",
  chatId: "oc_demo",
  expectedRevision: 0,
  enabled: true,
  pmBotId: "pm",
  executors: [{ botId: "app", duty: "APP development" }],
  authorizedUserId: "known-user",
  workspaceId: "known-project",
};
it("共享设置协议接受选项并拒绝调用方注入平台身份", () => {
  expect(collaborationSaveSchema.parse(selection).pmBotId).toBe("pm");
  expect(collaborationSaveSchema.safeParse({ ...selection, openId: "ou_injected" }).success).toBe(
    false,
  );
});
it("共享设置协议拒绝空职责与无效版本", () => {
  expect(collaborationSaveSchema.safeParse({ ...selection, expectedRevision: -1 }).success).toBe(
    false,
  );
  expect(
    collaborationSaveSchema.safeParse({ ...selection, executors: [{ botId: "app", duty: "  " }] })
      .success,
  ).toBe(false);
});
it("验收控制只接受 PM 显式空声明，不允许夹带目标或平台身份", () => {
  expect(collaborationReplyIntentSchema.parse({ kind: "accept" })).toEqual({ kind: "accept" });
  expect(
    collaborationReplyIntentSchema.safeParse({ kind: "accept", targetBotId: "app" }).success,
  ).toBe(false);
  expect(
    collaborationReplyIntentSchema.safeParse({ kind: "accept", openId: "ou_injected" }).success,
  ).toBe(false);
});
