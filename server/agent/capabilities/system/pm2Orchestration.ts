import { z } from 'zod';
import { AgentCapability } from '../registry';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';

const execAsync = promisify(exec);

export const pm2OrchestrationCapability: AgentCapability = {
    name: "manage_pm2_processes",
    description: "Permite al Cerebro conocer el estado de sus propios subprocesos daemonizados, reiniciar workers de inferencia caídos, o consultar métricas de RAM/CPU de PM2 (Process Manager 2).",
    schema: z.object({
        command: z.enum(['list', 'restart', 'logs', 'monit']).describe("Operación a realizar sobre PM2."),
        target: z.string().optional().default('all').describe("App id o nombre (ej: '0', 'iliagpt-server'). Usar 'all' para todo.")
    }),
    execute: async ({ command, target }) => {
        try {
            console.log(`[System Submodule] PM2 Command: ${command} on ${target}`);

            let shellCmd = '';
            switch (command) {
                case 'list':
                    shellCmd = 'npx pm2 jlist'; // Retorna JSON estructurado directamente
                    break;
                case 'restart':
                    // Cuidado: el agente se podría auto-reiniciar y corromper el MCTS actual.
                    shellCmd = `npx pm2 restart ${target}`;
                    break;
                case 'logs':
                    shellCmd = `npx pm2 logs ${target} --raw --lines 50 --nostream`;
                    break;
                case 'monit':
                    return { error: 'Monit es interactivo. Usa list para métricas via jlist.' };
            }

            const { stdout, stderr } = await execAsync(shellCmd, { timeout: 5000 });

            if (command === 'list') {
                const parsed = JSON.parse(stdout);
                const mappedList = parsed.map((proc: any) => ({
                    name: proc.name,
                    pid: proc.pid,
                    pm2_id: proc.pm_id,
                    status: proc.pm2_env?.status,
                    memory: `${(proc.monit?.memory / 1024 / 1024).toFixed(1)} MB`,
                    cpu: `${proc.monit?.cpu}%`
                }));
                return { running_processes: mappedList, success: true };
            }

            return {
                output: stdout.trim(),
                warnings: stderr.trim() || undefined,
                success: true
            };

        } catch (error: any) {
            console.warn("[System Submodule PM2 Warning]", error.message); // Posiblemente PM2 no instalado local env
            return {
                error: `PM2 invocation failed. Is PM2 running? Reason: ${error.message}`,
                os_fallback: { platform: os.platform(), freemem: os.freemem(), loadavg: os.loadavg() }
            };
        }
    }
};
