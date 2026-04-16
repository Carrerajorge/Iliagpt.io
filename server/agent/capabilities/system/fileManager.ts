import { z } from 'zod';
import { AgentCapability } from '../registry';
import * as path from 'path';
import * as fs from 'fs';

// El root del agente local — evita Path Traversal vulnerabilities
const WORKSPACE_DIR = path.resolve(process.cwd(), 'server', 'agent', 'workspace');

export const fileManagerCapability: AgentCapability = {
    name: "read_local_file",
    description: "Da al Agente visión sobre el disco de la máquina leyendo textos, csvs y logs. Por seguridad, está contenido en la carpeta de Workspace (server/agent/workspace).",
    schema: z.object({
        operation: z.enum(['list', 'read']).describe("Listar archivos disponibles, o leer uno concreto."),
        filename: z.string().optional().describe("Si list=true es ignorado. Si read=true, pasar el nombre_de_archivo exacto con extensión (ej. log.txt, db.csv).")
    }),
    execute: async ({ operation, filename }) => {
        try {
            if (!fs.existsSync(WORKSPACE_DIR)) {
                fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
            }

            if (operation === 'list') {
                const files = fs.readdirSync(WORKSPACE_DIR);
                return {
                    directory: "server/agent/workspace/",
                    files: files.length > 0 ? files : ["Empty folder. Workspace is clean."]
                };
            }

            // Si es READ:
            if (!filename || filename.includes('..') || filename.includes('/')) {
                return { error: 'Nombre de archivo inválido, o intento de Path Traversal abortado.' };
            }

            const targetPath = path.join(WORKSPACE_DIR, filename);
            if (!fs.existsSync(targetPath)) {
                return { error: `File Not Found: ${targetPath}` };
            }

            const stats = fs.statSync(targetPath);

            // Si es Office nativo, negarse a parsearlo como texto
            if (filename.endsWith('.xlsx') || filename.endsWith('.docx')) {
                return { error: "El agente MCTS no debe intentar leer binarios XLSX/DOCX con readFile. Pide ayuda a pythonSandboxBridge para parsear estructuras complejas." };
            }

            // Límite de 1MB para seguridad de Memoria Node
            if (stats.size > 1.5 * 1024 * 1024) {
                return { error: `Archivo gigante detectado (${stats.size} bytes). Leer con Python Sandbox pasándole open(filepath).` };
            }

            const stringContent = fs.readFileSync(targetPath, 'utf-8');

            const MAX_CHARS = 25000;
            return {
                file_stats: { size: stats.size, modified: stats.mtime },
                content_preview: stringContent.length > MAX_CHARS
                    ? stringContent.substring(0, MAX_CHARS) + "\n...[TRUNCATED_DUE_TO_SIZE_PROTECTING_LLM]"
                    : stringContent
            };

        } catch (error: any) {
            console.error("[System FS Error]", error.message);
            return {
                error: `File operation failed. ${error.message}`
            };
        }
    }
};
