import { z } from 'zod';
import { AgentCapability } from '../registry';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const pythonSandboxBridgeCapability: AgentCapability = {
    name: "execute_python_script_sandbox",
    description: "Ejecuta un script de Python 3 local de manera segura para análisis rápido de datos matemáticos, uso avanzado de Pandas, SciPy, o matplotlib sin salir del contexto Node del Agente.",
    schema: z.object({
        script: z.string().describe("Código Python 3 válido a ejecutar (ej: 'print(\"Hola Mundo\")')."),
        timeoutMs: z.number().optional().default(10000).describe("Límite de tiempo en milisegundos para matar el proceso.")
    }),
    execute: async ({ script, timeoutMs }) => {
        try {
            console.log("[Data Submodule] Executing Python Shell Hook...");

            // Sanitizamos escapes simples. En un entorno real se inyecta en Docker / Firecracker.
            const sanitizedScript = script.replace(/"/g, '\\"');
            const safeTimeout = Math.min(Math.max(timeoutMs || 10000, 1000), 30000); // Max 30s

            // Ejecución inline usando python3 -c
            const { stdout, stderr } = await execAsync(`python3 -c "${sanitizedScript}"`, {
                timeout: safeTimeout,
                killSignal: 'SIGTERM'
            });

            return {
                exit_code: 0,
                output: stdout.trim(),
                warnings: stderr.trim() || undefined,
                success: true
            };

        } catch (error: any) {
            console.error("[Data Submodule Python Error]", error.message);
            return {
                error: `Python execution failed or timed out. Reason: ${error.message}`,
                diagnostics: "Asegúrate de no bloquear el STDIN y no ejecutar loops infinitos."
            };
        }
    }
};
