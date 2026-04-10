/**
 * Office Engine worker thread entry point.
 *
 * This file runs inside a `worker_threads.Worker`. It handles CPU-bound OOXML
 * tasks (`docx.unpack`, `docx.parse`, `docx.validate`, `docx.repack`,
 * `docx.roundtrip_diff`) dispatched by `workerPool.ts`.
 *
 * Hard rules for this file:
 *   - **No filesystem access**, no network, no top-level await.
 *   - Every handler is wrapped in try/catch and posts a structured error.
 *   - Binary buffers are exchanged as `ArrayBuffer` via `transferList` to
 *     avoid copying.
 */

import { parentPort } from "node:worker_threads";
// NOTE: explicit `.ts` extensions are required because the worker is spawned
// via `node --import tsx server/lib/office/worker-entry.ts`. The tsx ESM
// loader resolves bare relative imports without extensions in vitest/cjs
// contexts but NOT inside an ESM worker_thread. The project's tsconfig has
// `allowImportingTsExtensions: true`, so `.ts` is also fine for tsc.
import { unpackDocx, repackDocx } from "./ooxml/zipIO.ts";
import { parseOoxml } from "./ooxml/xmlSerializer.ts";
import { validateDocx } from "./ooxml/validator.ts";
import { roundTripDiff } from "./ooxml/roundTripDiff.ts";
import type { WorkerTaskEnvelope, WorkerTaskResult } from "./types.ts";

if (!parentPort) {
  throw new Error("worker-entry.ts must be run inside a worker_threads.Worker");
}

const port = parentPort;

interface UnpackPayload {
  bufferAb: ArrayBuffer;
}
interface UnpackResult {
  entries: Array<{ path: string; isXml: boolean; xml?: string; binAb?: ArrayBuffer }>;
  originalOrder: string[];
}

interface ParsePayload {
  xml: string;
}
interface ParseResult {
  ok: true;
}

interface ValidatePayload {
  pkg: SerializedPackage;
}

interface RepackPayload {
  pkg: SerializedPackage;
}
interface RepackResult {
  bufferAb: ArrayBuffer;
}

interface RoundTripPayload {
  originalPkg: SerializedPackage;
  repackedAb: ArrayBuffer;
  allowlist?: string[];
}

interface SerializedPackage {
  entries: Array<{ path: string; isXml: boolean; xml?: string; binAb?: ArrayBuffer }>;
  originalOrder: string[];
}

function fromAb(ab: ArrayBuffer): Buffer {
  return Buffer.from(ab);
}

function toAb(buf: Buffer): ArrayBuffer {
  // Slice into a new ArrayBuffer if the underlying one is shared / oversized.
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function rehydrate(serialized: SerializedPackage) {
  const entries = new Map<string, { path: string; content: Buffer | string; isXml: boolean }>();
  for (const e of serialized.entries) {
    entries.set(e.path, {
      path: e.path,
      isXml: e.isXml,
      content: e.isXml ? (e.xml ?? "") : Buffer.from(e.binAb ?? new ArrayBuffer(0)),
    });
  }
  return { entries, originalOrder: serialized.originalOrder };
}

function dehydrate(pkg: { entries: Map<string, { path: string; content: Buffer | string; isXml: boolean }>; originalOrder: string[] }): {
  serialized: SerializedPackage;
  transferList: ArrayBuffer[];
} {
  const transferList: ArrayBuffer[] = [];
  const entries: SerializedPackage["entries"] = [];
  for (const e of pkg.entries.values()) {
    if (e.isXml) {
      entries.push({ path: e.path, isXml: true, xml: e.content as string });
    } else {
      const ab = toAb(e.content as Buffer);
      transferList.push(ab);
      entries.push({ path: e.path, isXml: false, binAb: ab });
    }
  }
  return {
    serialized: { entries, originalOrder: pkg.originalOrder },
    transferList,
  };
}

async function handle(env: WorkerTaskEnvelope): Promise<{ result: unknown; transferList?: ArrayBuffer[] }> {
  switch (env.task) {
    case "docx.unpack": {
      const { bufferAb } = env.payload as UnpackPayload;
      const pkg = await unpackDocx(fromAb(bufferAb));
      const { serialized, transferList } = dehydrate(pkg);
      return { result: serialized as UnpackResult, transferList };
    }
    case "docx.parse": {
      const { xml } = env.payload as ParsePayload;
      // Parse and discard — this confirms well-formedness inside the worker.
      parseOoxml(xml);
      return { result: { ok: true } as ParseResult };
    }
    case "docx.validate": {
      const { pkg } = env.payload as ValidatePayload;
      const report = validateDocx(rehydrate(pkg));
      return { result: report };
    }
    case "docx.repack": {
      const { pkg } = env.payload as RepackPayload;
      const buf = await repackDocx(rehydrate(pkg));
      const ab = toAb(buf);
      return { result: { bufferAb: ab } as RepackResult, transferList: [ab] };
    }
    case "docx.roundtrip_diff": {
      const { originalPkg, repackedAb, allowlist } = env.payload as RoundTripPayload;
      const report = await roundTripDiff(rehydrate(originalPkg), fromAb(repackedAb), { allowlist });
      return { result: report };
    }
    default: {
      throw new Error(`Unknown worker task: ${(env as { task: string }).task}`);
    }
  }
}

port.on("message", async (env: WorkerTaskEnvelope) => {
  const taskId = env.taskId;
  try {
    const { result, transferList } = await handle(env);
    const message: WorkerTaskResult = { taskId, ok: true, result };
    if (transferList && transferList.length > 0) {
      port.postMessage(message, transferList);
    } else {
      port.postMessage(message);
    }
  } catch (err) {
    const message: WorkerTaskResult = {
      taskId,
      ok: false,
      error: {
        name: err instanceof Error ? err.name : "Error",
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
    };
    port.postMessage(message);
  }
});
