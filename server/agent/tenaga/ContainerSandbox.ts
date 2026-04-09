import { execFile } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";

const execFileAsync = promisify(execFile);

/**
 * Capa 2: Ejecución Segura y Sandboxing
 * Utiliza Podman (rootless) o Docker como engine con perfiles de seguridad.
 */
export class ContainerSandbox {
  private containerId: string;
  private engine: 'docker' | 'podman';

  constructor(engine: 'docker' | 'podman' = 'docker') {
    this.containerId = `tenaga-sandbox-${randomUUID().slice(0, 8)}`;
    this.engine = engine;
  }

  /**
   * Levanta un contenedor efímero altamente restringido:
   * - Sin red (--network none) o solo red controlada
   * - cgroups limits (memoria y CPU)
   * - user namespaces (rootless map)
   * - Drop de capabilities peligrosas (CAP_SYS_ADMIN, etc)
   */
  async startSandbox() {
    console.log(`[Tenaga:Sandbox] Initializing ${this.engine} container: ${this.containerId}`);

    const args = [
      "run", "-d",
      "--name", this.containerId,
      "--security-opt", "no-new-privileges=true",
      "--cap-drop=ALL",
      "--cap-add=SETUID",
      "--cap-add=SETGID",
      "--memory=512m",
      "--cpus=0.5",
      "--pids-limit=50",
      "--network", "none",
      "--tmpfs", "/app:rw,noexec,nosuid,size=100m",
      "node:20-alpine",
      "tail", "-f", "/dev/null",
    ];

    try {
      await execFileAsync(this.engine, args);
      console.log(`[Tenaga:Sandbox] Secure container ${this.containerId} is running.`);
      return true;
    } catch (error: any) {
      console.error(`[Tenaga:Sandbox] Failed to start container:`, error.message);
      return false;
    }
  }

  /**
   * Ejecuta código arbitrario dentro del entorno aislado.
   * Code is base64-encoded and decoded inside the container to avoid shell injection.
   */
  async executeCode(code: string, language: 'javascript' | 'python' | 'bash'): Promise<{ stdout: string, stderr: string, exitCode: number }> {
    const base64Code = Buffer.from(code).toString('base64');

    // Build the inner command that decodes base64 and pipes to the interpreter.
    // This runs inside `sh -c` within the container -- the base64 payload is safe
    // because base64 output contains only [A-Za-z0-9+/=].
    let innerCmd: string;
    switch(language) {
      case 'javascript':
        innerCmd = `echo '${base64Code}' | base64 -d | node`;
        break;
      case 'python':
        innerCmd = `echo '${base64Code}' | base64 -d | python3`;
        break;
      case 'bash':
        innerCmd = `echo '${base64Code}' | base64 -d | sh`;
        break;
    }

    const execArgs = ["exec", this.containerId, "sh", "-c", innerCmd];

    try {
      // Timeout estricto de 10 segundos por script
      const { stdout, stderr } = await execFileAsync(this.engine, execArgs, { timeout: 10000 });
      return { stdout, stderr, exitCode: 0 };
    } catch (error: any) {
      return {
        stdout: error.stdout || '',
        stderr: error.stderr || error.message || 'Execution failed or timed out.',
        exitCode: error.code || 1
      };
    }
  }

  /**
   * Destruye el entorno inmediatamente
   */
  async destroy() {
    try {
      await execFileAsync(this.engine, ["rm", "-f", this.containerId]);
      console.log(`[Tenaga:Sandbox] Container ${this.containerId} destroyed.`);
    } catch(e) {}
  }
}
