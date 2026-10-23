import { mkdir, lstat, realpath, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, basename, join, isAbsolute, resolve } from "node:path";
import { homedir } from "node:os";
import { git, fail } from "./process.mjs";
import { within } from "./checks.mjs";

export const backupId = (id) => typeof id === "string" && /^backup-[a-f0-9-]{36}$/.test(id);
export async function privateDirectory(path) {
  const info = await lstat(path);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (info.mode & 0o077) !== 0 ||
    info.uid !== process.getuid()
  )
    fail("backup-root-not-private");
}
export async function backupRoot(value, create = false) {
  if (!value || !isAbsolute(value)) fail("explicit-backup-root-required");
  const root = join(await realpath(dirname(value)), basename(value));
  const repo = await realpath(await git("rev-parse", "--show-toplevel"));
  for (const path of [repo, join(homedir(), ".zcode"), "/Applications", "/System", "/Library"])
    if (within(path, root) || within(root, path)) fail("unsafe-backup-root");
  let created = false;
  try {
    await lstat(root);
  } catch (e) {
    if (e.code !== "ENOENT" || !create) throw e;
    await mkdir(root, { mode: 0o700 });
    created = true;
  }
  await privateDirectory(root);
  const marker = join(root, "backup-root.json");
  if (created)
    await writeFile(
      marker,
      JSON.stringify({ schema: 1, kind: "local-backup-root", root, token: randomUUID() }) + "\n",
      { flag: "wx", mode: 0o600 },
    );
  const info = await lstat(marker);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    (info.mode & 0o077) !== 0 ||
    info.uid !== process.getuid()
  )
    fail("backup-root-owner");
  const owner = JSON.parse(await readFile(marker, "utf8"));
  if (
    owner.schema !== 1 ||
    owner.kind !== "local-backup-root" ||
    owner.root !== root ||
    !/^[a-f0-9-]{36}$/.test(owner.token)
  )
    fail("backup-root-owner");
  return { root, owner };
}
export async function withBackupRoot(value, create, operation) {
  const context = await backupRoot(value, create);
  const lock = join(context.root, ".maintenance-lock");
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch (e) {
    if (e.code === "EEXIST") fail("backup-occupied");
    throw e;
  }
  try {
    return await operation(context);
  } finally {
    await rm(lock, { recursive: true });
  }
}
export async function backupDirectories(root) {
  return (await readdir(root, { withFileTypes: true }))
    .filter((entry) => backupId(entry.name) && entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort();
}
export function disjointBackup(root, paths) {
  for (const path of paths)
    if (within(root, path) || within(path, root)) fail("backup-source-overlap");
}
export function absoluteOption(value) {
  if (!value || !isAbsolute(value) || resolve(value) === "/") fail("explicit-source-required");
  return resolve(value);
}

export async function pinBackup(context, id, planId) {
  if (!backupId(id) || !/^recovery-[a-f0-9-]{36}$/.test(planId ?? "")) fail("recovery-pin-invalid");
  await privateDirectory(join(context.root, id));
  const file = join(context.root, id, ".recovery-pin");
  try {
    await writeFile(file, planId + "\n", { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const info = await lstat(file);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.mode & 0o077 ||
      info.uid !== process.getuid()
    )
      fail("recovery-pin-invalid");
  }
}
