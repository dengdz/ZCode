import { createReadStream } from "node:fs";
import { readdir, lstat, readlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { promisify } from "node:util";
import { fail } from "./process.mjs";
const hashBytes = (bytes) => createHash("sha256").update(bytes).digest("hex");
function streamHash(stream) {
  // yauzl 的 fd-slicer 旧式 Readable 在 Node 24 的 async iterator 下会悬空；使用其公开 data/end/error 契约，保证完成与错误都可观察。
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex")));
  });
}
export const fileHash = (path) => streamHash(createReadStream(path));
export async function applicationTree(root, { include = () => true } = {}) {
  const members = new Map();
  async function walk(prefix = "") {
    for (const name of await readdir(join(root, prefix))) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (!include(path)) continue;
      const absolute = join(root, path);
      const info = await lstat(absolute);
      const kind = info.isSymbolicLink()
        ? "link"
        : info.isDirectory()
          ? "directory"
          : info.isFile()
            ? "file"
            : null;
      if (!kind) fail("unsupported-package-member");
      const hash =
        kind === "file"
          ? await fileHash(absolute)
          : kind === "link"
            ? hashBytes(await readlink(absolute))
            : null;
      members.set(path, { kind, mode: info.mode & 0o777, sha256: hash });
      if (kind === "directory") await walk(path);
    }
  }
  await walk();
  return members;
}
export function treeDigest(members) {
  return hashBytes(JSON.stringify([...members].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));
}
function nextEntry(zip) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      zip.off("entry", entry);
      zip.off("end", end);
      zip.off("error", error);
    };
    const entry = (value) => {
      cleanup();
      resolve(value);
    };
    const end = () => {
      cleanup();
      resolve(null);
    };
    const error = (err) => {
      cleanup();
      reject(err);
    };
    zip.once("entry", entry);
    zip.once("end", end);
    zip.once("error", error);
    zip.readEntry();
  });
}
export async function verifyZipApplication(path, members, yauzl) {
  const zip = await promisify(yauzl.open)(path, { lazyEntries: true, autoClose: false });
  const seen = new Set();
  try {
    for (let entry; (entry = await nextEntry(zip)); ) {
      const name = entry.fileName;
      if (name.startsWith("__MACOSX/") || name === "ZCode Local.app/") continue;
      if (!name.startsWith("ZCode Local.app/")) fail("archive-package-mismatch");
      const member = name.slice("ZCode Local.app/".length).replace(/\/$/, "");
      const expected = members.get(member);
      if (!expected || seen.has(member)) fail("archive-package-mismatch");
      seen.add(member);
      const mode = entry.externalFileAttributes >>> 16;
      const kind =
        (mode & 0o170000) === 0o120000 ? "link" : name.endsWith("/") ? "directory" : "file";
      if (kind !== expected.kind || (mode & 0o777) !== expected.mode)
        fail("archive-package-mismatch");
      if (kind !== "directory") {
        const stream = await promisify(zip.openReadStream.bind(zip))(entry);
        if ((await streamHash(stream)) !== expected.sha256) fail("archive-package-mismatch");
      }
    }
    // ZIP 中目录项可省略；每个文件和链接都必须完整存在，并与已 deep/strict 验签的应用同类型、权限和内容。
    // 无需解压不可信成员到文件系统，即可证明压缩包承载的是同一个完整签名应用，而不只核对主程序/ASAR 三项。
    for (const [path, member] of members)
      if (member.kind !== "directory" && !seen.has(path)) fail("archive-package-mismatch");
  } finally {
    zip.close();
  }
}
