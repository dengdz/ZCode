import { mkdtemp, stat } from "node:fs/promises";
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
