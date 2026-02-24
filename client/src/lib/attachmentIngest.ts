export function normalizeHttpUrl(candidate: string): string | null {
  const trimmed = (candidate || "").trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

const FILELIKE_EXTENSIONS = new Set([
  // documents
  "pdf",
  "doc",
  "docx",
  "xlsx",
  "xls",
  "pptx",
  "ppt",
  "txt",
  "md",
  "csv",
  "json",
  "html",
  "htm",
  // images
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "webp",
  "tif",
  "tiff",
  // Note: svg intentionally excluded. It's often unsafe in many pipelines.
]);

export function looksLikeDirectFileUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const lastSegment = (u.pathname || "").split("/").pop() || "";
    const dotIdx = lastSegment.lastIndexOf(".");
    if (dotIdx < 0) return false;
    const ext = lastSegment.slice(dotIdx + 1).toLowerCase();
    return FILELIKE_EXTENSIONS.has(ext);
  } catch {
    return false;
  }
}

export function extractUrlsFromUriList(uriList: string): string[] {
  if (!uriList) return [];
  const lines = uriList
    .split(/\r?\n/g)
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith("#"));

  const urls = lines
    .map(normalizeHttpUrl)
    .filter((u): u is string => !!u);

  return uniq(urls);
}

/**
 * Returns URLs only when the text is "bare URLs" (one or more URLs separated by whitespace).
 * If any token isn't a URL, returns [] so normal text paste remains untouched.
 */
export function extractBareUrlsFromText(text: string): string[] {
  const trimmed = (text || "").trim();
  if (!trimmed) return [];

  const tokens = trimmed.split(/\s+/g).filter(Boolean);
  if (tokens.length === 0) return [];

  const urls: string[] = [];
  for (const token of tokens) {
    const normalized = normalizeHttpUrl(token);
    if (!normalized) return [];
    urls.push(normalized);
  }

  return uniq(urls);
}

export function extractImageUrlsFromHtml(html: string): string[] {
  if (!html) return [];
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");

    const urls: string[] = [];

    doc.querySelectorAll("img[src], img[data-src], source[src]").forEach((el) => {
      const raw = (el.getAttribute("src") || el.getAttribute("data-src") || "").trim();
      const normalized = normalizeHttpUrl(raw);
      if (normalized) urls.push(normalized);
    });

    return uniq(urls).slice(0, 10);
  } catch {
    return [];
  }
}

export function extractLinkUrlsFromHtml(html: string): string[] {
  if (!html) return [];
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const urls: string[] = [];

    doc.querySelectorAll("a[href]").forEach((el) => {
      const raw = (el.getAttribute("href") || "").trim();
      const normalized = normalizeHttpUrl(raw);
      if (normalized) urls.push(normalized);
    });

    return uniq(urls).slice(0, 10);
  } catch {
    return [];
  }
}

export function extractUrlsFromHtml(html: string): string[] {
  return uniq([...extractImageUrlsFromHtml(html), ...extractLinkUrlsFromHtml(html)]).slice(0, 10);
}

export function isDataImageUrl(value: string): boolean {
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(value || "");
}

export function dataImageUrlToFile(dataUrl: string, fileName: string): File | null {
  if (!isDataImageUrl(dataUrl)) return null;
  try {
    const [header, base64] = dataUrl.split(",", 2);
    if (!base64) return null;
    const mimeMatch = header.match(/^data:([^;]+);base64$/i);
    const mimeType = (mimeMatch?.[1] || "image/png").toLowerCase();

    const binStr = atob(base64);
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) {
      bytes[i] = binStr.charCodeAt(i);
    }

    return new File([bytes], fileName, { type: mimeType });
  } catch {
    return null;
  }
}

export function inferMimeTypeFromFilename(filename: string): string | null {
  const name = (filename || "").toLowerCase();
  const idx = name.lastIndexOf(".");
  const ext = idx >= 0 ? name.slice(idx + 1) : "";
  if (!ext) return null;

  const map: Record<string, string> = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ppt: "application/vnd.ms-powerpoint",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    html: "text/html",
    htm: "text/html",
    json: "application/json",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    bmp: "image/bmp",
    webp: "image/webp",
    tif: "image/tiff",
    tiff: "image/tiff",
    svg: "image/svg+xml",
  };

  return map[ext] || null;
}

export function normalizeFileForUpload(file: File): File {
  if (!file) return file;
  const declaredType = (file.type || "").trim().toLowerCase();
  // Some browsers/flows mark known files as application/octet-stream. Treat that as "unknown"
  // and infer the real MIME type from the filename when possible.
  //
  // We also normalize a few common legacy/alias MIME types that would otherwise be rejected
  // by the server's allowlist (which expects standard MIME types).
  const NORMALIZE_MIME_ALIASES = new Set([
    "application/octet-stream",
    "application/x-pdf",
    "application/acrobat",
    "application/vnd.pdf",
    "application/zip",
    "application/x-zip-compressed",
    "image/pjpeg",
    "image/x-png",
  ]);
  if (declaredType && !NORMALIZE_MIME_ALIASES.has(declaredType)) return file;

  const inferred = inferMimeTypeFromFilename(file.name);
  if (!inferred) return file;

  // Preserve bytes without copying by using the original file as the blob part.
  return new File([file], file.name, { type: inferred });
}

async function fileFromFileEntry(fileEntry: any): Promise<File | null> {
  return await new Promise<File | null>((resolve) => {
    try {
      fileEntry.file(
        (file: File) => resolve(file),
        () => resolve(null)
      );
    } catch {
      resolve(null);
    }
  });
}

async function readAllDirectoryEntries(dirEntry: any): Promise<any[]> {
  const reader = dirEntry.createReader();
  const entries: any[] = [];
  while (true) {
    const batch: any[] = await new Promise<any[]>((resolve) => {
      try {
        reader.readEntries((result: any[]) => resolve(result || []), () => resolve([]));
      } catch {
        resolve([]);
      }
    });
    if (!batch.length) break;
    entries.push(...batch);
  }
  return entries;
}

async function traverseEntry(
  entry: any,
  prefix: string,
  out: File[],
  maxFiles: number
): Promise<void> {
  if (!entry || out.length >= maxFiles) return;

  if (entry.isFile) {
    const file = await fileFromFileEntry(entry);
    if (!file) return;
    const name = (prefix ? `${prefix}/` : "") + file.name;
    out.push(new File([file], name, { type: file.type, lastModified: (file as any).lastModified }));
    return;
  }

  if (entry.isDirectory) {
    const nextPrefix = (prefix ? `${prefix}/` : "") + (entry.name || "folder");
    const entries = await readAllDirectoryEntries(entry);
    for (const child of entries) {
      if (out.length >= maxFiles) break;
      // eslint-disable-next-line no-await-in-loop
      await traverseEntry(child, nextPrefix, out, maxFiles);
    }
  }
}

/**
 * Extract dropped files from a DataTransfer. Supports folder drops in Chromium via webkitGetAsEntry().
 * Falls back to dataTransfer.files for browsers that don't expose directory entries.
 */
export async function extractFilesFromDataTransfer(
  dataTransfer: DataTransfer | null | undefined,
  { maxFiles = 200 }: { maxFiles?: number } = {}
): Promise<File[]> {
  if (!dataTransfer) return [];

  const items = Array.from(dataTransfer.items || []);
  const hasEntries = items.some((it) => typeof (it as any).webkitGetAsEntry === "function");
  if (!hasEntries) {
    return Array.from(dataTransfer.files || []);
  }

  const roots: any[] = [];
  for (const item of items) {
    const entry = (item as any).webkitGetAsEntry?.();
    if (entry) roots.push(entry);
  }
  if (roots.length === 0) return Array.from(dataTransfer.files || []);

  const out: File[] = [];
  for (const root of roots) {
    if (out.length >= maxFiles) break;
    // eslint-disable-next-line no-await-in-loop
    await traverseEntry(root, "", out, maxFiles);
  }

  return out.length > 0 ? out : Array.from(dataTransfer.files || []);
}

export async function compressImageToDataUrl(file: File, maxWidth = 1920, maxHeight = 1080, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("Image compression timeout"));
      }
    }, 10000); // 10 seconds max

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to load image for compression"));
    };
    img.onload = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = width * ratio;
        height = height * ratio;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        // Fallback to FileReader if canvas fails
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.readAsDataURL(file);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      // use jpeg for robust compatibility with OpenAI Vision
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.src = objectUrl;
  });
}
