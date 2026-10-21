import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock("../scripts/build-metadata.mjs");
});

async function loadLocalConfigWithVersion(appVersion: string) {
  vi.stubEnv("ZCODE_ENV", "production");
  vi.stubEnv("ZCODE_LOCAL_IDENTITY", "1");
  vi.stubEnv("ZCODE_PREVIEW_IDENTITY", "0");
  vi.doMock("../scripts/build-metadata.mjs", () => ({
    getBuildMetadata: () => ({ appVersion }),
  }));
  return (await import("../electron-builder.config.js")).default;
}

it.each(["3.16.2", "3.16.2-local.0", "3.16.2-local.1000", "invalid"])(
  "Local 拒绝无法映射的版本 %s",
  async (version) => {
    await expect(loadLocalConfigWithVersion(version)).rejects.toThrow(/N between 1 and 999/);
  },
);

it("Local 修订上界 999 仍可映射为独立三段数字版本", async () => {
  const config = await loadLocalConfigWithVersion("3.16.2-local.999");
  expect(config.mac?.bundleVersion).toBe("3.16.2999");
  expect(config.extraMetadata?.version).toBe("3.16.2-local.999");
});

it("Local macOS 候选使用独立包身份和 ad-hoc 签名，保留正常系统保护", async () => {
  vi.stubEnv("ZCODE_ENV", "production");
  vi.stubEnv("ZCODE_LOCAL_IDENTITY", "1");
  vi.stubEnv("ZCODE_PREVIEW_IDENTITY", "0");
  vi.stubEnv("ZCODE_TARGET_OS", "darwin");
  const { default: config } = await import("../electron-builder.config.js");

  expect(config.appId).toBe("dev.zcode.app.local");
  expect(config.productName).toBe("ZCode Local");
  expect(config.mac?.bundleShortVersion).toBe("3.16.2");
  expect(config.mac?.bundleVersion).toBe("3.16.2001");
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
