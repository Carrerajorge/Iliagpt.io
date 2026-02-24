/**
 * DOCX Code Generator Service
 * 
 * Generates JavaScript code using the docx library based on document descriptions,
 * then executes it in a sandbox to produce professional Word documents.
 */

import { Document, Packer, Paragraph, TextRun, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle, HeadingLevel, convertInchesToTwip } from 'docx';
import OpenAI from 'openai';
import * as vm from 'vm';

const xaiClient = new OpenAI({
    baseURL: "https://api.x.ai/v1",
    apiKey: process.env.XAI_API_KEY || "missing",
});

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

/**
 * Template examples for different document types
 */
const DOCUMENT_TEMPLATES = {
    solicitud: `
// Ejemplo: Solicitud Formal
new Document({
    sections: [{
        properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
        children: [
            new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "SOLICITUD DE PERMISO", bold: true, size: 32 })] }),
            new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "Fecha: _______________________" })] }),
            new Paragraph({ children: [new TextRun({ text: "A: ", bold: true }), new TextRun({ text: "_________________________________________________" })] }),
            // Más campos...
            new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "_________________________________" })] }),
            new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Firma del Solicitante" })] }),
        ]
    }]
})`,
    contrato: `
// Ejemplo: Contrato
new Document({
    sections: [{
        children: [
            new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "CONTRATO DE SERVICIOS", bold: true, size: 32 })] }),
            new Paragraph({ children: [new TextRun({ text: "CLÁUSULA PRIMERA: ", bold: true }), new TextRun({ text: "Descripción del servicio..." })] }),
            // Firmas de ambas partes
            new Paragraph({ children: [new TextRun({ text: "EL CONTRATANTE" })] }),
            new Paragraph({ children: [new TextRun({ text: "_________________________________" })] }),
        ]
    }]
})`,
    informe: `
// Ejemplo: Informe Técnico
new Document({
    sections: [{
        children: [
            new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: "INFORME TÉCNICO" })] }),
            new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: "1. INTRODUCCIÓN" })] }),
            new Paragraph({ children: [new TextRun({ text: "Contenido del informe..." })] }),
            // Tablas de datos
            new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Dato" })] })] })] })] }),
        ]
    }]
})`
};

/**
 * Generate JavaScript code for a DOCX document
 */
export async function generateDocxCode(description: string, documentType: string = 'general'): Promise<string> {
    console.log(`[DocxCodeGenerator] Generating code for: "${description.substring(0, 50)}..."`);

    const template = DOCUMENT_TEMPLATES[documentType as keyof typeof DOCUMENT_TEMPLATES] || DOCUMENT_TEMPLATES.solicitud;

    const prompt = `Genera código JavaScript COMPLETO usando la librería 'docx' para crear:

**Documento solicitado:** ${description}

**REGLAS ESTRICTAS:**
1. Usa SOLO estas importaciones (ya están disponibles):
   - Document, Packer, Paragraph, TextRun, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle, HeadingLevel, convertInchesToTwip

2. Crea un documento profesional en ESPAÑOL con:
   - Título centrado en negrita
   - Campos para completar con líneas: "___________________________________________"
   - Espacios para firma con líneas centradas
   - Si aplica, casillas: "☐ Opción A   ☐ Opción B"
   - Secciones claras con encabezados

3. El código debe ser UNA función async llamada \`createDocument\` que retorna el Document:

\`\`\`javascript
async function createDocument() {
    const doc = new Document({
        styles: { default: { document: { run: { font: "Arial", size: 24 } } } },
        sections: [{
            properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
            children: [
                // Contenido aquí
            ]
        }]
    });
    return doc;
}
\`\`\`

4. NO uses require() ni import - las clases ya están disponibles globalmente

**EJEMPLO DE REFERENCIA:**
${template}

**IMPORTANTE:** 
- Genera un documento COMPLETO y PROFESIONAL
- Incluye TODOS los campos relevantes para: ${description}
- Usa tamaños de fuente apropiados (24 para texto, 32 para títulos)
- Agrega espaciado entre secciones ({ spacing: { after: 200 } })

Responde SOLO con el código JavaScript de la función createDocument, sin explicaciones.`;

    try {
        const response = await xaiClient.chat.completions.create({
            model: DEFAULT_MODEL,
            messages: [
                {
                    role: "system",
                    content: "Eres un experto en generar código JavaScript para documentos Word usando la librería docx. Generas documentos profesionales con campos rellenables, firmas y formato corporativo."
                },
                { role: "user", content: prompt }
            ],
            temperature: 0.3,
            max_tokens: 4096,
        });

        let code = response.choices[0].message.content || '';

        // Clean up the code
        code = code.replace(/```javascript\n?/g, '').replace(/```\n?/g, '').trim();

        console.log(`[DocxCodeGenerator] Generated code length: ${code.length} chars`);

        return code;
    } catch (error: any) {
        console.error('[DocxCodeGenerator] Error generating code:', error.message);
        throw new Error(`Failed to generate document code: ${error.message}`);
    }
}

// Maximum allowed code length (50KB)
const MAX_CODE_LENGTH = 50 * 1024;

// Maximum execution time (10 seconds)
const EXECUTION_TIMEOUT_MS = 10_000;

// Maximum generated buffer size (50MB)
const MAX_BUFFER_SIZE = 50 * 1024 * 1024;

// Patterns that indicate dangerous code attempting to escape the sandbox
const FORBIDDEN_PATTERNS = [
    // Node.js globals and builtins
    /\bprocess\b/,
    /\brequire\b/,
    /\bimport\b/,
    /\bglobal\b/,
    /\bglobalThis\b/,
    /\b__dirname\b/,
    /\b__filename\b/,
    /\bmodule\b/,
    /\bexports\b/,
    /\bBuffer\b/,
    // Child process / system access
    /\bchild_process\b/,
    /\bexecSync\b/,
    /\bexecFile\b/,
    /\bspawn\b/,
    /\bexec\s*\(/,
    // Dynamic code execution
    /\beval\b/,
    /\bFunction\s*\(/,
    /\bnew\s+Function\b/,
    /\bconstructor\s*\[/,
    /\bconstructor\s*\.\s*constructor/,
    // Prototype pollution / manipulation
    /\b__proto__\b/,
    /\bprototype\b/,
    /\bProxy\b/,
    /\bReflect\b/,
    /\bObject\s*\.\s*definePropert/,
    /\bObject\s*\.\s*setPrototypeOf/,
    /\bObject\s*\.\s*getOwnPropertyDescriptor/,
    /\bObject\s*\.\s*create\s*\(\s*null/,
    // Node.js core modules
    /\bfs\b/,
    /\bnet\b/,
    /\bhttp\b/,
    /\bhttps\b/,
    /\bdgram\b/,
    /\bcluster\b/,
    /\bworker_threads\b/,
    /\bvm\b/,
    /\bos\b/,
    /\bpath\b/,
    /\bcrypto\b/,
    /\bstream\b/,
    /\bzlib\b/,
    /\btls\b/,
    /\bdns\b/,
    // Browser/Web APIs
    /\bfetch\b/,
    /\bXMLHttpRequest\b/,
    /\bWebSocket\b/,
    /\bEventSource\b/,
    /\bnavigator\b/,
    /\bwindow\b/,
    /\bdocument\b/,
    /\blocalStorage\b/,
    /\bsessionStorage\b/,
    /\bindexedDB\b/,
    // Timers (could enable timing attacks or async escapes)
    /\bsetTimeout\b/,
    /\bsetInterval\b/,
    /\bsetImmediate\b/,
    /\bqueueMicrotask\b/,
    // Potentially dangerous methods
    /\btoString\s*\.\s*call/,
    /\bvalueOf\s*\.\s*call/,
    /Symbol\s*\.\s*toPrimitive/,
    /\bwith\s*\(/,
    /\bAsyncFunction\b/,
    /\bGeneratorFunction\b/,
    /\bAsyncGeneratorFunction\b/,
    /\bWebAssembly\b/,
    /\bSharedArrayBuffer\b/,
    /\bAtomics\b/,
];

/**
 * Validate code for dangerous patterns before execution.
 *
 * Performs multiple layers of analysis:
 * 1. Length limit check
 * 2. Forbidden keyword/pattern matching
 * 3. String concatenation escape attempts
 * 4. Template literal escape attempts
 * 5. Bracket notation property access (obj["pro"+"cess"])
 * 6. Unicode/hex escape obfuscation
 * 7. Excessive nesting depth (potential stack overflow)
 */
function validateCodeSafety(code: string): { safe: boolean; violations: string[] } {
    const violations: string[] = [];

    if (code.length > MAX_CODE_LENGTH) {
        violations.push(`Code exceeds maximum length of ${MAX_CODE_LENGTH} characters (got ${code.length})`);
    }

    for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(code)) {
            violations.push(`Forbidden pattern detected: ${pattern.source}`);
        }
    }

    // Check for string escape attempts (e.g., constructing forbidden words via concatenation)
    const suspiciousStringConcat = /\[\s*['"`]c['"`]\s*\+\s*['"`]o['"`]\s*\+\s*['"`]n['"`]/i;
    if (suspiciousStringConcat.test(code)) {
        violations.push("Suspicious string concatenation detected");
    }

    // Check for template literal obfuscation: `${'pro'}${'cess'}`
    const templateLiteralEscape = /\$\{\s*['"`]\w{1,5}['"`]\s*\}\s*\$\{\s*['"`]\w{1,5}['"`]\s*\}/;
    if (templateLiteralEscape.test(code)) {
        violations.push("Suspicious template literal string construction detected");
    }

    // Check for bracket notation property access to bypass forbidden patterns
    // e.g., this["constructor"]["constructor"] or obj["__pro"+"to__"]
    const bracketChain = /\[\s*['"`][^'"]{1,20}['"`]\s*\]\s*\[\s*['"`][^'"]{1,20}['"`]\s*\]/;
    if (bracketChain.test(code)) {
        violations.push("Suspicious bracket-notation property chain detected");
    }

    // Check for unicode/hex escape obfuscation: \x70\x72\x6f\x63\x65\x73\x73
    const hexEscapes = (code.match(/\\x[0-9a-fA-F]{2}/g) || []).length;
    const unicodeEscapes = (code.match(/\\u[0-9a-fA-F]{4}/g) || []).length;
    if (hexEscapes > 10 || unicodeEscapes > 10) {
        violations.push(`Excessive escape sequences detected (hex: ${hexEscapes}, unicode: ${unicodeEscapes})`);
    }

    // Check for excessive nesting depth (potential stack overflow / deobfuscation)
    let maxDepth = 0;
    let currentDepth = 0;
    for (const ch of code) {
        if (ch === '(' || ch === '[' || ch === '{') {
            currentDepth++;
            if (currentDepth > maxDepth) maxDepth = currentDepth;
        } else if (ch === ')' || ch === ']' || ch === '}') {
            currentDepth--;
        }
    }
    if (maxDepth > 20) {
        violations.push(`Excessive nesting depth: ${maxDepth} (max 20)`);
    }

    // Check for encoded strings that could decode to dangerous code
    const atobPattern = /atob\s*\(/;
    const decodeURI = /decodeURI(?:Component)?\s*\(/;
    if (atobPattern.test(code)) {
        violations.push("Base64 decoding (atob) is not allowed");
    }
    if (decodeURI.test(code)) {
        violations.push("URI decoding is not allowed");
    }

    return { safe: violations.length === 0, violations };
}

/**
 * Execute generated DOCX code in a sandboxed VM context and return the buffer
 */
export async function executeDocxCode(code: string): Promise<Buffer> {
    console.log('[DocxCodeGenerator] Executing generated code...');
    console.log('[DocxCodeGenerator] Code length:', code.length, 'chars');

    // Step 1: Validate code safety
    const safetyCheck = validateCodeSafety(code);
    if (!safetyCheck.safe) {
        console.error('[DocxCodeGenerator] Code safety check FAILED:', safetyCheck.violations);
        throw new Error(`Code rejected by security validator: ${safetyCheck.violations.join('; ')}`);
    }

    try {
        // Step 2: Create isolated VM context with only docx classes available
        const sandbox = {
            Document,
            Packer,
            Paragraph,
            TextRun,
            AlignmentType,
            Table,
            TableRow,
            TableCell,
            WidthType,
            BorderStyle,
            HeadingLevel,
            convertInchesToTwip,
            // Provide a safe console for debugging
            console: {
                log: (...args: unknown[]) => console.log('[Sandbox]', ...args),
                error: (...args: unknown[]) => console.error('[Sandbox]', ...args),
                warn: (...args: unknown[]) => console.warn('[Sandbox]', ...args),
            },
            // Provide Promise so async/await works
            Promise,
            Array,
            Object,
            String,
            Number,
            Boolean,
            Math,
            Date,
            JSON,
            Map,
            Set,
            Error,
            TypeError,
            RangeError,
            parseInt,
            parseFloat,
            isNaN,
            isFinite,
            undefined,
            NaN,
            Infinity,
        };

        const context = vm.createContext(sandbox, {
            name: 'docx-sandbox',
            codeGeneration: {
                strings: false,  // Disable eval() and new Function()
                wasm: false,     // Disable WebAssembly
            },
        });

        // Step 3: Execute code in the VM context.
        // To avoid code injection via template literal interpolation (CodeQL: code-injection),
        // we compile the user code as a separate vm.Script (no string interpolation) and
        // then run a thin wrapper that invokes createDocument().
        const userScript = new vm.Script(code, {
            filename: 'user-document-code.js',
        });
        userScript.runInContext(context, {
            timeout: EXECUTION_TIMEOUT_MS,
            displayErrors: true,
        });

        const wrapperCode = `
            (async () => {
                if (typeof createDocument !== 'function') {
                    throw new Error('createDocument function is not defined');
                }
                return await createDocument();
            })();
        `;
        const script = new vm.Script(wrapperCode, {
            filename: 'user-document-wrapper.js',
        });

        // Step 4: Execute with timeout
        const resultPromise = script.runInContext(context, {
            timeout: EXECUTION_TIMEOUT_MS,
            displayErrors: true,
        });

        // Handle the async result with a race against timeout
        const doc = await Promise.race([
            resultPromise,
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Document generation timed out')), EXECUTION_TIMEOUT_MS)
            ),
        ]);

        if (!doc) {
            throw new Error('Document creation returned null');
        }

        console.log('[DocxCodeGenerator] Document created, packing to buffer...');

        // Step 5: Pack the document to buffer
        const buffer = await Packer.toBuffer(doc as typeof Document.prototype);

        // Step 6: Validate buffer size
        if (buffer.length > MAX_BUFFER_SIZE) {
            throw new Error(`Generated document exceeds maximum size of ${MAX_BUFFER_SIZE / 1024 / 1024}MB`);
        }

        console.log(`[DocxCodeGenerator] Generated buffer size: ${buffer.length} bytes`);

        return buffer;
    } catch (error: any) {
        console.error('[DocxCodeGenerator] Execution error:', error.message);

        // Sanitize error messages to avoid leaking internal paths
        const sanitizedMessage = error.message
            .replace(/\/[^\s:]+/g, '[path]')
            .replace(/at\s+.+:\d+:\d+/g, '[stack]');

        throw new Error(`Failed to execute document code: ${sanitizedMessage}`);
    }
}

/**
 * High-level function: Generate and execute in one call
 */
export async function generateProfessionalDocument(
    description: string,
    documentType: string = 'solicitud'
): Promise<{ buffer: Buffer; code: string }> {
    const code = await generateDocxCode(description, documentType);
    const buffer = await executeDocxCode(code);

    return { buffer, code };
}

/**
 * Determine document type from description
 */
export function detectDocumentType(description: string): string {
    const lower = description.toLowerCase();

    if (lower.includes('contrato') || lower.includes('acuerdo')) return 'contrato';
    if (lower.includes('informe') || lower.includes('reporte')) return 'informe';
    if (lower.includes('solicitud') || lower.includes('permiso') || lower.includes('carta')) return 'solicitud';
    if (lower.includes('factura') || lower.includes('cotización')) return 'factura';
    if (lower.includes('curriculum') || lower.includes('cv')) return 'cv';

    return 'solicitud'; // Default
}
