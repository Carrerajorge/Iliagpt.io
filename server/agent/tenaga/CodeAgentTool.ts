import { ToolDefinition, ExecutionContext, ToolResult } from "../pipeline/types";
import { ContainerSandbox } from "./ContainerSandbox";

/**
 * TENAGA CodeAgent Tool
 * Permite la ejecución de código (Python, JS, Bash) en el Sandbox efímero
 */
export const executeArbitraryCodeTool: ToolDefinition = {
  id: "tenaga_code_execute",
  name: "Execute Sandboxed Code",
  description: "Execute arbitrary Python, JavaScript or Bash code in a secure ephemeral Linux container.",
  category: "advanced",
  capabilities: ["code", "execute", "python", "javascript", "bash", "sandbox"],
  inputSchema: {
    language: { type: "string", enum: ["javascript", "python", "bash"], required: true },
    code: { type: "string", required: true, description: "The source code to execute" }
  },
  execute: async (context: ExecutionContext, params: Record<string, any>): Promise<ToolResult> => {
    const { language, code } = params;

    // Levantamos un contenedor nuevo y prístino solo para esta ejecución
    const sandbox = new ContainerSandbox('docker'); 
    // Nota: cambiable a podman según el host

    const started = await sandbox.startSandbox();
    if (!started) {
      return { success: false, error: "Failed to initialize secure sandbox container." };
    }

    try {
      const { stdout, stderr, exitCode } = await sandbox.executeCode(code, language);
      return { 
        success: exitCode === 0, 
        data: { stdout, stderr, exitCode }
      };
    } catch (e: any) {
      return { success: false, error: e.message };
    } finally {
      // Destrucción inmediata post-ejecución (Ephemerality)
      await sandbox.destroy();
    }
  }
};
