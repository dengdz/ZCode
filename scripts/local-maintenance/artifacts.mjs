import { mkdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { run, fail } from "./process.mjs";
import { fileHash, applicationTree, treeDigest, verifyZipApplication } from "./package-tree.mjs";
export async function verifyArtifacts(report, artifacts, logs, env) {
  // electron-builder 的 Intel 目录是 mac，lipo 采用 Mach-O 名称 x86_64；两者都不能直接套用 Node 的 x64。
  const appDirectory = process.arch === "arm64" ? "mac-arm64" : "mac";
  const machArchitecture = process.arch === "x64" ? "x86_64" : process.arch;
  const app = join(artifacts, appDirectory, "ZCode Local.app");
  const asar = join(app, "Contents/Resources/app.asar");
  const require = createRequire(
    fileURLToPath(new URL("../../packages/desktop/package.json", import.meta.url)),
  );
  const asarModule = require.resolve("@electron/asar");
  const packaged = JSON.parse(
    await run(
      process.execPath,
      [
        "-e",
        `const {extractFile}=require(process.argv[1]); console.log(JSON.stringify({package:JSON.parse(extractFile(process.argv[2],'package.json')),metadata:JSON.parse(extractFile(process.argv[2],'out/metadata/build-meta.json'))}));`,
        asarModule,
        asar,
      ],
      { env },
    ),
  );
  if (
    packaged.package.version !== report.source.version ||
    packaged.package.zcodeProductFlavor !== "local" ||
    packaged.metadata.appVersion !== report.source.version ||
    !/^[a-f0-9]{8,40}$/.test(packaged.metadata.buildCommitId ?? "") ||
    !report.source.commit.startsWith(packaged.metadata.buildCommitId)
  )
    fail("package-source-mismatch");
  const plist = JSON.parse(
    await run("plutil", ["-convert", "json", "-o", "-", join(app, "Contents/Info.plist")], { env }),
  );
  const [official, revision] = report.source.version.split("-local.");
  const [major, minor, patch] = official.split(".").map(Number);
  if (
    plist.CFBundleIdentifier !== "dev.zcode.app.local" ||
    plist.CFBundleShortVersionString !== official ||
    plist.CFBundleVersion !== `${major}.${minor}.${patch * 1000 + Number(revision)}`
  )
    fail("platform-metadata-mismatch");
  const signatureLog = join(logs, "signature.log");
  await run("codesign", ["--verify", "--deep", "--strict", app], { env, log: signatureLog });
  const signature = await run("codesign", ["-dv", "--verbose=4", app], {
    env,
    log: signatureLog,
    includeStderr: true,
  });
  if (!signature.includes("Signature=adhoc") || !signature.includes("runtime"))
    fail("signature-policy");
  if (
    (await run("lipo", ["-archs", join(app, "Contents/MacOS/ZCode Local")], { env })) !==
    machArchitecture
  )
    fail("package-architecture");
  const stem = `ZCode Local-${report.source.version}-mac-${process.arch}`;
  const dmg = join(artifacts, `${stem}.dmg`);
  const zip = join(artifacts, `${stem}.zip`);
  await run("hdiutil", ["verify", dmg], { env, log: join(logs, "dmg.log") });
  await run("unzip", ["-tq", zip], { env, log: join(logs, "zip.log") });
  const asarHash = await fileHash(asar);
  const members = await applicationTree(app);
  await verifyZipApplication(zip, members, require("yauzl"));
  const mount = join(artifacts, "verify-dmg");
  await mkdir(mount);
  await run(
    "hdiutil",
    ["attach", "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", mount, dmg],
    { env, log: join(logs, "dmg-mount.log") },
  );
  try {
    if (treeDigest(await applicationTree(join(mount, "ZCode Local.app"))) !== treeDigest(members))
      fail("dmg-package-mismatch");
    await run("codesign", ["--verify", "--deep", "--strict", join(mount, "ZCode Local.app")], {
      env,
      log: signatureLog,
    });
  } finally {
    await run("hdiutil", ["detach", mount], { env, log: join(logs, "dmg-mount.log") });
  }
  const files = [];
  for (const path of [dmg, zip])
    files.push({
      file: `artifacts/${path.slice(artifacts.length + 1)}`,
      bytes: (await stat(path)).size,
      sha256: await fileHash(path),
    });
  return {
    app: `artifacts/${appDirectory}/ZCode Local.app`,
    package: {
      version: packaged.package.version,
      flavor: packaged.package.zcodeProductFlavor,
      metadata: packaged.metadata,
      plist,
      asarSha256: asarHash,
      appTreeSha256: treeDigest(members),
      signing: "adhoc+runtime",
    },
    artifacts: files,
  };
}
