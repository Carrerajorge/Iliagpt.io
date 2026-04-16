import { z } from 'zod';
import { AgentCapability } from '../registry';
import * as xlsx from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';

export const excelGeneratorCapability: AgentCapability = {
    name: "create_excel_report",
    description: "Crea un archivo binario Microsoft Excel (.xlsx) real en el servidor. Ideal para volcar datos estructurados extraídos de la web, análisis de logs de Node, o bases de datos de clientes recolectadas por el Agente. Soporta múltiples hojas (sheets).",
    schema: z.object({
        filename: z.string().describe("Nombre del reporte final (ej: 'scraped_competitors_q1.xlsx'). La extensión .xlsx es automática."),
        sheets: z.array(z.object({
            sheetName: z.string().describe("Nombre de la pestaña/hoja (máximo 30 chars)."),
            data: z.array(z.record(z.any())).describe("Array de diccionarios JSON { ColumnaA: Valor, ColumnaB: Valor }. Cada objeto es una fila.")
        })).describe("Un array estructurado con cada pestaña y su respectiva data analizada.")
    }),
    execute: async ({ filename, sheets }) => {
        try {
            if (sheets.length === 0) {
                return { error: 'No se proveyeron hojas/datos para generar el Excel.' };
            }

            const cleanFileName = filename.replace(/[^a-z0-9_.-]/gi, '_').replace(/\.xlsx$/i, '') + '.xlsx';

            // Bloquear escritura fuera del workspace seguro
            const exportDir = path.resolve(process.cwd(), 'server', 'agent', 'workspace');
            if (!fs.existsSync(exportDir)) {
                fs.mkdirSync(exportDir, { recursive: true });
            }

            const filePath = path.join(exportDir, cleanFileName);

            // Instanciar Workbook
            const workbook = xlsx.utils.book_new();

            sheets.forEach((sheet: any) => {
                // Convertir Array de JSONs nativos a Matrix Sheet
                const worksheet = xlsx.utils.json_to_sheet(sheet.data);
                let safeSheetName = sheet.sheetName.substring(0, 31); // Límite estricto de Excel M.S
                xlsx.utils.book_append_sheet(workbook, worksheet, safeSheetName);
            });

            // Escritura Bloqueante sincrónica
            xlsx.writeFile(workbook, filePath);

            return {
                event: "Excel File Created Successfully",
                bytes: fs.statSync(filePath).size,
                absolute_path: filePath,
                instructions: `El archivo ha sido volcado a ${filePath}`
            };

        } catch (error: any) {
            console.error("[Office Submodule Error]", error.message);
            return {
                error: `Failed to create Excel File. ${error.message}`
            };
        }
    }
};
