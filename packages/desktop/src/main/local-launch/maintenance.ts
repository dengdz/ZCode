import { lstat, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { atomicWritePrivateTextFile } from "@zcode/shared/node";

export const LOCAL_MAINTENANCE_PROTOCOL = 1;

export interface LocalMaintenanceRequest {
  schema: 1;
  kind: "local-maintenance-request";
  requestId: string;
  token: string;
  appPid: number;
  createdAt: string;
}

export type LocalMaintenanceResponse = {
  schema: 1;
  kind: "local-maintenance-response";
  requestId: string;
  token: string;
  appPid: number;
  createdAt: string;
} & (
  | { status: "accepted"; runningTaskCount: 0 }
  | { status: "busy"; runningTaskCount: number }
  | { status: "unknown"; runningTaskCount: null }
);

export type LocalMaintenanceTaskState =
  | { kind: "ready"; runningTaskCount: number }
  | { kind: "unknown" };

export type LocalMaintenanceRuntime =
  | {
      schema: 1;
      kind: "local-maintenance-runtime";
      token: string;
      appPid: number;
      version: string;
      state: "starting";
      updatedAt: string;
    }
  | {
      schema: 1;
      kind: "local-maintenance-runtime";
      token: string;
      appPid: number;
      version: string;
      state: "ready";
      updatedAt: string;
    };

function maintenanceDirectory(dataRoot: string): string {
  return join(dataRoot, ".zcode", "local", "maintenance");
}

async function ensureMaintenanceDirectory(dataRoot: string): Promise<string> {
  const directory = maintenanceDirectory(dataRoot);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (info.mode & 0o077) !== 0 ||
    typeof process.getuid !== "function" ||
    info.uid !== process.getuid()
  )
    throw new Error("Local maintenance directory is not private");
  return directory;
}

function isPid(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function validCommon(value: Record<string, unknown>): boolean {
  return (
    value.schema === 1 &&
    typeof value.token === "string" &&
    value.token.length > 0 &&
    isPid(value.appPid) &&
    typeof value.createdAt === "string" &&
    Number.isFinite(Date.parse(value.createdAt))
  );
}

export async function writeLocalMaintenanceRequest(input: {
  dataRoot: string;
  token: string;
  appPid: number;
}): Promise<LocalMaintenanceRequest> {
  const request: LocalMaintenanceRequest = {
    schema: 1,
    kind: "local-maintenance-request",
    requestId: randomUUID(),
    token: input.token,
    appPid: input.appPid,
    createdAt: new Date().toISOString(),
  };
  const directory = await ensureMaintenanceDirectory(input.dataRoot);
  await atomicWritePrivateTextFile(join(directory, "switch-request.json"), JSON.stringify(request));
  return request;
}

export async function readLocalMaintenanceRequest(
  dataRoot: string,
  token: string,
  appPid: number,
): Promise<LocalMaintenanceRequest | null> {
  let raw: string;
  try {
    raw = await readFile(
      join(await ensureMaintenanceDirectory(dataRoot), "switch-request.json"),
      "utf8",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const value = JSON.parse(raw) as Record<string, unknown>;
  if (
    !validCommon(value) ||
    !hasOnlyKeys(value, ["schema", "kind", "requestId", "token", "appPid", "createdAt"]) ||
    value.kind !== "local-maintenance-request" ||
    typeof value.requestId !== "string" ||
    value.requestId.length === 0 ||
    value.token !== token ||
    value.appPid !== appPid
  )
    throw new Error("Invalid Local maintenance request");
  return value as unknown as LocalMaintenanceRequest;
}

export async function readLocalMaintenanceResponse(
  dataRoot: string,
  request: Pick<LocalMaintenanceRequest, "requestId" | "token" | "appPid">,
): Promise<LocalMaintenanceResponse | null> {
  let raw: string;
  try {
    raw = await readFile(
      join(await ensureMaintenanceDirectory(dataRoot), "switch-response.json"),
      "utf8",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const value = JSON.parse(raw) as Record<string, unknown>;
  if (
    !validCommon(value) ||
    !hasOnlyKeys(value, [
      "schema",
      "kind",
      "requestId",
      "token",
      "appPid",
      "status",
      "runningTaskCount",
      "createdAt",
    ]) ||
    value.kind !== "local-maintenance-response" ||
    value.requestId !== request.requestId ||
    value.token !== request.token ||
    value.appPid !== request.appPid
  )
    throw new Error("Invalid Local maintenance response");
  const status = value.status;
  const runningTaskCount = value.runningTaskCount;
  if (
    (status === "accepted" && runningTaskCount === 0) ||
    (status === "busy" &&
      typeof runningTaskCount === "number" &&
      Number.isSafeInteger(runningTaskCount) &&
      runningTaskCount > 0) ||
    (status === "unknown" && runningTaskCount === null)
  )
    return value as unknown as LocalMaintenanceResponse;
  throw new Error("Invalid Local maintenance response");
}

export async function readLocalMaintenanceRuntime(
  dataRoot: string,
  token: string,
  appPid: number,
): Promise<LocalMaintenanceRuntime | null> {
  let raw: string;
  try {
    raw = await readFile(join(await ensureMaintenanceDirectory(dataRoot), "runtime.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const value = JSON.parse(raw) as Record<string, unknown>;
  if (
    value.schema !== 1 ||
    !hasOnlyKeys(value, ["schema", "kind", "token", "appPid", "version", "state", "updatedAt"]) ||
    value.kind !== "local-maintenance-runtime" ||
    value.token !== token ||
    value.appPid !== appPid ||
    typeof value.version !== "string" ||
    !value.version ||
    !["starting", "ready"].includes(String(value.state)) ||
    typeof value.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.updatedAt))
  )
    throw new Error("Invalid Local maintenance runtime");
  return value as unknown as LocalMaintenanceRuntime;
}

export async function writeLocalMaintenanceResponse(input: {
  dataRoot: string;
  request: LocalMaintenanceRequest;
  status: "accepted" | "busy" | "unknown";
  runningTaskCount: number | null;
}): Promise<void> {
  await atomicWritePrivateTextFile(
    join(await ensureMaintenanceDirectory(input.dataRoot), "switch-response.json"),
    JSON.stringify({
      schema: 1,
      kind: "local-maintenance-response",
      requestId: input.request.requestId,
      token: input.request.token,
      appPid: input.request.appPid,
      status: input.status,
      runningTaskCount: input.runningTaskCount,
      createdAt: new Date().toISOString(),
    }),
  );
}

export async function writeLocalMaintenanceRuntime(input: {
  dataRoot: string;
  token: string;
  appPid: number;
  version: string;
  state: "starting" | "ready";
}): Promise<void> {
  await atomicWritePrivateTextFile(
    join(await ensureMaintenanceDirectory(input.dataRoot), "runtime.json"),
    JSON.stringify({
      schema: 1,
      kind: "local-maintenance-runtime",
      token: input.token,
      appPid: input.appPid,
      version: input.version,
      state: input.state,
      updatedAt: new Date().toISOString(),
    }),
  );
}

export async function clearLocalMaintenanceFiles(dataRoot: string): Promise<void> {
  const directory = await ensureMaintenanceDirectory(dataRoot);
  await Promise.all(
    ["switch-request.json", "switch-response.json"].map((name) =>
      rm(join(directory, name), { force: true }),
    ),
  );
}

export function installLocalMaintenanceRuntime(options: {
  dataRoot: string;
  token: string;
  version: string;
  getTaskState: () => LocalMaintenanceTaskState;
  onAccepted: () => void;
}): { markHostReady(): Promise<void>; dispose(): void } {
  let handling = false;
  let disposed = false;
  const writeStarting = () =>
    writeLocalMaintenanceRuntime({
      dataRoot: options.dataRoot,
      token: options.token,
      appPid: process.pid,
      version: options.version,
      state: "starting",
    });
  void writeStarting().catch(() => {});

  const handle = async () => {
    if (handling || disposed) return;
    handling = true;
    try {
      const request = await readLocalMaintenanceRequest(
        options.dataRoot,
        options.token,
        process.pid,
      );
      if (!request) return;
      const taskState = options.getTaskState();
      if (taskState.kind === "unknown") {
        await writeLocalMaintenanceResponse({
          dataRoot: options.dataRoot,
          request,
          status: "unknown",
          runningTaskCount: null,
        });
        return;
      }
      if (taskState.runningTaskCount > 0) {
        await writeLocalMaintenanceResponse({
          dataRoot: options.dataRoot,
          request,
          status: "busy",
          runningTaskCount: taskState.runningTaskCount,
        });
        return;
      }
      await writeLocalMaintenanceResponse({
        dataRoot: options.dataRoot,
        request,
        status: "accepted",
        runningTaskCount: 0,
      });
      options.onAccepted();
    } catch {
      // 请求文件不可信或写入失败时不退出；维护入口会从缺失/不匹配的响应判定 unknown。
    } finally {
      handling = false;
    }
  };
  process.on("SIGUSR2", handle);
  return {
    async markHostReady() {
      if (disposed) return;
      await writeLocalMaintenanceRuntime({
        dataRoot: options.dataRoot,
        token: options.token,
        appPid: process.pid,
        version: options.version,
        state: "ready",
      });
    },
    dispose() {
      disposed = true;
      process.removeListener("SIGUSR2", handle);
    },
  };
}
