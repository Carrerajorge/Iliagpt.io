import { z } from 'zod';
import type { AgentCapability } from '../registry';
import * as fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// --- T18: OS FILE SEARCH ---
export const localFileSearchCapability: AgentCapability = {
    name: 'system.file_search',
    description: 'Busca archivos en un directorio local específico coincidiendo con un patrón o extensión.',
    schema: z.object({
        directory: z.string().describe("Ruta absoluta del directorio a escanear."),
        pattern: z.string().describe("Sufijo o patrón string a buscar en el nombre del archivo (ej. '.ts')")
    }),
    async execute(args) {
        try {
            const files = await fs.readdir(args.directory, { recursive: true });
            const matched = files.filter(f => f.includes(args.pattern));
            return {
                success: true,
                count: matched.length,
                files: matched.slice(0, 100) // limit return
            };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    }
};

// --- T18: DOCKER DEVOPS OPERATOR ---
export const dockerOperatorCapability: AgentCapability = {
    name: 'system.docker_operate',
    description: 'Permite al Agente ILIAGPT consultar contenedores Docker corriendo, e iniciar o detener servicios.',
    schema: z.object({
        command: z.enum(['ps', 'restart', 'stop']).describe("Comando docker a ejecutar."),
        containerId: z.string().optional().describe("ID o Nombre del contenedor (Obligatorio para restart/stop).")
    }),
    async execute(args) {
        try {
            if (args.command === 'ps') {
                const { stdout } = await execFileAsync('docker', ['ps', '--format', '{{.ID}}\t{{.Names}}\t{{.Status}}']);
                return { success: true, stdout };
            }

            if (!args.containerId) return { success: false, error: "Falta containerId" };

            // containerId is validated by zod as a string; args.command is from z.enum so it's safe
            const containerId = String(args.containerId).replace(/[^a-zA-Z0-9_.\-]/g, '');
            const { stdout } = await execFileAsync('docker', [args.command, containerId]);
            return { success: true, stdout: stdout.trim() };
        } catch (e: any) {
            // Mock fallback if docker is not installed
            return { success: false, error: "Docker CLI execution failed or not installed", original: e.message };
        }
    }
};
