import Tesseract from "tesseract.js";
import OpenAI from "openai";
import type { FileParser, ParsedResult, DetectedFileType } from "./base";

const openai = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY || "missing"
});

export class ImageParser implements FileParser {
  name = "image";
  supportedMimeTypes = [
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/gif",
    "image/bmp",
    "image/webp",
    "image/tiff",
  ];

  async parse(content: Buffer, type: DetectedFileType): Promise<ParsedResult> {
    // Try AI Vision first for better accuracy
    try {
      const base64Image = content.toString("base64");
      const mimeType = type.mimeType || "image/png";

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

      try {
        const response = await openai.chat.completions.create({
          model: "grok-2-vision-1212",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${mimeType};base64,${base64Image}`,
                  },
                },
                {
                  type: "text",
                  text: "Extrae TODO el texto visible en esta imagen. Si hay tablas, mantenlas formateadas. Si hay fórmulas matemáticas, escríbelas en formato LaTeX. Devuelve SOLO el texto extraído, sin comentarios adicionales.",
                },
              ],
            },
          ],
          max_tokens: 4096,
        }, { signal: controller.signal });

        clearTimeout(timeoutId);

        const text = response.choices[0]?.message?.content?.trim() || "";

        if (text && text.length > 0) {
          return {
            text,
            metadata: {
              method: "ai-vision",
              model: "grok-2-vision-1212",
            },
          };
        }
      } catch (innerError: any) {
        clearTimeout(timeoutId);
        if (innerError.name === 'AbortError') {
          console.error("AI Vision OCR timed out after 30 seconds");
        } else {
          throw innerError;
        }
      }
    } catch (error) {
      console.error("AI Vision OCR failed, falling back to Tesseract:", error);
    }

    // Fallback to Tesseract with robust error handling
    try {
      if (!content || content.length === 0) {
        return {
          text: "",
          warnings: ["Imagen vacía o inválida"],
        };
      }

      const result = await Tesseract.recognize(content, "spa+eng", {
        logger: () => { },
      });

      const text = result?.data?.text?.trim() || "";

      if (!text || text.length === 0) {
        return {
          text: "",
          warnings: ["No se detectó texto en la imagen"],
        };
      }

      return {
        text,
        metadata: {
          method: "tesseract",
          confidence: result.data.confidence,
        },
      };
    } catch (error: any) {
      console.error("Error parsing image with OCR:", error?.message || error);
      return {
        text: "",
        warnings: ["No se pudo extraer texto de la imagen: " + (error?.message || "Error de OCR")],
      };
    }
  }
}
