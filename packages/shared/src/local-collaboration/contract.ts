import { z } from "zod";
const id = z.string().trim().min(1).max(250);
const duty = z.string().trim().min(1).max(500);
export const collaborationReplyIntentSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("dispatch"), targetBotId: id, requiredDuty: duty.optional() })
    .strict(),
  z.object({ kind: z.literal("report") }).strict(),
  z
    .object({
      kind: z.literal("question"),
      targetBotId: id.optional(),
      requiredDuty: duty.optional(),
    })
    .strict(),
  z.object({ kind: z.literal("final") }).strict(),
  z.object({ kind: z.literal("silent") }).strict(),
]);
export const collaborationScopeSchema = z
  .object({ provider: z.enum(["feishu", "lark"]), chatId: id })
  .strict();
export type CollaborationScope = z.infer<typeof collaborationScopeSchema>;
export const collaborationWorkspaceSchema = z
  .object({
    id,
    label: id,
    projectId: id,
    hostId: z.literal("local"),
    workspacePath: id,
    workspaceIdentity: id.optional(),
  })
  .strict();
export const collaborationBotSchema = z
  .object({ botId: id, appId: id, openId: z.string().regex(/^ou_[\w-]+$/), ownerOpenId: id })
  .strict();
export const collaborationConfigSchema = collaborationScopeSchema
  .extend({
    revision: z.number().int().positive(),
    enabled: z.boolean(),
    pm: collaborationBotSchema,
    executors: z
      .array(collaborationBotSchema.extend({ duty: z.string().trim().min(1).max(500) }))
      .min(1)
      .max(50),
    authorizedUser: z.object({ unionId: id, tenantKey: id }).strict(),
    workspace: collaborationWorkspaceSchema,
  })
  .strict();
export type CollaborationConfig = z.infer<typeof collaborationConfigSchema>;
/** 仅作可信授权用户的选项 key；不能用昵称或应用内 open_id 代替。 */
export function collaborationUserId(user: CollaborationConfig["authorizedUser"]): string {
  return JSON.stringify([user.tenantKey, user.unionId]);
}
/** 界面仅提交已知选项的 ID；平台身份只能由可信 Provider 入站填入。 */
export const collaborationSaveSchema = collaborationScopeSchema
  .extend({
    expectedRevision: z.number().int().nonnegative(),
    enabled: z.boolean(),
    pmBotId: id,
    executors: z
      .array(z.object({ botId: id, duty: z.string().trim().min(1).max(500) }).strict())
      .min(1)
      .max(50),
    authorizedUserId: id,
    workspaceId: id,
  })
  .strict();
export type CollaborationSave = z.infer<typeof collaborationSaveSchema>;
export const collaborationVerificationSchema = collaborationScopeSchema
  .extend({ botId: id })
  .strict();
export const collaborationSnapshotSchema = z
  .object({
    groups: z.array(
      collaborationScopeSchema
        .extend({
          name: id,
          config: collaborationConfigSchema.nullable(),
          busy: z.boolean(),
          bots: z.array(
            z.object({ id, name: id, verified: z.boolean(), connected: z.boolean() }).strict(),
          ),
          users: z.array(z.object({ id, name: id }).strict()),
          workspaces: z.array(collaborationWorkspaceSchema),
        })
        .strict(),
    ),
  })
  .strict();
export type CollaborationSnapshot = z.infer<typeof collaborationSnapshotSchema>;
export type CollaborationVerification = z.infer<typeof collaborationVerificationSchema>;
export interface CollaborationChallenge {
  command: string;
  expiresAt: number;
}

/** 校验未通过而非外部投递失败；此结果没有消息或 deliveryId。 */
export const collaborationBlockedResultSchema = z
  .object({
    status: z.literal("blocked"),
    reason: z.enum([
      "required_duty_missing",
      "role_mismatch",
      "recipient_mismatch",
      "reference_unavailable",
    ]),
    message: z.string().min(1).max(1000),
    targetBotId: id.optional(),
    requiredDuty: duty.optional(),
    actualDuty: duty.optional(),
  })
  .strict();
export type CollaborationBlockedResult = z.infer<typeof collaborationBlockedResultSchema>;
