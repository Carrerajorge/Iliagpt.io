import mammoth from "mammoth"; import ExcelJS from "exceljs"; import * as XLSX from "xlsx"; import officeParser from "officeparser"; import { ocrService } from 
"./services/ocrService"; import { sanitizePlainText } from "./lib/textSanitizers";


export interface ExtractTextResult {
  text: string;
  success: boolean;
  method: 'native' | 'ocr' | 'fallback';
  error?: string;
  confidence?: number;
}

const SUPPORTED_MIME_TYPES = new Set([
  'text/plain', 'text/markdown', 'text/md', 'application/json', 'text/csv', 'text/tab-separated-values', 'text/html',
  'application/rtf', 'text/rtf',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/bmp', 'image/tiff', 'image/webp'
]);

export function isSupportedMimeType(mimeType: string): boolean {
  return SUPPORTED_MIME_TYPES.has(mimeType) || ocrService.isImageMimeType(mimeType);
}

export function getSupportedMimeTypes(): string[] {
  return Array.from(SUPPORTED_MIME_TYPES);
}

export async function extractTextSafe(content: Buffer, mimeType: string): Promise<ExtractTextResult> {
  try {
    const text = await extractText(content, mimeType);
    return {
      text,
      success: true,
      method: 'native'
    };
  } catch (error) {
    console.error(`[DocumentParser] Primary extraction failed for ${mimeType}:`, error);
    
    try {
      if (ocrService.isImageMimeType(mimeType) || mimeType === 'application/pdf') {
        const ocrResult = await ocrService.performOCR(content);
        return {
          text: ocrResult.text,
          success: true,
          method: 'ocr',
          confidence: ocrResult.confidence
        };
      }
    } catch (ocrError) {
      console.error('[DocumentParser] OCR fallback also failed:', ocrError);
    }
    
    try {
      const rawText = content.toString('utf-8');
      const cleanedText = rawText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();
      if (cleanedText.length > 0) {
        return {
          text: cleanedText,
          success: true,
          method: 'fallback',
          error: 'Used raw text fallback after primary extraction failed'
        };
      }
    } catch {}
    
    return {
      text: '',
      success: false,
      method: 'fallback',
      error: error instanceof Error ? error.message : 'Unknown extraction error'
    };
  }
}

export async function extractText(content: Buffer, mimeType: string): Promise<string> {
  if (mimeType === "text/plain") {
    return content.toString("utf-8");
  }
  
  if (mimeType === "text/markdown" || mimeType === "text/md") {
    return content.toString("utf-8");
  }

  if (mimeType === "application/json") {
    try {
      const json = JSON.parse(content.toString("utf-8"));
      return JSON.stringify(json, null, 2);
    } catch {
      return content.toString("utf-8");
    }
  }

  if (mimeType === "text/csv" || mimeType === "text/tab-separated-values") {
    return content.toString("utf-8");
  }

  if (mimeType === "text/html") {
    const html = content.toString("utf-8");
    return sanitizePlainText(html, { maxLen: 5_000_000, collapseWs: true });
  }

  if (mimeType === "application/rtf" || mimeType === "text/rtf") {
    try {
      const text = await officeParser.parseOfficeAsync(content);
      if (text && text.trim().length > 0) {
        return text;
      }
      return content.toString("utf-8").replace(/\\[a-z]+\d*\s?|[{}]/g, " ").replace(/\s+/g, " ").trim();
    } catch (error) {
      console.error("Error parsing RTF:", error);
      return content.toString("utf-8").replace(/\\[a-z]+\d*\s?|[{}]/g, " ").replace(/\s+/g, " ").trim();
    }
  }

  if (ocrService.isImageMimeType(mimeType)) {
    try {
      const ocrResult = await ocrService.extractTextFromImage(content, mimeType);
      return ocrResult.text;
    } catch (error) {
      console.error("Error performing OCR on image:", error);
      throw new Error("Failed to extract text from image");
    }
  }

  if (mimeType === "application/pdf") {
    try {
      // Lazy import para que no crashee el boot por pdf-parse/canvas
      const mod: any = await import("pdf-parse");
      const pdf = mod.default ?? mod;

      const data = await pdf(content);
      const extractedText = data.text || "";

      if (ocrService.isScannedDocument(content, mimeType, extractedText)) {
        try {
          const ocrResult = await ocrService.extractTextWithOCRFallback(
            content,
            mimeType,
            extractedText
          );
          return ocrResult.text;
        } catch (ocrError) {
          console.error("OCR fallback failed for PDF:", ocrError);
          return extractedText;
        }
      }

      return extractedText;
    } catch (error) {
      console.error("Error parsing PDF:", error);
      throw new Error("Failed to parse PDF");
    }
  }


  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    try {
      const result = await mammoth.extractRawText({ buffer: content });
      return result.value;
    } catch (error) {
      console.error("Error parsing DOCX:", error);
      throw new Error("Failed to parse DOCX");
    }
  }

  if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(content);
      
      let text = "";
      workbook.eachSheet((worksheet) => {
        const sheetName = worksheet.name;
        text += `Sheet: ${sheetName}\n`;
        
        worksheet.eachRow({ includeEmpty: false }, (row) => {
          const values: string[] = [];
          row.eachCell({ includeEmpty: true }, (cell) => {
            let cellValue = '';
            if (cell.value === null || cell.value === undefined) {
              cellValue = '';
            } else if (typeof cell.value === 'object') {
              if ('text' in cell.value) {
                cellValue = cell.value.text;
              } else if ('result' in cell.value) {
                cellValue = String(cell.value.result ?? '');
              } else if ('richText' in cell.value) {
                cellValue = cell.value.richText.map((rt: any) => rt.text).join('');
              } else {
                cellValue = cell.text ?? String(cell.value);
              }
            } else {
              cellValue = String(cell.value);
            }
            
            if (cellValue.includes(',') || cellValue.includes('\n') || cellValue.includes('"')) {
              cellValue = '"' + cellValue.replace(/"/g, '""') + '"';
            }
            values.push(cellValue);
          });
          text += values.join(',') + "\n";
        });
        
        text += "\n";
      });
      
      return text.trim();
    } catch (error) {
      console.error("Error parsing XLSX:", error);
      throw new Error("Failed to parse XLSX");
    }
  }

  if (mimeType === "application/vnd.ms-excel") {
    try {
      const workbook = XLSX.read(content, { type: 'buffer' });
      let text = "";
      
      for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        text += `Sheet: ${sheetName}\n`;
        
        const data: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
        for (const row of data) {
          const values = row.map((cell: any) => {
            let cellValue = cell === null || cell === undefined ? '' : String(cell);
            if (cellValue.includes(',') || cellValue.includes('\n') || cellValue.includes('"')) {
              cellValue = '"' + cellValue.replace(/"/g, '""') + '"';
            }
            return cellValue;
          });
          text += values.join(',') + "\n";
        }
        text += "\n";
      }
      
      return text.trim();
    } catch (error) {
      console.error("Error parsing XLS:", error);
      throw new Error("Failed to parse XLS");
    }
  }

  if (mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
      mimeType === "application/vnd.ms-powerpoint") {
    try {
      const text = await officeParser.parseOfficeAsync(content);
      if (!text || text.trim().length === 0) {
        throw new Error("No text extracted from PowerPoint");
      }
      return text;
    } catch (error) {
      console.error("Error parsing PowerPoint:", error);
      throw new Error("Failed to parse PowerPoint");
    }
  }

  return content.toString("utf-8");
}
