import { CoreErrorType, createCoreError, isCoreError } from "@zcode/contracts";
import { collaborationReplyIntentSchema } from "@zcode/shared";
import type { RuntimeInputValidationIssue } from "../input-normalization.js";
import { createInitialInputValidationModelContent } from "../input-validation-model-content.js";
import { validateJsonSchemaValue } from "../json-schema.js";
import type { ToolEntry } from "../types.js";

const INITIAL_INPUT_VALIDATION_MODEL_CONTENT_KEY = "initialInputValidationModelContent";

/** 原生协作工具的参数错误不等于权限撤销；只分类拒绝，不裁字段或降级发送。 */
export function localReadOnlyCollaborationInputError(
  input: unknown,
  entry: ToolEntry,
): Error | undefined {
  if (
    entry.metadata.name !== "ReplyToChannel" ||
    entry.metadata.mcpPresentation ||
    !input ||
    typeof input !== "object"
  )
    return undefined;
  const intent = (input as Record<string, unknown>).collaboration;
  if (intent === undefined || collaborationReplyIntentSchema.safeParse(intent).success)
    return undefined;
  return createCoreError(
    CoreErrorType.ToolExecutionFailed,
    "Invalid Local collaboration arguments. report/final/accept/silent/stop require only {kind}; omit targetBotId and requiredDuty. Only dispatch/question may include configured targetBotId and requiredDuty. Correct the arguments and submit a new call; nothing was sent.",
    {
      context: { toolName: entry.metadata.name, ruleId: "local.readOnly.arguments" },
      recoverable: true,
    },
  );
}

export function validateOutput(output: unknown, entry: ToolEntry): void {
  const runtimeSchemaValidation = validateRuntimeSchema(output, entry.runtimeOutputSchema);
  if (runtimeSchemaValidation === true) return;
  if (Array.isArray(runtimeSchemaValidation)) {
    throw createCoreError(
      CoreErrorType.ToolExecutionFailed,
      "Tool output failed runtimeOutputSchema validation",
      {
        context: {
          errors: runtimeSchemaValidation.slice(0, 20),
          toolName: entry.metadata.name,
        },
        recoverable: false,
      },
    );
  }

  const validation = validateJsonSchemaValue(output, entry.outputSchema);
  if (validation.valid) return;

  throw createCoreError(
    CoreErrorType.ToolExecutionFailed,
    "Tool output failed outputSchema validation",
    {
      context: {
        errors: validation.errors.slice(0, 20),
        toolName: entry.metadata.name,
      },
      recoverable: false,
    },
  );
}

function validateRuntimeSchema(output: unknown, schema: unknown): true | string[] | undefined {
  if (!isSafeParseSchema(schema)) return undefined;
  const parsed = schema.safeParse(output);
  if (parsed.success) return true;
  return parsed.error.issues.map((issue) => issue.message);
}

function isSafeParseSchema(schema: unknown): schema is {
  safeParse: (
    value: unknown,
  ) =>
    | { success: true; data: unknown }
    | { success: false; error: { issues: Array<{ message: string }> } };
} {
  return (
    typeof schema === "object" &&
    schema !== null &&
    "safeParse" in schema &&
    typeof (schema as { safeParse?: unknown }).safeParse === "function"
  );
}

export function validateInput(input: unknown, entry: ToolEntry): Error | undefined {
  const validation = validateJsonSchemaValue(input, entry.inputSchema);
  if (validation.valid) return undefined;

  return createInputValidationError(entry, validation.errors);
}

export function validateInitialModelToolInput(
  input: unknown,
  entry: ToolEntry,
  runtimeValidationIssues?: readonly RuntimeInputValidationIssue[],
): Error | undefined {
  const validation = validateJsonSchemaValue(input, entry.inputSchema);
  if (validation.valid) return undefined;

  // 模型原始参数的首次 schema 失败需要把具体问题回传给模型；Hook 或权限
  // 修改后的输入属于不同生命周期，不能复用这段 provider-visible 内容。
  const modelContent = createInitialInputValidationModelContent(
    entry,
    validation.issues,
    runtimeValidationIssues,
  );
  return createInputValidationError(entry, validation.errors, modelContent);
}

export function getInitialInputValidationModelContent(error: Error): string | undefined {
  if (!isCoreError(error) || error.type !== CoreErrorType.ToolExecutionFailed) {
    return undefined;
  }
  const modelContent = error.context?.[INITIAL_INPUT_VALIDATION_MODEL_CONTENT_KEY];
  return typeof modelContent === "string" ? modelContent : undefined;
}

function createInputValidationError(
  entry: ToolEntry,
  errors: string[],
  modelContent?: string,
): Error {
  return createCoreError(
    CoreErrorType.ToolExecutionFailed,
    "Tool input failed inputSchema validation",
    {
      context: {
        errors: errors.slice(0, 20),
        toolName: entry.metadata.name,
        ...(modelContent === undefined
          ? {}
          : { [INITIAL_INPUT_VALIDATION_MODEL_CONTENT_KEY]: modelContent }),
      },
      recoverable: true,
    },
  );
}
