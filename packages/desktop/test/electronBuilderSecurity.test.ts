import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("Local macOS 候选使用独立包身份和 ad-hoc 签名，保留正常系统保护", async () => {
  vi.stubEnv("ZCODE_ENV", "production");
  vi.stubEnv("ZCODE_LOCAL_IDENTITY", "1");
  vi.stubEnv("ZCODE_PREVIEW_IDENTITY", "0");
  vi.stubEnv("ZCODE_TARGET_OS", "darwin");
  const { default: config } = await import("../electron-builder.config.js");

  expect(config.appId).toBe("dev.zcode.app.local");
  expect(config.productName).toBe("ZCode Local");
  expect(config.extraMetadata?.zcodeProductFlavor).toBe("local");
  expect(config.protocols).toEqual([{ name: "ZCode Local", schemes: ["zcode"] }]);
  expect(config.mac?.identity).toBe("-");
  expect(config.mac?.notarize).toBe(false);
  expect(config.mac?.hardenedRuntime).toBe(true);
  expect(config.publish).toBeNull();
});

it("Windows 打包关闭 Node Inspector，保留 Agent 所需的 RunAsNode", async () => {
  vi.stubEnv("ZCODE_TARGET_OS", "win32");
  const { default: config } = await import("../electron-builder.config.js");

  expect(config.electronFuses?.enableNodeCliInspectArguments).toBe(false);
  expect(config.electronFuses?.runAsNode).toBeUndefined();
});

it.each(["darwin", "linux"])("%s 保留现有 fuse 配置", async (platform) => {
  vi.stubEnv("ZCODE_TARGET_OS", platform);
  const { default: config } = await import("../electron-builder.config.js");

  expect(config.electronFuses).toBeUndefined();
});
