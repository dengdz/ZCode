import { createReadStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { run, fail } from "./process.mjs";
export async function fileHash(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
export async function verifyArtifacts(report, artifacts, logs, env) {
  const app = join(artifacts, `mac-${process.arch}`, "ZCode Local.app");
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
    process.arch
  )
    fail("package-architecture");
  const stem = `ZCode Local-${report.source.version}-mac-${process.arch}`;
  const dmg = join(artifacts, `${stem}.dmg`);
  const zip = join(artifacts, `${stem}.zip`);
  await run("hdiutil", ["verify", dmg], { env, log: join(logs, "dmg.log") });
  await run("unzip", ["-tq", zip], { env, log: join(logs, "zip.log") });
  const asarHash = await fileHash(asar);
  const members = [
    "Contents/Resources/app.asar",
    "Contents/Info.plist",
    "Contents/MacOS/ZCode Local",
  ];
  for (const member of members) {
    if (
      (await run("unzip", ["-p", zip, `ZCode Local.app/${member}`], { env, hashStdout: true })) !==
      (await fileHash(join(app, member)))
    )
      fail("archive-package-mismatch");
  }
  const mount = join(artifacts, "verify-dmg");
  await mkdir(mount);
  await run(
    "hdiutil",
    ["attach", "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", mount, dmg],
    { env, log: join(logs, "dmg-mount.log") },
  );
  try {
    for (const member of members) {
      if (
        (await fileHash(join(mount, "ZCode Local.app", member))) !==
        (await fileHash(join(app, member)))
      )
        fail("dmg-package-mismatch");
    }
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
    app: `artifacts/mac-${process.arch}/ZCode Local.app`,
    package: {
      version: packaged.package.version,
      flavor: packaged.package.zcodeProductFlavor,
      metadata: packaged.metadata,
      plist,
      asarSha256: asarHash,
      signing: "adhoc+runtime",
    },
    artifacts: files,
  };
}
