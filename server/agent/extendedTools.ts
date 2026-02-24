/**
 * Extended Tools for IliaGPT
 * 
 * Additional utility tools for everyday tasks:
 * - Calculator
 * - Date/Time operations
 * - Text processing (translate, summarize)
 * - Code execution (Python)
 * - QR code generation
 * - URL shortener
 * - Unit converter
 */

import { z } from "zod";
import { ToolDefinition, ToolResult, createArtifact, createError } from "./toolTypes";
import { randomUUID } from "crypto";
import { evaluateSafeMathExpression, type MathFunctionRegistry } from "../lib/mathExpressionEvaluator";
import {
    getGmailClientForUser,
    gmailSearch,
    gmailFetchThread,
    gmailSend,
    gmailMarkRead,
} from "../integrations/gmailApi";
import { whatsappWebManager } from "../integrations/whatsappWeb";
import { chunkText } from "../integrations/whatsappWebAutoReply";
import { storage } from "../storage";

// ============================================================================
// CALCULATOR TOOL
// ============================================================================

const calculatorSchema = z.object({
    expression: z.string().describe("Mathematical expression to evaluate (e.g., '2 + 2 * 3', 'sqrt(16)', 'sin(pi/2)')"),
    precision: z.number().min(0).max(15).default(6).describe("Decimal precision for the result"),
});

const CALCULATOR_FUNCTIONS: MathFunctionRegistry = {
    sqrt: { fn: Math.sqrt, minArity: 1, maxArity: 1 },
    sin: { fn: Math.sin, minArity: 1, maxArity: 1 },
    cos: { fn: Math.cos, minArity: 1, maxArity: 1 },
    tan: { fn: Math.tan, minArity: 1, maxArity: 1 },
    asin: { fn: Math.asin, minArity: 1, maxArity: 1 },
    acos: { fn: Math.acos, minArity: 1, maxArity: 1 },
    atan: { fn: Math.atan, minArity: 1, maxArity: 1 },
    log: { fn: Math.log, minArity: 1, maxArity: 1 },
    log10: { fn: Math.log10, minArity: 1, maxArity: 1 },
    log2: { fn: Math.log2, minArity: 1, maxArity: 1 },
    exp: { fn: Math.exp, minArity: 1, maxArity: 1 },
    abs: { fn: Math.abs, minArity: 1, maxArity: 1 },
    floor: { fn: Math.floor, minArity: 1, maxArity: 1 },
    ceil: { fn: Math.ceil, minArity: 1, maxArity: 1 },
    round: { fn: Math.round, minArity: 1, maxArity: 1 },
    pow: { fn: Math.pow, minArity: 2, maxArity: 2 },
    min: { fn: Math.min, minArity: 1 },
    max: { fn: Math.max, minArity: 1 },
};

const CALCULATOR_CONSTANTS: Record<string, number> = {
    pi: Math.PI,
    PI: Math.PI,
    e: Math.E,
    E: Math.E,
};

export const calculatorTool: ToolDefinition = {
    name: "calculator",
    description: "Evaluate mathematical expressions. Supports basic operations (+, -, *, /, ^), functions (sqrt, sin, cos, tan, log, exp, abs), and constants (pi, e).",
    inputSchema: calculatorSchema,
    capabilities: [],
    execute: async (input, context): Promise<ToolResult> => {
        const startTime = Date.now();
        try {
            const normalized = input.expression.normalize("NFC").trim();
            if (!normalized) {
                throw new Error("Expression cannot be empty");
            }

            const result = evaluateSafeMathExpression(normalized.replace(/\^/g, "**"), {
                functions: CALCULATOR_FUNCTIONS,
                constants: CALCULATOR_CONSTANTS,
                maxExpressionLength: 2048,
                maxTokenCount: 512,
                maxDepth: 64,
                maxOperations: 256,
            });

            const roundedResult = Number(result.toFixed(input.precision));

            return {
                success: true,
                output: {
                    expression: input.expression,
                    result: roundedResult,
                    formatted: roundedResult.toLocaleString(),
                },
                artifacts: [],
                previews: [{
                    type: "text",
                    content: `${input.expression} = **${roundedResult}**`,
                    title: "Calculation Result",
                }],
                logs: [],
                metrics: { durationMs: Date.now() - startTime },
            };
        } catch (error: any) {
            return {
                success: false,
                output: null,
                error: createError("CALC_ERROR", `Failed to evaluate: ${error.message}`, false),
                artifacts: [],
                previews: [],
                logs: [],
                metrics: { durationMs: Date.now() - startTime },
            };
        }
    },
};

// ============================================================================
// DATE/TIME TOOL
// ============================================================================

const dateTimeSchema = z.object({
    operation: z.enum(["now", "format", "parse", "diff", "add", "convert_timezone"]).describe("Operation to perform"),
    date: z.string().optional().describe("Date string to process (for parse/format/diff/add)"),
    date2: z.string().optional().describe("Second date for diff operation"),
    format: z.string().optional().describe("Output format (e.g., 'YYYY-MM-DD', 'DD/MM/YYYY HH:mm')"),
    timezone: z.string().optional().describe("Target timezone (e.g., 'America/New_York', 'Europe/London')"),
    amount: z.number().optional().describe("Amount to add (for add operation)"),
    unit: z.enum(["days", "hours", "minutes", "weeks", "months", "years"]).optional().describe("Unit for add operation"),
});

export const dateTimeTool: ToolDefinition = {
    name: "datetime",
    description: "Perform date and time operations: get current time, format dates, calculate differences, add/subtract time, convert timezones.",
    inputSchema: dateTimeSchema,
    capabilities: [],
    execute: async (input, context): Promise<ToolResult> => {
        const startTime = Date.now();
        try {
            let result: any = {};

            switch (input.operation) {
                case "now": {
                    const now = new Date();
                    result = {
                        iso: now.toISOString(),
                        utc: now.toUTCString(),
                        local: now.toLocaleString(),
                        timestamp: now.getTime(),
                        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    };
                    break;
                }

                case "format": {
                    if (!input.date) throw new Error("Date is required for format operation");
                    const date = new Date(input.date);
                    if (isNaN(date.getTime())) throw new Error("Invalid date");
                    
                    const formatStr = input.format || 'YYYY-MM-DD HH:mm:ss';
                    const formatted = formatStr
                        .replace('YYYY', date.getFullYear().toString())
                        .replace('MM', (date.getMonth() + 1).toString().padStart(2, '0'))
                        .replace('DD', date.getDate().toString().padStart(2, '0'))
                        .replace('HH', date.getHours().toString().padStart(2, '0'))
                        .replace('mm', date.getMinutes().toString().padStart(2, '0'))
                        .replace('ss', date.getSeconds().toString().padStart(2, '0'));
                    
                    result = { original: input.date, formatted, format: formatStr };
                    break;
                }

                case "parse": {
                    if (!input.date) throw new Error("Date is required for parse operation");
                    const date = new Date(input.date);
                    if (isNaN(date.getTime())) throw new Error("Invalid date format");
                    
                    result = {
                        input: input.date,
                        iso: date.toISOString(),
                        year: date.getFullYear(),
                        month: date.getMonth() + 1,
                        day: date.getDate(),
                        hour: date.getHours(),
                        minute: date.getMinutes(),
                        second: date.getSeconds(),
                        dayOfWeek: date.toLocaleDateString('en-US', { weekday: 'long' }),
                        timestamp: date.getTime(),
                    };
                    break;
                }

                case "diff": {
                    if (!input.date || !input.date2) throw new Error("Two dates are required for diff operation");
                    const date1 = new Date(input.date);
                    const date2 = new Date(input.date2);
                    if (isNaN(date1.getTime()) || isNaN(date2.getTime())) throw new Error("Invalid date");
                    
                    const diffMs = date2.getTime() - date1.getTime();
                    result = {
                        date1: date1.toISOString(),
                        date2: date2.toISOString(),
                        difference: {
                            milliseconds: diffMs,
                            seconds: Math.floor(diffMs / 1000),
                            minutes: Math.floor(diffMs / 60000),
                            hours: Math.floor(diffMs / 3600000),
                            days: Math.floor(diffMs / 86400000),
                            weeks: Math.floor(diffMs / 604800000),
                        },
                        human: formatDuration(diffMs),
                    };
                    break;
                }

                case "add": {
                    if (!input.date) throw new Error("Date is required for add operation");
                    if (input.amount === undefined) throw new Error("Amount is required for add operation");
                    if (!input.unit) throw new Error("Unit is required for add operation");
                    
                    const date = new Date(input.date);
                    if (isNaN(date.getTime())) throw new Error("Invalid date");
                    
                    const msMap: Record<string, number> = {
                        minutes: 60000,
                        hours: 3600000,
                        days: 86400000,
                        weeks: 604800000,
                    };

                    if (input.unit === 'months') {
                        date.setMonth(date.getMonth() + input.amount);
                    } else if (input.unit === 'years') {
                        date.setFullYear(date.getFullYear() + input.amount);
                    } else {
                        date.setTime(date.getTime() + input.amount * msMap[input.unit]);
                    }
                    
                    result = {
                        original: input.date,
                        added: `${input.amount} ${input.unit}`,
                        result: date.toISOString(),
                        formatted: date.toLocaleString(),
                    };
                    break;
                }

                case "convert_timezone": {
                    if (!input.date) throw new Error("Date is required for timezone conversion");
                    if (!input.timezone) throw new Error("Target timezone is required");
                    
                    const date = new Date(input.date);
                    if (isNaN(date.getTime())) throw new Error("Invalid date");
                    
                    const formatted = date.toLocaleString('en-US', { timeZone: input.timezone });
                    
                    result = {
                        original: input.date,
                        timezone: input.timezone,
                        converted: formatted,
                        iso: new Date(formatted).toISOString(),
                    };
                    break;
                }
            }

            return {
                success: true,
                output: result,
                artifacts: [],
                previews: [{
                    type: "text",
                    content: JSON.stringify(result, null, 2),
                    title: `DateTime: ${input.operation}`,
                }],
                logs: [],
                metrics: { durationMs: Date.now() - startTime },
            };
        } catch (error: any) {
            return {
                success: false,
                output: null,
                error: createError("DATETIME_ERROR", error.message, false),
                artifacts: [],
                previews: [],
                logs: [],
                metrics: { durationMs: Date.now() - startTime },
            };
        }
    },
};

function formatDuration(ms: number): string {
    const abs = Math.abs(ms);
    const days = Math.floor(abs / 86400000);
    const hours = Math.floor((abs % 86400000) / 3600000);
    const minutes = Math.floor((abs % 3600000) / 60000);
    
    const parts = [];
    if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
    if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
    if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
    
    const result = parts.join(', ') || '0 minutes';
    return ms < 0 ? `-${result}` : result;
}

// ============================================================================
// UNIT CONVERTER TOOL
// ============================================================================

const unitConverterSchema = z.object({
    value: z.number().describe("Value to convert"),
    from: z.string().describe("Source unit (e.g., 'km', 'miles', 'kg', 'lb', 'celsius', 'fahrenheit')"),
    to: z.string().describe("Target unit"),
});

export const unitConverterTool: ToolDefinition = {
    name: "convert_units",
    description: "Convert between units of measurement. Supports length, weight, temperature, volume, area, speed, and data storage units.",
    inputSchema: unitConverterSchema,
    capabilities: [],
    execute: async (input, context): Promise<ToolResult> => {
        const startTime = Date.now();
        try {
            // Conversion tables (all relative to a base unit)
            const conversions: Record<string, Record<string, number | ((v: number) => number)>> = {
                // Length (base: meter)
                length: {
                    m: 1, meter: 1, meters: 1,
                    km: 1000, kilometer: 1000, kilometers: 1000,
                    cm: 0.01, centimeter: 0.01, centimeters: 0.01,
                    mm: 0.001, millimeter: 0.001, millimeters: 0.001,
                    mi: 1609.344, mile: 1609.344, miles: 1609.344,
                    yd: 0.9144, yard: 0.9144, yards: 0.9144,
                    ft: 0.3048, foot: 0.3048, feet: 0.3048,
                    in: 0.0254, inch: 0.0254, inches: 0.0254,
                    nm: 1852, nauticalmile: 1852,
                },
                // Weight (base: kilogram)
                weight: {
                    kg: 1, kilogram: 1, kilograms: 1,
                    g: 0.001, gram: 0.001, grams: 0.001,
                    mg: 0.000001, milligram: 0.000001,
                    lb: 0.453592, pound: 0.453592, pounds: 0.453592,
                    oz: 0.0283495, ounce: 0.0283495, ounces: 0.0283495,
                    ton: 1000, tons: 1000,
                    tonne: 1000, tonnes: 1000,
                },
                // Volume (base: liter)
                volume: {
                    l: 1, liter: 1, liters: 1, litre: 1, litres: 1,
                    ml: 0.001, milliliter: 0.001, milliliters: 0.001,
                    gal: 3.78541, gallon: 3.78541, gallons: 3.78541,
                    qt: 0.946353, quart: 0.946353, quarts: 0.946353,
                    pt: 0.473176, pint: 0.473176, pints: 0.473176,
                    cup: 0.236588, cups: 0.236588,
                    floz: 0.0295735, fluidounce: 0.0295735,
                    tbsp: 0.0147868, tablespoon: 0.0147868,
                    tsp: 0.00492892, teaspoon: 0.00492892,
                },
                // Data (base: byte)
                data: {
                    b: 1, byte: 1, bytes: 1,
                    kb: 1024, kilobyte: 1024, kilobytes: 1024,
                    mb: 1048576, megabyte: 1048576, megabytes: 1048576,
                    gb: 1073741824, gigabyte: 1073741824, gigabytes: 1073741824,
                    tb: 1099511627776, terabyte: 1099511627776, terabytes: 1099511627776,
                    bit: 0.125, bits: 0.125,
                    kbit: 128, kilobit: 128,
                    mbit: 131072, megabit: 131072,
                    gbit: 134217728, gigabit: 134217728,
                },
                // Speed (base: m/s)
                speed: {
                    'mps': 1, 'm/s': 1,
                    'kph': 0.277778, 'km/h': 0.277778, 'kmh': 0.277778,
                    'mph': 0.44704,
                    'knot': 0.514444, 'knots': 0.514444,
                    'fps': 0.3048, 'ft/s': 0.3048,
                },
            };

            // Temperature is special
            const tempConvert: Record<string, { toBase: (v: number) => number, fromBase: (v: number) => number }> = {
                celsius: { toBase: (v) => v, fromBase: (v) => v },
                c: { toBase: (v) => v, fromBase: (v) => v },
                fahrenheit: { toBase: (v) => (v - 32) * 5/9, fromBase: (v) => v * 9/5 + 32 },
                f: { toBase: (v) => (v - 32) * 5/9, fromBase: (v) => v * 9/5 + 32 },
                kelvin: { toBase: (v) => v - 273.15, fromBase: (v) => v + 273.15 },
                k: { toBase: (v) => v - 273.15, fromBase: (v) => v + 273.15 },
            };

            const fromLower = input.from.toLowerCase();
            const toLower = input.to.toLowerCase();

            // Check temperature first
            if (tempConvert[fromLower] && tempConvert[toLower]) {
                const baseValue = tempConvert[fromLower].toBase(input.value);
                const result = tempConvert[toLower].fromBase(baseValue);
                return {
                    success: true,
                    output: {
                        value: input.value,
                        from: input.from,
                        to: input.to,
                        result: Math.round(result * 1000) / 1000,
                        category: "temperature",
                    },
                    artifacts: [],
                    previews: [{
                        type: "text",
                        content: `${input.value} ${input.from} = **${Math.round(result * 1000) / 1000} ${input.to}**`,
                        title: "Conversion Result",
                    }],
                    logs: [],
                    metrics: { durationMs: Date.now() - startTime },
                };
            }

            // Find category and convert
            for (const [category, units] of Object.entries(conversions)) {
                const fromFactor = units[fromLower];
                const toFactor = units[toLower];
                
                if (fromFactor !== undefined && toFactor !== undefined) {
                    const baseValue = input.value * (fromFactor as number);
                    const result = baseValue / (toFactor as number);
                    
                    return {
                        success: true,
                        output: {
                            value: input.value,
                            from: input.from,
                            to: input.to,
                            result: Math.round(result * 1000000) / 1000000,
                            category,
                        },
                        artifacts: [],
                        previews: [{
                            type: "text",
                            content: `${input.value} ${input.from} = **${Math.round(result * 1000000) / 1000000} ${input.to}**`,
                            title: "Conversion Result",
                        }],
                        logs: [],
                        metrics: { durationMs: Date.now() - startTime },
                    };
                }
            }

            throw new Error(`Cannot convert from "${input.from}" to "${input.to}". Units may be incompatible or not supported.`);
        } catch (error: any) {
            return {
                success: false,
                output: null,
                error: createError("CONVERSION_ERROR", error.message, false),
                artifacts: [],
                previews: [],
                logs: [],
                metrics: { durationMs: Date.now() - startTime },
            };
        }
    },
};

// ============================================================================
// QR CODE GENERATOR TOOL
// ============================================================================

const qrCodeSchema = z.object({
    content: z.string().describe("Content to encode in the QR code (URL, text, etc.)"),
    size: z.number().min(100).max(1000).default(300).describe("Size in pixels"),
    format: z.enum(["svg", "png"]).default("svg").describe("Output format"),
});

export const qrCodeTool: ToolDefinition = {
    name: "generate_qr",
    description: "Generate a QR code from text, URL, or other content.",
    inputSchema: qrCodeSchema,
    capabilities: ["produces_artifacts"],
    execute: async (input, context): Promise<ToolResult> => {
        const startTime = Date.now();
        try {
            // Use Google Charts API for QR generation (free, no dependencies)
            const encodedContent = encodeURIComponent(input.content);
            const qrUrl = `https://chart.googleapis.com/chart?cht=qr&chs=${input.size}x${input.size}&chl=${encodedContent}&choe=UTF-8`;

            if (input.format === "svg") {
                // Return as URL for SVG display
                return {
                    success: true,
                    output: {
                        content: input.content,
                        size: input.size,
                        format: "svg",
                        url: qrUrl,
                    },
                    artifacts: [
                        createArtifact("image", "qr_code.png", { url: qrUrl }, "image/png", qrUrl),
                    ],
                    previews: [{
                        type: "image",
                        content: qrUrl,
                        title: "QR Code",
                    }],
                    logs: [],
                    metrics: { durationMs: Date.now() - startTime },
                };
            }

            // Fetch PNG
            const response = await fetch(qrUrl);
            if (!response.ok) throw new Error("Failed to generate QR code");
            
            const buffer = await response.arrayBuffer();
            const base64 = Buffer.from(buffer).toString('base64');

            return {
                success: true,
                output: {
                    content: input.content,
                    size: input.size,
                    format: "png",
                },
                artifacts: [
                    createArtifact("image", "qr_code.png", { base64, mimeType: "image/png" }, "image/png"),
                ],
                previews: [{
                    type: "image",
                    content: `data:image/png;base64,${base64}`,
                    title: "QR Code",
                }],
                logs: [],
                metrics: { durationMs: Date.now() - startTime },
            };
        } catch (error: any) {
            return {
                success: false,
                output: null,
                error: createError("QR_ERROR", error.message, true),
                artifacts: [],
                previews: [],
                logs: [],
                metrics: { durationMs: Date.now() - startTime },
            };
        }
    },
};

// ============================================================================
// TEXT PROCESSING TOOL
// ============================================================================

const textProcessSchema = z.object({
    operation: z.enum(["word_count", "char_count", "extract_emails", "extract_urls", "extract_numbers", "to_uppercase", "to_lowercase", "to_titlecase", "remove_duplicates", "sort_lines", "reverse", "base64_encode", "base64_decode", "hash_md5", "hash_sha256"]).describe("Text operation to perform"),
    text: z.string().describe("Text to process"),
});

export const textProcessTool: ToolDefinition = {
    name: "text_process",
    description: "Process and transform text: count words/chars, extract emails/URLs/numbers, change case, sort, encode/decode, hash.",
    inputSchema: textProcessSchema,
    capabilities: [],
    execute: async (input, context): Promise<ToolResult> => {
        const startTime = Date.now();
        try {
            let result: any = {};

            switch (input.operation) {
                case "word_count": {
                    const words = input.text.trim().split(/\s+/).filter(w => w.length > 0);
                    result = { wordCount: words.length, uniqueWords: new Set(words.map(w => w.toLowerCase())).size };
                    break;
                }

                case "char_count": {
                    result = {
                        total: input.text.length,
                        withoutSpaces: input.text.replace(/\s/g, '').length,
                        letters: (input.text.match(/[a-zA-Z]/g) || []).length,
                        digits: (input.text.match(/\d/g) || []).length,
                        lines: input.text.split('\n').length,
                    };
                    break;
                }

                case "extract_emails": {
                    const emails = input.text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
                    result = { emails, count: emails.length };
                    break;
                }

                case "extract_urls": {
                    const urls = input.text.match(/https?:\/\/[^\s<>"{}|\\^`\[\]]+/g) || [];
                    result = { urls, count: urls.length };
                    break;
                }

                case "extract_numbers": {
                    const numbers = input.text.match(/-?\d+\.?\d*/g) || [];
                    result = { numbers: numbers.map(n => parseFloat(n)), count: numbers.length };
                    break;
                }

                case "to_uppercase":
                    result = { output: input.text.toUpperCase() };
                    break;

                case "to_lowercase":
                    result = { output: input.text.toLowerCase() };
                    break;

                case "to_titlecase":
                    result = { output: input.text.replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase()) };
                    break;

                case "remove_duplicates": {
                    const lines = input.text.split('\n');
                    const unique = Array.from(new Set(lines));
                    result = { output: unique.join('\n'), originalLines: lines.length, uniqueLines: unique.length };
                    break;
                }

                case "sort_lines": {
                    const lines = input.text.split('\n').sort();
                    result = { output: lines.join('\n') };
                    break;
                }

                case "reverse":
                    result = { output: input.text.split('').reverse().join('') };
                    break;

                case "base64_encode":
                    result = { output: Buffer.from(input.text).toString('base64') };
                    break;

                case "base64_decode":
                    result = { output: Buffer.from(input.text, 'base64').toString('utf-8') };
                    break;

                case "hash_md5": {
                    const crypto = await import('crypto');
                    result = { hash: crypto.createHash('md5').update(input.text).digest('hex'), algorithm: 'md5' };
                    break;
                }

                case "hash_sha256": {
                    const crypto = await import('crypto');
                    result = { hash: crypto.createHash('sha256').update(input.text).digest('hex'), algorithm: 'sha256' };
                    break;
                }
            }

            return {
                success: true,
                output: result,
                artifacts: [],
                previews: [{
                    type: "text",
                    content: JSON.stringify(result, null, 2),
                    title: `Text: ${input.operation}`,
                }],
                logs: [],
                metrics: { durationMs: Date.now() - startTime },
            };
        } catch (error: any) {
            return {
                success: false,
                output: null,
                error: createError("TEXT_ERROR", error.message, false),
                artifacts: [],
                previews: [],
                logs: [],
                metrics: { durationMs: Date.now() - startTime },
            };
        }
    },
};

// ============================================================================
// JSON TOOL
// ============================================================================

const jsonToolSchema = z.object({
    operation: z.enum(["parse", "stringify", "format", "minify", "validate", "query"]).describe("JSON operation"),
    input: z.string().describe("JSON string or data"),
    query: z.string().optional().describe("JSONPath query (for query operation, e.g., '$.users[0].name')"),
    indent: z.number().min(0).max(8).default(2).describe("Indentation for format operation"),
});

export const jsonTool: ToolDefinition = {
    name: "json",
    description: "Parse, format, validate, and query JSON data.",
    inputSchema: jsonToolSchema,
    capabilities: [],
    execute: async (input, context): Promise<ToolResult> => {
        const startTime = Date.now();
        try {
            let result: any = {};

            switch (input.operation) {
                case "parse":
                case "validate": {
                    try {
                        const parsed = JSON.parse(input.input);
                        result = {
                            valid: true,
                            type: Array.isArray(parsed) ? 'array' : typeof parsed,
                            data: parsed,
                        };
                    } catch (e: any) {
                        result = { valid: false, error: e.message };
                    }
                    break;
                }

                case "stringify": {
                    const data = typeof input.input === 'string' ? JSON.parse(input.input) : input.input;
                    result = { output: JSON.stringify(data) };
                    break;
                }

                case "format": {
                    const parsed = JSON.parse(input.input);
                    result = { output: JSON.stringify(parsed, null, input.indent) };
                    break;
                }

                case "minify": {
                    const parsed = JSON.parse(input.input);
                    const minified = JSON.stringify(parsed);
                    result = {
                        output: minified,
                        originalSize: input.input.length,
                        minifiedSize: minified.length,
                        savings: `${Math.round((1 - minified.length / input.input.length) * 100)}%`,
                    };
                    break;
                }

                case "query": {
                    if (!input.query) throw new Error("Query is required for query operation");
                    const parsed = JSON.parse(input.input);
                    // Simple JSONPath implementation
                    const path = input.query.replace(/^\$\.?/, '').split('.');
                    let current = parsed;
                    for (const segment of path) {
                        if (current === undefined) break;
                        const match = segment.match(/^(\w+)\[(\d+)\]$/);
                        if (match) {
                            current = current[match[1]]?.[parseInt(match[2])];
                        } else {
                            current = current[segment];
                        }
                    }
                    result = { query: input.query, result: current };
                    break;
                }
            }

            return {
                success: true,
                output: result,
                artifacts: [],
                previews: [{
                    type: "text",
                    content: typeof result.output === 'string' ? result.output : JSON.stringify(result, null, 2),
                    title: `JSON: ${input.operation}`,
                }],
                logs: [],
                metrics: { durationMs: Date.now() - startTime },
            };
        } catch (error: any) {
            return {
                success: false,
                output: null,
                error: createError("JSON_ERROR", error.message, false),
                artifacts: [],
                previews: [],
                logs: [],
                metrics: { durationMs: Date.now() - startTime },
            };
        }
    },
};

// ============================================================================
// RANDOM GENERATOR TOOL
// ============================================================================

const randomGenSchema = z.object({
    type: z.enum(["uuid", "number", "password", "color", "name", "lorem"]).describe("Type of random data to generate"),
    count: z.number().min(1).max(100).default(1).describe("Number of items to generate"),
    min: z.number().optional().describe("Minimum value (for number type)"),
    max: z.number().optional().describe("Maximum value (for number type)"),
    length: z.number().min(4).max(128).default(16).describe("Length (for password type)"),
    includeSymbols: z.boolean().default(true).describe("Include symbols in password"),
});

export const randomGenTool: ToolDefinition = {
    name: "random",
    description: "Generate random data: UUIDs, numbers, passwords, colors, names, lorem ipsum text.",
    inputSchema: randomGenSchema,
    capabilities: [],
    execute: async (input, context): Promise<ToolResult> => {
        const startTime = Date.now();
        try {
            const results: any[] = [];

            for (let i = 0; i < input.count; i++) {
                switch (input.type) {
                    case "uuid":
                        results.push(randomUUID());
                        break;

                    case "number": {
                        const min = input.min ?? 0;
                        const max = input.max ?? 100;
                        results.push(Math.floor(Math.random() * (max - min + 1)) + min);
                        break;
                    }

                    case "password": {
                        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
                        const symbols = input.includeSymbols ? '!@#$%^&*()_+-=[]{}|;:,.<>?' : '';
                        const all = chars + symbols;
                        let password = '';
                        for (let j = 0; j < input.length; j++) {
                            password += all.charAt(Math.floor(Math.random() * all.length));
                        }
                        results.push(password);
                        break;
                    }

                    case "color": {
                        const hex = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
                        const r = parseInt(hex.slice(1, 3), 16);
                        const g = parseInt(hex.slice(3, 5), 16);
                        const b = parseInt(hex.slice(5, 7), 16);
                        results.push({ hex, rgb: `rgb(${r}, ${g}, ${b})` });
                        break;
                    }

                    case "name": {
                        const firstNames = ['Ana', 'Carlos', 'María', 'Juan', 'Laura', 'Pedro', 'Sofía', 'Diego', 'Elena', 'Miguel'];
                        const lastNames = ['García', 'Rodríguez', 'Martínez', 'López', 'Hernández', 'González', 'Pérez', 'Sánchez'];
                        const first = firstNames[Math.floor(Math.random() * firstNames.length)];
                        const last = lastNames[Math.floor(Math.random() * lastNames.length)];
                        results.push(`${first} ${last}`);
                        break;
                    }

                    case "lorem": {
                        const words = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit', 'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore', 'magna', 'aliqua'];
                        const sentence = Array.from({ length: 10 + Math.floor(Math.random() * 10) }, () => words[Math.floor(Math.random() * words.length)]).join(' ');
                        results.push(sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.');
                        break;
                    }
                }
            }

            return {
                success: true,
                output: { type: input.type, count: input.count, results },
                artifacts: [],
                previews: [{
                    type: "text",
                    content: results.map((r, i) => `${i + 1}. ${typeof r === 'object' ? JSON.stringify(r) : r}`).join('\n'),
                    title: `Random ${input.type}`,
                }],
                logs: [],
                metrics: { durationMs: Date.now() - startTime },
            };
        } catch (error: any) {
            return {
                success: false,
                output: null,
                error: createError("RANDOM_ERROR", error.message, false),
                artifacts: [],
                previews: [],
                logs: [],
                metrics: { durationMs: Date.now() - startTime },
            };
        }
    },
};

// ============================================================================
// GMAIL TOOLS (REAL)
// ============================================================================

const gmailSearchSchema = z.object({
    query: z.string().min(1).describe("Gmail search query (e.g. 'is:unread')"),
    maxResults: z.number().int().min(1).max(50).default(20).optional(),
});

const gmailSearchTool: ToolDefinition = {
    name: "gmail_search",
    description: "Search emails in Gmail using a query (e.g., is:unread, from:someone, subject:keyword).",
    inputSchema: gmailSearchSchema,
    capabilities: ["accesses_external_api"],
    execute: async (input, context): Promise<ToolResult> => {
        const startTime = Date.now();
        try {
            const gmail = await getGmailClientForUser(context.userId);
            const result = await gmailSearch(gmail, { query: input.query, maxResults: input.maxResults });
            return {
                success: true,
                output: result,
                artifacts: [],
                previews: [{
                    type: "text",
                    title: "Gmail search results",
                    content: (result.emails || []).map((e: any, i: number) => `${i + 1}. ${e.subject} — ${e.from} (${e.date}) [thread:${e.threadId}]`).join("\n") || "No results",
                }],
                logs: [],
                metrics: { durationMs: Date.now() - startTime, apiCalls: 1 },
            };
        } catch (error: any) {
            return {
                success: false,
                output: null,
                error: createError("GMAIL_SEARCH_ERROR", error.message, true),
                artifacts: [],
                previews: [],
                logs: [],
                metrics: { durationMs: Date.now() - startTime },
            };
        }
    },
};

const gmailFetchSchema = z.object({
    threadId: z.string().min(1),
});

const gmailFetchTool: ToolDefinition = {
    name: "gmail_fetch",
    description: "Fetch a Gmail thread (full messages) by threadId.",
    inputSchema: gmailFetchSchema,
    capabilities: ["accesses_external_api"],
    execute: async (input, context): Promise<ToolResult> => {
        const startTime = Date.now();
        try {
            const gmail = await getGmailClientForUser(context.userId);
            const result = await gmailFetchThread(gmail, { threadId: input.threadId });
            return {
                success: true,
                output: result,
                artifacts: [],
                previews: [{
                    type: "text",
                    title: `Thread: ${result.subject || input.threadId}`,
                    content: (result.messages || []).map((m: any) => `From: ${m.from}\nDate: ${m.date}\n---\n${String(m.body || "").slice(0, 1200)}\n`).join("\n\n"),
                }],
                logs: [],
                metrics: { durationMs: Date.now() - startTime, apiCalls: 1 },
            };
        } catch (error: any) {
            return {
                success: false,
                output: null,
                error: createError("GMAIL_FETCH_ERROR", error.message, true),
                artifacts: [],
                previews: [],
                logs: [],
                metrics: { durationMs: Date.now() - startTime },
            };
        }
    },
};

const gmailSendSchema = z.object({
    to: z.string().email(),
    subject: z.string().min(1),
    body: z.string().min(1),
    threadId: z.string().optional(),
});

const gmailSendTool: ToolDefinition = {
    name: "gmail_send",
    description: "Send an email via Gmail (requires confirmation by policy in higher layers).",
    inputSchema: gmailSendSchema,
    capabilities: ["accesses_external_api"],
    execute: async (input, context): Promise<ToolResult> => {
        const startTime = Date.now();
        try {
            const gmail = await getGmailClientForUser(context.userId);
            const result = await gmailSend(gmail, input);
            return {
                success: true,
                output: result,
                artifacts: [],
                previews: [{
                    type: "text",
                    title: "Email sent",
                    content: `To: ${input.to}\nSubject: ${input.subject}\nMessageId: ${result.id}\nThreadId: ${result.threadId}`,
                }],
                logs: [],
                metrics: { durationMs: Date.now() - startTime, apiCalls: 1 },
            };
        } catch (error: any) {
            return {
                success: false,
                output: null,
                error: createError("GMAIL_SEND_ERROR", error.message, true),
                artifacts: [],
                previews: [],
                logs: [],
                metrics: { durationMs: Date.now() - startTime },
            };
        }
    },
};

const gmailMarkReadSchema = z.object({
    messageId: z.string().min(1),
});

const gmailMarkReadTool: ToolDefinition = {
    name: "gmail_mark_read",
    description: "Mark a Gmail message as read by messageId.",
    inputSchema: gmailMarkReadSchema,
    capabilities: ["accesses_external_api"],
    execute: async (input, context): Promise<ToolResult> => {
        const startTime = Date.now();
        try {
            const gmail = await getGmailClientForUser(context.userId);
            const result = await gmailMarkRead(gmail, { messageId: input.messageId });
            return {
                success: true,
                output: result,
                artifacts: [],
                previews: [{ type: "text", title: "Marked read", content: `MessageId: ${input.messageId}` }],
                logs: [],
                metrics: { durationMs: Date.now() - startTime, apiCalls: 1 },
            };
        } catch (error: any) {
            return {
                success: false,
                output: null,
                error: createError("GMAIL_MARK_READ_ERROR", error.message, true),
                artifacts: [],
                previews: [],
                logs: [],
                metrics: { durationMs: Date.now() - startTime },
            };
        }
    },
};

// ============================================================================
// WHATSAPP WEB TOOLS (REAL)
// ============================================================================

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeWhatsAppJid(to: string): string {
    const trimmed = String(to || "").trim();
    if (!trimmed) return trimmed;
    if (trimmed.includes("@")) return trimmed;
    const digits = trimmed.replace(/[^0-9]/g, "");
    if (!digits) return trimmed;
    return `${digits}@s.whatsapp.net`;
}

const whatsappStatusSchema = z.object({});

const whatsappStatusTool: ToolDefinition = {
    name: "whatsapp_status",
    description: "Get the current WhatsApp Web connection status (disconnected, connecting, qr, pairing_code, connected).",
    inputSchema: whatsappStatusSchema,
    capabilities: ["accesses_external_api"],
    execute: async (_input, context): Promise<ToolResult> => {
        const startTime = Date.now();
        try {
            const status = whatsappWebManager.getStatus(context.userId);
            return {
                success: true,
                output: status,
                artifacts: [],
                previews: [{ type: "text", title: "WhatsApp status", content: JSON.stringify(status, null, 2) }],
                logs: [],
                metrics: { durationMs: Date.now() - startTime },
            };
        } catch (error: any) {
            return {
                success: false,
                output: null,
                error: createError("WHATSAPP_STATUS_ERROR", error.message, true),
                artifacts: [],
                previews: [],
                logs: [],
                metrics: { durationMs: Date.now() - startTime },
            };
        }
    },
};

const whatsappConnectSchema = z.object({
    phone: z.string().optional().describe("Optional phone number to request a pairing code (digits or E.164). If omitted, QR flow is used."),
    waitMs: z.number().int().min(0).max(30000).optional().default(8000).describe("How long to wait for QR/pairing_code after starting (ms)."),
});

const whatsappConnectTool: ToolDefinition = {
    name: "whatsapp_connect",
    description: "Start or resume a WhatsApp Web session. Returns QR or pairing code status for linking.",
    inputSchema: whatsappConnectSchema,
    capabilities: ["requires_network", "accesses_external_api"],
    execute: async (input, context): Promise<ToolResult> => {
        const startTime = Date.now();
        try {
            const initial = input.phone
                ? await whatsappWebManager.startWithOptions(context.userId, { phone: String(input.phone) })
                : await whatsappWebManager.startWithOptions(context.userId);

            let status = initial;
            const waitMs = Math.max(0, Math.min(Number(input.waitMs ?? 8000), 30000));
            const deadline = Date.now() + waitMs;

            while (Date.now() < deadline && status.state === "connecting") {
                await sleep(250);
                status = whatsappWebManager.getStatus(context.userId);
            }

            return {
                success: true,
                output: status,
                artifacts: [],
                previews: [{
                    type: "text",
                    title: "WhatsApp connect",
                    content: status.state === "qr"
                        ? `Scan this QR in WhatsApp to link:\n\n${status.qr}`
                        : status.state === "pairing_code"
                            ? `Pairing code for ${status.phone}: ${status.code}`
                            : `Status: ${status.state}`,
                }],
                logs: [],
                metrics: { durationMs: Date.now() - startTime, apiCalls: 1 },
            };
        } catch (error: any) {
            return {
                success: false,
                output: null,
                error: createError("WHATSAPP_CONNECT_ERROR", error.message, true),
                artifacts: [],
                previews: [],
                logs: [],
                metrics: { durationMs: Date.now() - startTime },
            };
        }
    },
};

const whatsappDisconnectSchema = z.object({});

const whatsappDisconnectTool: ToolDefinition = {
    name: "whatsapp_disconnect",
    description: "Disconnect the current user's WhatsApp Web session.",
    inputSchema: whatsappDisconnectSchema,
    capabilities: ["accesses_external_api"],
    execute: async (_input, context): Promise<ToolResult> => {
        const startTime = Date.now();
        try {
            await whatsappWebManager.disconnect(context.userId);
            return {
                success: true,
                output: { success: true },
                artifacts: [],
                previews: [{ type: "text", title: "WhatsApp disconnect", content: "Disconnected." }],
                logs: [],
                metrics: { durationMs: Date.now() - startTime, apiCalls: 1 },
            };
        } catch (error: any) {
            return {
                success: false,
                output: null,
                error: createError("WHATSAPP_DISCONNECT_ERROR", error.message, true),
                artifacts: [],
                previews: [],
                logs: [],
                metrics: { durationMs: Date.now() - startTime },
            };
        }
    },
};

const whatsappSendTextSchema = z.object({
    to: z.string().min(1).describe("Recipient JID (e.g. 15551234567@s.whatsapp.net) or phone number"),
    text: z.string().min(1).describe("Message text"),
    chunkSize: z.number().int().min(200).max(2000).optional().default(1400).describe("Max characters per WhatsApp message chunk"),
});

const whatsappSendTextTool: ToolDefinition = {
    name: "whatsapp_send_text",
    description: "Send a WhatsApp text message to a user or group. Will chunk long messages to avoid delivery limits.",
    inputSchema: whatsappSendTextSchema,
    capabilities: ["requires_network", "accesses_external_api"],
    execute: async (input, context): Promise<ToolResult> => {
        const startTime = Date.now();
        try {
            const toJid = normalizeWhatsAppJid(String(input.to));
            const parts = chunkText(String(input.text), Number(input.chunkSize ?? 1400));
            if (parts.length === 0) {
                throw new Error("Text is empty after trimming");
            }

            for (const part of parts) {
                await whatsappWebManager.sendText(context.userId, toJid, part);
            }

            return {
                success: true,
                output: { to: toJid, parts: parts.length },
                artifacts: [],
                previews: [{
                    type: "text",
                    title: "WhatsApp sent",
                    content: `To: ${toJid}\nParts: ${parts.length}`,
                }],
                logs: [],
                metrics: { durationMs: Date.now() - startTime, apiCalls: parts.length },
            };
        } catch (error: any) {
            return {
                success: false,
                output: null,
                error: createError("WHATSAPP_SEND_TEXT_ERROR", error.message, true),
                artifacts: [],
                previews: [],
                logs: [],
                metrics: { durationMs: Date.now() - startTime },
            };
        }
    },
};

const whatsappSearchSchema = z.object({
    query: z.string().min(1).describe("Text search query (Spanish-friendly)"),
    maxResults: z.number().int().min(1).max(50).optional().default(20),
});

const whatsappSearchMessagesTool: ToolDefinition = {
    name: "whatsapp_search_messages",
    description: "Search mirrored WhatsApp chat messages stored in IliaGPT (requires DB).",
    inputSchema: whatsappSearchSchema,
    capabilities: [],
    execute: async (input, context): Promise<ToolResult> => {
        const startTime = Date.now();
        try {
            const raw = await storage.searchMessages(context.userId, String(input.query));
            const filtered = raw
                .filter((m: any) => {
                    const chatId = String(m.chatId || "");
                    const channel = m?.metadata?.channel;
                    return channel === "whatsapp_web" || chatId.startsWith("wa_");
                })
                .slice(0, Number(input.maxResults ?? 20));

            const results = filtered.map((m: any) => ({
                id: m.id,
                chatId: m.chatId,
                role: m.role,
                content: String(m.content || "").slice(0, 500),
                createdAt: m.createdAt,
                from: m?.metadata?.from,
                to: m?.metadata?.to,
            }));

            return {
                success: true,
                output: { query: input.query, results },
                artifacts: [],
                previews: [{
                    type: "text",
                    title: "WhatsApp search results",
                    content: results.map((r: any, i: number) => `${i + 1}. [${r.chatId}] ${r.content}`).join("\n") || "No results",
                }],
                logs: [],
                metrics: { durationMs: Date.now() - startTime },
            };
        } catch (error: any) {
            return {
                success: false,
                output: null,
                error: createError("WHATSAPP_SEARCH_ERROR", error.message, true),
                artifacts: [],
                previews: [],
                logs: [],
                metrics: { durationMs: Date.now() - startTime },
            };
        }
    },
};

const whatsappRecentSchema = z.object({
    chatsLimit: z.number().int().min(1).max(20).optional().default(5),
    messagesLimit: z.number().int().min(1).max(50).optional().default(10),
});

const whatsappRecentMessagesTool: ToolDefinition = {
    name: "whatsapp_recent_messages",
    description: "List recent messages from mirrored WhatsApp chats stored in IliaGPT (requires DB).",
    inputSchema: whatsappRecentSchema,
    capabilities: [],
    execute: async (input, context): Promise<ToolResult> => {
        const startTime = Date.now();
        try {
            const chats = await storage.getChats(context.userId);
            const waChats = chats
                .filter((c: any) => String(c.id || "").startsWith("wa_"))
                .slice(0, Number(input.chatsLimit ?? 5));

            const out: any[] = [];
            for (const chat of waChats) {
                const messages = await storage.getChatMessages(chat.id, { limit: Number(input.messagesLimit ?? 10), orderBy: "desc" });
                out.push({
                    chatId: chat.id,
                    title: chat.title,
                    updatedAt: chat.updatedAt,
                    messages: (messages || []).map((m: any) => ({
                        id: m.id,
                        role: m.role,
                        content: String(m.content || "").slice(0, 500),
                        createdAt: m.createdAt,
                        from: m?.metadata?.from,
                        to: m?.metadata?.to,
                    })),
                });
            }

            return {
                success: true,
                output: { chats: out },
                artifacts: [],
                previews: [{
                    type: "text",
                    title: "WhatsApp recent messages",
                    content: out.map((c: any) => `# ${c.title || c.chatId}\n` + (c.messages || []).slice(0, 3).map((m: any) => `- (${m.role}) ${m.content}`).join("\n")).join("\n\n") || "No WhatsApp chats found",
                }],
                logs: [],
                metrics: { durationMs: Date.now() - startTime },
            };
        } catch (error: any) {
            return {
                success: false,
                output: null,
                error: createError("WHATSAPP_RECENT_ERROR", error.message, true),
                artifacts: [],
                previews: [],
                logs: [],
                metrics: { durationMs: Date.now() - startTime },
            };
        }
    },
};

// ============================================================================
// EXPORT ALL TOOLS
// ============================================================================

export const extendedTools: ToolDefinition[] = [
    calculatorTool,
    dateTimeTool,
    unitConverterTool,
    qrCodeTool,
    textProcessTool,
    jsonTool,
    randomGenTool,

    // Gmail (real)
    gmailSearchTool,
    gmailFetchTool,
    gmailSendTool,
    gmailMarkReadTool,

    // WhatsApp Web (real)
    whatsappStatusTool,
    whatsappConnectTool,
    whatsappDisconnectTool,
    whatsappSendTextTool,
    whatsappSearchMessagesTool,
    whatsappRecentMessagesTool,
];

export default extendedTools;
