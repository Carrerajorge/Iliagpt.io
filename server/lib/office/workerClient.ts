/**
 * Typed client wrapper around `officeWorkerPool` for the OOXML tasks.
 *
 * Handles the (de)serialization of `DocxPackage` over postMessage:
 * Maps and Buffers are not structured-cloneable in their original shape, so
 * we serialize binary entries to ArrayBuffer (transferable) and XML entries
 * to plain strings.
 */

import { officeWorkerPool } from "./workerPool";
import type { DocxPackage } from "./ooxml/zipIO";
import type { ValidationReport } from "./ooxml/validator";
import type { DiffReport } from "./ooxml/roundTripDiff";
import type { XlsxValidationReport } from "./ooxml-xlsx/xlsxValidator";

interface SerializedEntry {
  path: string;
  isXml: boolean;
  xml?: string;
  binAb?: ArrayBuffer;
}
interface SerializedPackage {
  entries: SerializedEntry[];
  originalOrder: string[];
}

function bufferToAb(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function dehydratePackage(pkg: DocxPackage): { serialized: SerializedPackage; transferList: ArrayBuffer[] } {
  const transferList: ArrayBuffer[] = [];
  const entries: SerializedEntry[] = [];
  for (const e of pkg.entries.values()) {
    if (e.isXml) {
      entries.push({ path: e.path, isXml: true, xml: e.content as string });
    } else {
      const ab = bufferToAb(e.content as Buffer);
      transferList.push(ab);
      entries.push({ path: e.path, isXml: false, binAb: ab });
    }
  }
  return { serialized: { entries, originalOrder: pkg.originalOrder }, transferList };
}

function rehydratePackage(s: SerializedPackage): DocxPackage {
  const entries = new Map<string, { path: string; content: Buffer | string; isXml: boolean }>();
  for (const e of s.entries) {
    entries.set(e.path, {
      path: e.path,
      isXml: e.isXml,
      content: e.isXml ? (e.xml ?? "") : Buffer.from(e.binAb ?? new ArrayBuffer(0)),
    });
  }
  return { entries, originalOrder: s.originalOrder };
}

export interface WorkerClientOpts {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function workerUnpackDocx(buf: Buffer, opts: WorkerClientOpts = {}): Promise<DocxPackage> {
  const ab = bufferToAb(buf);
  const result = await officeWorkerPool.dispatch<{ bufferAb: ArrayBuffer }, SerializedPackage>(
    "docx.unpack",
    { bufferAb: ab },
    { ...opts, transferList: [ab] },
  );
  return rehydratePackage(result);
}

export async function workerParseXml(xml: string, opts: WorkerClientOpts = {}): Promise<void> {
  await officeWorkerPool.dispatch<{ xml: string }, { ok: true }>(
    "docx.parse",
    { xml },
    opts,
  );
}

export async function workerValidateDocx(pkg: DocxPackage, opts: WorkerClientOpts = {}): Promise<ValidationReport> {
  // Validation needs to read from the package; we don't transfer (the
  // structured clone is fine for the small XML/binary set, and the package
  // remains usable in the main thread for downstream stages).
  const { serialized } = dehydratePackage(pkg);
  return officeWorkerPool.dispatch<{ pkg: SerializedPackage }, ValidationReport>(
    "docx.validate",
    { pkg: serialized },
    opts,
  );
}

export async function workerValidateXlsx(pkg: DocxPackage, opts: WorkerClientOpts = {}): Promise<XlsxValidationReport> {
  const { serialized } = dehydratePackage(pkg);
  return officeWorkerPool.dispatch<{ pkg: SerializedPackage }, XlsxValidationReport>(
    "xlsx.validate",
    { pkg: serialized },
    opts,
  );
}

export async function workerRepackDocx(pkg: DocxPackage, opts: WorkerClientOpts = {}): Promise<Buffer> {
  const { serialized, transferList } = dehydratePackage(pkg);
  const result = await officeWorkerPool.dispatch<{ pkg: SerializedPackage }, { bufferAb: ArrayBuffer }>(
    "docx.repack",
    { pkg: serialized },
    { ...opts, transferList },
  );
  return Buffer.from(result.bufferAb);
}

export async function workerRoundTripDiff(
  originalPkg: DocxPackage,
  repackedBuf: Buffer,
  allowlist: string[] | undefined,
  opts: WorkerClientOpts = {},
): Promise<DiffReport> {
  const { serialized } = dehydratePackage(originalPkg);
  const ab = bufferToAb(repackedBuf);
  return officeWorkerPool.dispatch<
    { originalPkg: SerializedPackage; repackedAb: ArrayBuffer; allowlist?: string[] },
    DiffReport
  >(
    "docx.roundtrip_diff",
    { originalPkg: serialized, repackedAb: ab, allowlist },
    { ...opts, transferList: [ab] },
  );
}
