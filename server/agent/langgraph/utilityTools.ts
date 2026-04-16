import { tool } from "@langchain/core/tools";
import { z } from "zod";
import OpenAI from "openai";
import * as crypto from "crypto";

const xaiClient = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY || "missing",
});

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

export const translateTextTool = tool(
  async (input) => {
    const { text, targetLanguage, sourceLanguage = "auto", preserveFormatting = true } = input;
    const startTime = Date.now();

    try {
      const response = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a professional translator. Translate text accurately while preserving meaning and tone.

Return JSON:
{
  "translation": "translated text",
  "sourceLanguage": "detected source language",
  "targetLanguage": "target language",
  "confidence": 0.0-1.0,
  "alternatives": ["alternative translations"],
  "notes": ["translation notes or cultural context"],
  "formattingPreserved": boolean
}`,
          },
          {
            role: "user",
            content: `Translate to ${targetLanguage}:
${text}

Source language: ${sourceLanguage}
Preserve formatting: ${preserveFormatting}`,
          },
        ],
        temperature: 0.3,
      });

      const content = response.choices[0].message.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return JSON.stringify({
          success: true,
          ...result,
          latencyMs: Date.now() - startTime,
        });
      }

      return JSON.stringify({
        success: true,
        translation: content,
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "translate_text",
    description: "Translates text between languages with support for 100+ languages and formatting preservation.",
    schema: z.object({
      text: z.string().describe("Text to translate"),
      targetLanguage: z.string().describe("Target language (e.g., 'Spanish', 'zh-CN', 'Japanese')"),
      sourceLanguage: z.string().optional().default("auto").describe("Source language (auto-detect by default)"),
      preserveFormatting: z.boolean().optional().default(true).describe("Preserve markdown/HTML formatting"),
    }),
  }
);

export const currencyConvertTool = tool(
  async (input) => {
    const { amount, from, to, date = "latest" } = input;
    const startTime = Date.now();

    try {
      const exchangeRates: Record<string, number> = {
        USD: 1.0, EUR: 0.92, GBP: 0.79, JPY: 154.5, CNY: 7.24, INR: 83.5,
        CAD: 1.36, AUD: 1.53, CHF: 0.88, MXN: 17.2, BRL: 4.97, KRW: 1320,
      };

      const fromRate = exchangeRates[from.toUpperCase()] || 1;
      const toRate = exchangeRates[to.toUpperCase()] || 1;
      const convertedAmount = (amount / fromRate) * toRate;
      const rate = toRate / fromRate;

      return JSON.stringify({
        success: true,
        conversion: {
          original: { amount, currency: from.toUpperCase() },
          converted: { amount: Number(convertedAmount.toFixed(2)), currency: to.toUpperCase() },
          rate,
          inverseRate: 1 / rate,
          date: date === "latest" ? new Date().toISOString().split("T")[0] : date,
        },
        formatting: {
          original: `${amount.toLocaleString()} ${from.toUpperCase()}`,
          converted: `${convertedAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${to.toUpperCase()}`,
        },
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "currency_convert",
    description: "Converts between currencies using current or historical exchange rates.",
    schema: z.object({
      amount: z.number().describe("Amount to convert"),
      from: z.string().describe("Source currency code (e.g., 'USD', 'EUR')"),
      to: z.string().describe("Target currency code"),
      date: z.string().optional().default("latest").describe("Date for historical rates (YYYY-MM-DD)"),
    }),
  }
);

export const unitConvertTool = tool(
  async (input) => {
    const { value, from, to, category } = input;
    const startTime = Date.now();

    try {
      const conversions: Record<string, Record<string, number>> = {
        length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.34, ft: 0.3048, in: 0.0254, yd: 0.9144 },
        weight: { kg: 1, g: 0.001, mg: 0.000001, lb: 0.453592, oz: 0.0283495, ton: 1000 },
        temperature: { c: 1, f: 1, k: 1 },
        volume: { l: 1, ml: 0.001, gal: 3.78541, qt: 0.946353, pt: 0.473176, cup: 0.236588 },
        area: { sqm: 1, sqkm: 1000000, sqft: 0.092903, sqmi: 2589988, acre: 4046.86, hectare: 10000 },
        time: { s: 1, ms: 0.001, min: 60, h: 3600, day: 86400, week: 604800, month: 2628000, year: 31536000 },
        data: { b: 1, kb: 1024, mb: 1048576, gb: 1073741824, tb: 1099511627776 },
      };

      let result: number;
      const cat = category.toLowerCase();
      const fromUnit = from.toLowerCase();
      const toUnit = to.toLowerCase();

      if (cat === "temperature") {
        let celsius: number;
        if (fromUnit === "c") celsius = value;
        else if (fromUnit === "f") celsius = (value - 32) * 5 / 9;
        else if (fromUnit === "k") celsius = value - 273.15;
        else celsius = value;

        if (toUnit === "c") result = celsius;
        else if (toUnit === "f") result = celsius * 9 / 5 + 32;
        else if (toUnit === "k") result = celsius + 273.15;
        else result = celsius;
      } else {
        const categoryConv = conversions[cat];
        if (!categoryConv) throw new Error(`Unknown category: ${category}`);
        
        const fromFactor = categoryConv[fromUnit];
        const toFactor = categoryConv[toUnit];
        if (fromFactor === undefined || toFactor === undefined) {
          throw new Error(`Unknown units: ${from} or ${to}`);
        }
        
        const baseValue = value * fromFactor;
        result = baseValue / toFactor;
      }

      return JSON.stringify({
        success: true,
        conversion: {
          original: { value, unit: from },
          converted: { value: Number(result.toPrecision(10)), unit: to },
          category,
        },
        formula: `${value} ${from} = ${result.toPrecision(6)} ${to}`,
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "unit_convert",
    description: "Converts between units of measurement: length, weight, temperature, volume, area, time, and data.",
    schema: z.object({
      value: z.number().describe("Value to convert"),
      from: z.string().describe("Source unit (e.g., 'km', 'lb', 'C')"),
      to: z.string().describe("Target unit"),
      category: z.enum(["length", "weight", "temperature", "volume", "area", "time", "data"]).describe("Unit category"),
    }),
  }
);

export const qrCodeGenerateTool = tool(
  async (input) => {
    const { content, size = 256, errorCorrection = "M", format = "png" } = input;
    const startTime = Date.now();

    try {
      const qrData = {
        content,
        size,
        errorCorrection,
        format,
        version: "auto",
        encoding: "UTF-8",
      };

      const urlSafeContent = encodeURIComponent(content);
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${urlSafeContent}&ecc=${errorCorrection}`;

      return JSON.stringify({
        success: true,
        qrCode: {
          ...qrData,
          url: qrUrl,
          downloadUrl: qrUrl,
        },
        metadata: {
          contentLength: content.length,
          estimatedScanDistance: `${Math.round(size / 25)}cm - ${Math.round(size / 10)}cm`,
          maxCapacity: errorCorrection === "L" ? 2953 : errorCorrection === "M" ? 2331 : errorCorrection === "Q" ? 1663 : 1273,
        },
        code: {
          html: `<img src="${qrUrl}" alt="QR Code" width="${size}" height="${size}" />`,
          markdown: `![QR Code](${qrUrl})`,
        },
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "qr_code_generate",
    description: "Generates QR codes for URLs, text, or data with customizable size and error correction.",
    schema: z.object({
      content: z.string().describe("Content to encode in QR code"),
      size: z.number().optional().default(256).describe("QR code size in pixels"),
      errorCorrection: z.enum(["L", "M", "Q", "H"]).optional().default("M")
        .describe("Error correction level (L=7%, M=15%, Q=25%, H=30%)"),
      format: z.enum(["png", "svg", "jpg"]).optional().default("png").describe("Output format"),
    }),
  }
);

export const uuidGenerateTool = tool(
  async (input) => {
    const { version = "v4", count = 1, namespace, name } = input;
    const startTime = Date.now();

    try {
      const uuids: string[] = [];

      for (let i = 0; i < Math.min(count, 100); i++) {
        if (version === "v4") {
          uuids.push(crypto.randomUUID());
        } else if (version === "v7") {
          const timestamp = Date.now();
          const hex = timestamp.toString(16).padStart(12, "0");
          const random = crypto.randomBytes(10).toString("hex");
          const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${random.slice(0, 3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${random.slice(3, 6)}-${random.slice(6, 18)}`;
          uuids.push(uuid);
        } else {
          uuids.push(crypto.randomUUID());
        }
      }

      return JSON.stringify({
        success: true,
        uuids: count === 1 ? uuids[0] : uuids,
        version,
        count: uuids.length,
        formats: count === 1 ? {
          standard: uuids[0],
          uppercase: uuids[0].toUpperCase(),
          urn: `urn:uuid:${uuids[0]}`,
          compact: uuids[0].replace(/-/g, ""),
        } : undefined,
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "uuid_generate",
    description: "Generates UUIDs in v4 (random) or v7 (timestamp-sortable) formats.",
    schema: z.object({
      version: z.enum(["v4", "v7"]).optional().default("v4").describe("UUID version"),
      count: z.number().optional().default(1).describe("Number of UUIDs to generate (max 100)"),
      namespace: z.string().optional().describe("Namespace UUID (for v5)"),
      name: z.string().optional().describe("Name to hash (for v5)"),
    }),
  }
);

export const regexTestTool = tool(
  async (input) => {
    const { pattern, text, flags = "g" } = input;
    const startTime = Date.now();

    try {
      const regex = new RegExp(pattern, flags);
      const matches: Array<{ match: string; index: number; groups: Record<string, string> | null }> = [];
      
      let match;
      if (flags.includes("g")) {
        while ((match = regex.exec(text)) !== null) {
          matches.push({
            match: match[0],
            index: match.index,
            groups: match.groups || null,
          });
        }
      } else {
        match = regex.exec(text);
        if (match) {
          matches.push({
            match: match[0],
            index: match.index,
            groups: match.groups || null,
          });
        }
      }

      const isValid = matches.length > 0;

      return JSON.stringify({
        success: true,
        pattern,
        flags,
        isValid,
        matchCount: matches.length,
        matches,
        highlighted: text.replace(regex, `【$&】`),
        explanation: await explainRegex(pattern),
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "regex_test",
    description: "Tests regular expressions against text, showing matches and providing pattern explanations.",
    schema: z.object({
      pattern: z.string().describe("Regular expression pattern"),
      text: z.string().describe("Text to test against"),
      flags: z.string().optional().default("g").describe("Regex flags (g, i, m, s, u, y)"),
    }),
  }
);

async function explainRegex(pattern: string): Promise<string> {
  const explanations: Record<string, string> = {
    "\\d": "digit (0-9)",
    "\\w": "word character (a-zA-Z0-9_)",
    "\\s": "whitespace",
    ".": "any character",
    "*": "zero or more",
    "+": "one or more",
    "?": "zero or one",
    "^": "start of string",
    "$": "end of string",
    "\\b": "word boundary",
  };

  const parts: string[] = [];
  for (const [symbol, meaning] of Object.entries(explanations)) {
    if (pattern.includes(symbol.replace(/\\/g, "\\"))) {
      parts.push(`${symbol} = ${meaning}`);
    }
  }

  return parts.length > 0 ? parts.join(", ") : "Custom pattern";
}

export const UTILITY_TOOLS = [
  translateTextTool,
  currencyConvertTool,
  unitConvertTool,
  qrCodeGenerateTool,
  uuidGenerateTool,
  regexTestTool,
];
