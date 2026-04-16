import { z } from 'zod';
import { AgentCapability } from '../registry';
import { Document, Paragraph, TextRun, Packer, HeadingLevel } from 'docx';
import * as path from 'path';
import * as fs from 'fs';

export const wordGeneratorCapability: AgentCapability = {
    name: "create_word_document",
    description: "Crea un archivo reporte original de Microsoft Word (.docx). Usar para volcar resúmenes larguísimos de PDFs, artículos leídos con Chromium, redaccíon de ensayos creativos, u otro material narrativo que requiere ser leído por humanos externamente.",
    schema: z.object({
        filename: z.string().describe("Nombre del reporte final (ej: 'active_inference_summary.docx')."),
        title: z.string().describe("Título principal que irá al inicio del documento con fuente Header1."),
        paragraphs: z.array(z.string()).describe("Lista de párrafos principales de texto plano extraídos o elucubrados por el cerebro.")
    }),
    execute: async ({ filename, title, paragraphs }) => {
        try {
            const cleanFileName = filename.replace(/[^a-z0-9_.-]/gi, '_').replace(/\.docx$/i, '') + '.docx';

            const exportDir = path.resolve(process.cwd(), 'server', 'agent', 'workspace');
            if (!fs.existsSync(exportDir)) {
                fs.mkdirSync(exportDir, { recursive: true });
            }

            const filePath = path.join(exportDir, cleanFileName);

            // Create Document sections
            const docElements: any[] = [];

            // H1 Header
            docElements.push(new Paragraph({
                text: title,
                heading: HeadingLevel.HEADING_1,
                spacing: { after: 400 }
            }));

            // Render paragraph bodies
            paragraphs.forEach((pText: string) => {
                if (pText.trim() !== '') {
                    docElements.push(new Paragraph({
                        children: [
                            new TextRun({
                                text: pText,
                                size: 24, // 12pt
                                font: "Calibri"
                            })
                        ],
                        spacing: { after: 200 }
                    }));
                }
            });

            const doc = new Document({
                sections: [{
                    properties: {},
                    children: docElements
                }]
            });

            // Buffer Generation and Export
            const docBuffer = await Packer.toBuffer(doc);
            fs.writeFileSync(filePath, docBuffer);

            return {
                event: "Word Document Created Successfully",
                bytes: docBuffer.length,
                absolute_path: filePath
            };

        } catch (error: any) {
            console.error("[Office Submodule Error]", error.message);
            return {
                error: `Failed to create Word File. ${error.message}`
            };
        }
    }
};

// ---------------------------------------------------------------------------
// Office Engine — level 0 fallback
// ---------------------------------------------------------------------------
//
// Pure buffer-returning helper used by the OfficeEngine fallbackLadder. Does
// not touch the filesystem and does not depend on the agent capability shape.

export interface FreshDocxSpec {
    title: string;
    paragraphs: string[];
}

export async function generateFreshDocx(spec: FreshDocxSpec): Promise<Buffer> {
    const docElements: any[] = [];
    docElements.push(new Paragraph({
        text: spec.title,
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 400 },
    }));
    for (const p of spec.paragraphs) {
        if (p.trim() === "") continue;
        docElements.push(new Paragraph({
            children: [new TextRun({ text: p, size: 24, font: "Calibri" })],
            spacing: { after: 200 },
        }));
    }
    const doc = new Document({
        sections: [{ properties: {}, children: docElements }],
    });
    return Packer.toBuffer(doc);
}
