/**
 * bot-collaboration-settings 模块清单（architecture-governance managed 模块）。
 * 层：ui。修改 requires 时同步更新 architecture-policy.yaml（检查器会校验两者一致）。
 */
export const botCollaborationSettingsModule = {
  id: "bot-collaboration-settings",
  requires: ["ui", "services", "shared"],
  provides: ["bot-collaboration-settings"],
  publicEntrypoints: ["index.tsx", "contract.ts"],
} as const;
