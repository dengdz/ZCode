import { collaborationSaveSchema, type CollaborationSave } from "./contract.js";
/** 调用方只选择已有选项，平台身份由服务填入。 */
export function validateCollaborationSelection(input: CollaborationSave) {
  return collaborationSaveSchema.parse(input);
}
