import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { verifyArtifacts } from "./artifacts.mjs";
import { digest, cleanSource, json } from "./checks.mjs";
import { run, git, fail } from "./process.mjs";

export async function build(report, output) {
  if (process.platform !== "darwin" || !["arm64", "x64"].includes(process.arch))
    fail("unsupported-build-host");
  const mise = await readFile("mise.toml", "utf8");
  const node = /^node\s*=\s*"([^"]+)"/m.exec(mise)?.[1];
  const pnpm = /^pnpm\s*=\s*"([^"]+)"/m.exec(mise)?.[1];
  if (
    !node ||
    !pnpm ||
    (await json("package.json")).packageManager !== `pnpm@${pnpm}` ||
    process.versions.node !== node ||
    (await run("pnpm", ["--version"])) !== pnpm
  )
    fail("toolchain-mismatch");
  // 隔离 HOME 会改变 pnpm 默认 store，导致非交互安装尝试清空已有 node_modules；固定复用声明工具链当前使用的依赖缓存，不改全局配置。
  const store = await run("pnpm", ["store", "path", "--silent"]);
  if (!isAbsolute(store)) fail("dependency-store-invalid");
  const home = join(output, "home");
  const data = join(output, "data");
  const artifacts = join(output, "artifacts");
  const logs = join(output, "logs");
  for (const dir of [home, data, artifacts, logs]) await mkdir(dir, { mode: 0o700 });
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    USERPROFILE: home,
    TMPDIR: process.env.TMPDIR,
    LANG: process.env.LANG ?? "en_US.UTF-8",
    ZCODE_DATA_BASE_DIR: data,
    ZCODE_ENV: "production",
    ZCODE_LOCAL_IDENTITY: "1",
    ZCODE_PREVIEW_IDENTITY: "0",
    ZCODE_DESKTOP_DIST_DIR: artifacts,
    npm_config_store_dir: store,
    ARCHITECTURE_BASE: "upstream/main",
  };
  const stages = [
    ["install", "pnpm", ["install", "--frozen-lockfile", "--ignore-scripts", "--store-dir", store]],
    ["electron", process.execPath, ["node_modules/electron/install.js"]],
    ["native", "pnpm", ["--filter", "@zcode/desktop", "postinstall"]],
    ["typecheck", "pnpm", ["typecheck"]],
    ["lint", "pnpm", ["lint"]],
    ["architecture", "pnpm", ["architecture:check", "--changed", "--base", "upstream/main"]],
    ["maintenance-tests", "pnpm", ["test:local-maintenance"]],
    ["affected", "pnpm", ["test:unit:affected", "--base", report.officialBase]],
    ["prepare", "pnpm", ["prepare:desktop-runtime"]],
    ["desktop", "pnpm", ["--filter", "@zcode/desktop", "build:no-runtime-assets"]],
    [
      "bundle",
      "pnpm",
      [
        "bundle:desktop",
        "--",
        "--os",
        "mac",
        "--arch",
        process.arch,
        "--skip-prepare",
        "--skip-build",
      ],
    ],
  ];
  for (const [stage, command, args] of stages) {
    console.log(JSON.stringify({ status: "running", stage }));
    await run(command, args, { env, log: join(logs, `${stage}.log`) });
  }
  const verified = await verifyArtifacts(report, artifacts, logs, env);
  await cleanSource();
  if (
    (await git("rev-parse", "HEAD")) !== report.source.commit ||
    (await git("branch", "--show-current")) !== report.source.branch
  )
    fail("source-changed");
  const candidate = {
    ...report,
    kind: "candidate",
    status: "ready",
    createdAt: new Date().toISOString(),
    platform: "mac",
    arch: process.arch,
    toolchain: {
      node,
      pnpm,
      miseSha256: digest(mise),
      lockSha256: digest(await readFile("pnpm-lock.yaml")),
    },
    ...verified,
    started: false,
    installed: false,
    published: false,
  };
  await writeFile(join(output, "candidate.json.tmp"), JSON.stringify(candidate, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  await rename(join(output, "candidate.json.tmp"), join(output, "candidate.json"));
  console.log(JSON.stringify({ status: "ready", output, commit: report.source.commit }));
}
