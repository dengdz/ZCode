import { z } from "zod";
import {
  collaborationScopeSchema,
  collaborationConfigSchema,
  channelReplyHostRequestSchema,
} from "@zcode/shared";

/** Local 文件格式与规范化规则；不拥有执行状态或发送结果。 */
export const proofSchema = z
  .object({
    botId: z.string(),
    appId: z.string(),
    openId: z.string().regex(/^ou_[\w-]+$/),
    ownerOpenId: z.string(),
    unionId: z.string().regex(/^on_[\w-]+$/),
    tenantKey: z.string().min(1),
    name: z.string().min(1),
  })
  .strict();
const challengeSchema = z
  .object({
    botId: z.string(),
    appId: z.string(),
    ownerId: z.string(),
    nonce: z.string(),
    expiresAt: z.number(),
  })
  .strict();
const groupSchema = collaborationScopeSchema
  .extend({
    name: z.string().min(1).optional(),
    config: collaborationConfigSchema.optional(),
    identities: z.array(proofSchema),
    challenges: z.array(challengeSchema),
  })
  .strict();
export const inputSchema = collaborationScopeSchema
  .extend({
    botId: z.string(),
    taskId: z.string(),
    inputId: z.string(),
    workspacePath: z.string(),
    workspaceIdentity: z.string().optional(),
    requirementId: z.string(),
    revision: z.number(),
    replyIntent: z.enum(["silent", "visible", "selection"]).optional(),
    selectionId: z.string().optional(),
    silentCalls: z.array(z.string()).optional(),
    recoveryNoticeIds: z.array(z.string()).optional(),
  })
  .strict();
export const handoffSchema = collaborationScopeSchema
  .extend({
    id: z.string(),
    fromBotId: z.string(),
    toBotId: z.string(),
    requiredDuty: z.string().trim().min(1).max(500).optional(),
    fromTaskId: z.string(),
    fromInputId: z.string(),
    requirementId: z.string(),
    revision: z.number(),
    threadId: z.string().optional(),
  })
  .strict();
export const recipientSelectionSchema = collaborationScopeSchema
  .extend({
    id: z.string(),
    token: z.string(),
    botId: z.string(),
    threadId: z.string().optional(),
    request: channelReplyHostRequestSchema,
    requestHash: z.string(),
    revision: z.number(),
    authorizationId: z.string(),
    expiresAt: z.number(),
    cardClaimed: z.boolean(),
    status: z.enum(["awaiting", "selected", "claimed", "cancelled", "invalidated", "rejected"]),
    selectedIndex: z.number().int().nonnegative().optional(),
    candidates: z
      .array(
        z
          .object({
            botId: z.string().optional(),
            openId: z.string(),
            name: z.string(),
            duty: z.string(),
            kind: z.enum(["bot", "user"]),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
export type RecipientSelection = z.infer<typeof recipientSelectionSchema>;

export const ledgerSchema = z
  .object({
    version: z.literal(1),
    groups: z.array(groupSchema).max(400),
    requirements: z
      .array(
        collaborationScopeSchema
          .extend({
            id: z.string(),
            revision: z.number(),
            unionId: z.string(),
            tenantKey: z.string(),
            name: z.string(),
            stopRequested: z.boolean().optional(),
            stopConfirmed: z.boolean().optional(),
          })
          .strict(),
      )
      .default([]),
    inputs: z.array(inputSchema).default([]),
    handoffs: z.array(handoffSchema).default([]),
    stopRequests: z
      .array(
        collaborationScopeSchema
          .extend({
            id: z.string(),
            requirementId: z.string(),
            revision: z.number().int().positive(),
            botId: z.string(),
            threadId: z.string().optional(),
            taskId: z.string(),
            inputId: z.string(),
            authorizationId: z.string(),
            messageId: z.string(),
            ownerId: z.string(),
            deliveryIds: z.array(z.string()),
          })
          .strict(),
      )
      .default([]),
    selections: z.array(recipientSelectionSchema).default([]),
    admissions: z
      .array(
        collaborationScopeSchema
          .extend({
            id: z.string(),
            ownerPid: z.number().int().positive(),
            botId: z.string().optional(),
            messageId: z.string().optional(),
            threadId: z.string().optional(),
            revision: z.number().int().positive().optional(),
            inputId: z.string().optional(),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();
export type Ledger = z.infer<typeof ledgerSchema>;
