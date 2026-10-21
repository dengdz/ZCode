import { z } from "zod";
import { collaborationScopeSchema, collaborationConfigSchema } from "@zcode/shared";

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
    replyIntent: z.enum(["silent", "visible"]).optional(),
    silentCalls: z.array(z.string()).optional(),
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
          })
          .strict(),
      )
      .default([]),
    inputs: z.array(inputSchema).default([]),
    handoffs: z.array(handoffSchema).default([]),
    admissions: z
      .array(
        collaborationScopeSchema
          .extend({ id: z.string(), ownerPid: z.number().int().positive() })
          .strict(),
      )
      .default([]),
  })
  .strict();
export type Ledger = z.infer<typeof ledgerSchema>;
