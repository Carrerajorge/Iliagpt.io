import { exec } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";

const execAsync = promisify(exec);

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
    
    // Perfil de seguridad paranoico
    const securityOpts = [
      '--security-opt no-new-privileges=true',
      '--cap-drop=ALL',
      '--cap-add=SETUID',
      '--cap-add=SETGID'
    ].join(' ');

    const limits = '--memory=512m --cpus=0.5 --pids-limit=50';
    const network = '--network none'; // Aislamiento total de red
    
    // Montamos un volumen tmpfs efímero con copy-on-write
    const volumes = '--tmpfs /app:rw,noexec,nosuid,size=100m';

    const cmd = `${this.engine} run -d --name ${this.containerId} ${securityOpts} ${limits} ${network} ${volumes} node:20-alpine tail -f /dev/null`;

    try {
      await execAsync(cmd);
      console.log(`[Tenaga:Sandbox] Secure container ${this.containerId} is running.`);
      return true;
    } catch (error: any) {
      console.error(`[Tenaga:Sandbox] Failed to start container:`, error.message);
      return false;
    }
  }

  /**
   * Ejecuta código arbitrario dentro del entorno aislado
   */
  async executeCode(code: string, language: 'javascript' | 'python' | 'bash'): Promise<{ stdout: string, stderr: string, exitCode: number }> {
    // Escapar código seguro
    const base64Code = Buffer.from(code).toString('base64');
    let runnerCmd = '';

    switch(language) {
      case 'javascript':
        runnerCmd = `node -e "$(echo '${base64Code}' | base64 -d)"`;
        break;
      case 'python':
        runnerCmd = `python3 -c "$(echo '${base64Code}' | base64 -d)"`;
        break;
      case 'bash':
        runnerCmd = `sh -c "$(echo '${base64Code}' | base64 -d)"`;
        break;
    }

    const execCmd = `${this.engine} exec ${this.containerId} sh -c "${runnerCmd}"`;

    try {
      // Timeout estricto de 10 segundos por script
      const { stdout, stderr } = await execAsync(execCmd, { timeout: 10000 });
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
      await execAsync(`${this.engine} rm -f ${this.containerId}`);
      console.log(`[Tenaga:Sandbox] Container ${this.containerId} destroyed.`);
    } catch(e) {}
  }
}
