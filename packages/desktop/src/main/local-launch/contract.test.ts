import { mkdtemp, stat, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { LocalLaunchContract } from "./contract.js";
import { localLaunch } from "./index.js";

const port: LocalLaunchContract = localLaunch;
it.skipIf(process.platform !== "darwin")("无效应用在接触业务数据之前拒绝", async () => {
  const root = await mkdtemp(join(tmpdir(), "local-launch-contract-"));
  const home = join(root, "untouched-home");
  await expect(
    port.run({
      edition: "local",
      home,
      applications: {
        official: join(root, "missing-official.app"),
        local: join(root, "missing-local.app"),
      },
    }),
  ).rejects.toMatchObject({ code: "ENOENT" });
  await expect(stat(home)).rejects.toMatchObject({ code: "ENOENT" });
});

it.skipIf(process.platform !== "darwin")("维护接口不解除异常占用或执行文件操作", async () => {
  const home = await mkdtemp(join(tmpdir(), "local-maintenance-contract-"));
  const owner = join(home, ".zcode/local/launch-owner.json");
  const resultFile = join(home, "must-not-write");
  await mkdir(join(home, ".zcode/local"), { recursive: true });
  await writeFile(owner, "unconfirmed owner");
  const result = await port.withMaintenance(
    {
      home,
      applications: { local: join(home, "local.app"), official: join(home, "official.app") },
    },
    async () => writeFile(resultFile, "unsafe operation"),
  );
  expect(result).toEqual({ kind: "blocked", reason: "unconfirmed" });
  await expect(stat(resultFile)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(owner, "utf8")).toBe("unconfirmed owner");
});
