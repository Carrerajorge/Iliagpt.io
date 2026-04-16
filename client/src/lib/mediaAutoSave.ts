import { useMediaLibrary, getMediaTypeFromMime } from "@/hooks/use-media-library";

export async function autoSaveToMediaLibrary(
  blob: Blob,
  filename: string,
  options?: {
    source?: string;
  }
): Promise<string | null> {
  try {
    const type = getMediaTypeFromMime(blob.type);
    
    const item = await useMediaLibrary.getState().add(blob, type, {
      name: filename,
      source: options?.source || 'generated',
    });
    
    return item.id;
  } catch (error) {
    console.error('[MediaAutoSave] Failed to save:', error);
    return null;
  }
}

export async function autoSaveFromBuffer(
  buffer: ArrayBuffer,
  filename: string,
  mimeType: string,
  options?: { source?: string }
): Promise<string | null> {
  const blob = new Blob([buffer], { type: mimeType });
  return autoSaveToMediaLibrary(blob, filename, options);
}

export async function autoSaveFromUrl(
  dataUrl: string,
  filename: string,
  options?: { source?: string }
): Promise<string | null> {
  try {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    return autoSaveToMediaLibrary(blob, filename, options);
  } catch (error) {
    console.error('[MediaAutoSave] Failed to save from URL:', error);
    return null;
  }
}

const DOCUMENT_MIME_TYPES: Record<string, string> = {
  'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'pdf': 'application/pdf',
  'csv': 'text/csv',
  'txt': 'text/plain',
  'json': 'application/json',
  'md': 'text/markdown',
};

export function getMimeTypeFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return DOCUMENT_MIME_TYPES[ext] || 'application/octet-stream';
}
