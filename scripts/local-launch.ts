#!/usr/bin/env node
import { homedir } from "node:os";
import { localLaunch } from "../packages/desktop/src/main/local-launch/index.js";
import type { LocalLaunchEdition } from "../packages/desktop/src/main/local-launch/contract.js";

async function main() {
  const args = process.argv.slice(2);
  const values: Record<string, string> = {};
  let applicationArguments: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--") {
      applicationArguments = args.slice(i + 1);
      break;
    }
    if (arg === "--help") {
      console.log(
        "local:launch --edition official|local [--home PATH] [--data-root PATH] [--official-app PATH] [--local-app PATH] -- [application arguments]",
      );
      return;
    }
    if (
      !["--edition", "--home", "--data-root", "--official-app", "--local-app"].includes(arg) ||
      !args[i + 1] ||
      args[i + 1]!.startsWith("--")
    )
      throw new Error("Invalid launch arguments; use --help");
    if (values[arg] !== undefined) throw new Error("Duplicate launch option");
    values[arg] = args[++i]!;
  }
  const edition = values["--edition"];
  if (edition !== "official" && edition !== "local")
    throw new Error("Select --edition official or local");
  const result = await localLaunch.run({
    edition: edition as LocalLaunchEdition,
    home: values["--home"] ?? homedir(),
    dataRoot: values["--data-root"],
    applications: {
      official: values["--official-app"] ?? "/Applications/ZCode.app",
      local: values["--local-app"] ?? "/Applications/ZCode Local.app",
    },
    applicationArguments,
  });
  console.log(JSON.stringify(result));
  if (result.kind === "blocked")
    console.error(
      result.reason === "data-root-mismatch"
        ? "设置的数据目录与本次选择不一致，请用 --data-root 显式指定；所选应用未启动。"
        : result.reason === "occupied"
          ? "另一版本仍占用业务数据，请完全退出后重试；所选应用未启动。"
          : "启动状态未确认，拒绝接管；请先核对原应用与启动入口状态。",
    );
  if (result.kind === "unconfirmed")
    console.error("应用已退出，但子进程状态未确认；占用记录保留，禁止启动另一版。");
  process.exitCode =
    result.kind === "blocked" ? 2 : result.kind === "unconfirmed" ? 3 : (result.code ?? 1);
}
main().catch(() => {
  console.error(
    "Controlled launch failed; check application paths, identity and local permissions.",
  );
  process.exitCode = 1;
});
