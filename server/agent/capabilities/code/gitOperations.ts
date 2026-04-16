import { z } from 'zod';
import { AgentCapability } from '../registry';
import simpleGit, { SimpleGit } from 'simple-git';

const git: SimpleGit = simpleGit();

export const gitOperationsCapability: AgentCapability = {
    name: "execute_git_operation",
    description: "Permite al Agente interactuar con el control de versiones local (Git) para leer el estado, armar commits atómicos de sus propios fixes y revisar diffs de código sin intervención humana.",
    schema: z.object({
        operation: z.enum(['status', 'diff', 'commit', 'add']).describe("La operación Git a realizar."),
        message: z.string().optional().describe("Mensaje de commit (requerido solo si operation = 'commit')."),
        files: z.array(z.string()).optional().describe("Archivos para 'add' o 'diff', o '.' para todo.")
    }),
    execute: async ({ operation, message, files }) => {
        try {
            if (operation === 'status') {
                const status = await git.status();
                return {
                    current_branch: status.current,
                    modified_files: status.modified,
                    untracked_files: status.not_added,
                    is_clean: status.isClean()
                };
            }

            if (operation === 'diff') {
                // En un futuro el agente usaría esto para auto-revisar antes de commitear
                const diff = await git.diff(files || []);
                return { diff_excerpt: diff.substring(0, 1500) + (diff.length > 1500 ? '\n...[TRUNCATED]' : '') };
            }

            if (operation === 'add') {
                await git.add(files || ['.']);
                return { success: true, added_targets: files || ['.'] };
            }

            if (operation === 'commit') {
                if (!message) return { error: "Commit operations require a 'message' parameter." };
                const result = await git.commit(message);
                return {
                    success: true,
                    commit_hash: result.commit,
                    branch: result.branch,
                    summary: result.summary
                };
            }

            return { error: `Unsupported git operation: ${operation}` };
        } catch (error: any) {
            console.error("[Code Submodule Git Error]", error.message);
            return { error: `Git execution failed. Reason: ${error.message}` };
        }
    }
};
