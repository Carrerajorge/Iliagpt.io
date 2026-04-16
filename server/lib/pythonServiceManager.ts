import { spawn, ChildProcess } from 'child_process';

function logMessage(message: string, source = 'python-service') {
  const formattedTime = new Date().toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

interface PythonServiceOptions {
  port: number;
  host: string;
  startupDelayMs: number;
  healthCheckRetries: number;
  healthCheckIntervalMs: number;
}

const defaultOptions: PythonServiceOptions = {
  port: 8001,
  host: '0.0.0.0',
  startupDelayMs: 2000,
  healthCheckRetries: 10,
  healthCheckIntervalMs: 1000,
};

class PythonServiceManager {
  private process: ChildProcess | null = null;
  private options: PythonServiceOptions;
  private isShuttingDown = false;

  constructor(options: Partial<PythonServiceOptions> = {}) {
    this.options = { ...defaultOptions, ...options };
  }

  async start(): Promise<boolean> {
    if (this.process) {
      logMessage('Python service already running');
      return true;
    }

    const pythonDir = process.cwd() + '/python_agent_tools';
    const command = 'python';
    const args = [
      '-m', 'uvicorn',
      'src.api.main:app',
      '--host', this.options.host,
      '--port', String(this.options.port),
    ];

    logMessage(`Starting Python Agent Tools service on port ${this.options.port}...`);

    return new Promise((resolve) => {
      try {
        this.process = spawn(command, args, {
          cwd: pythonDir,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env },
          detached: false,
        });

        this.process.stdout?.on('data', (data: Buffer) => {
          const message = data.toString().trim();
          if (message) {
            logMessage(message);
          }
        });

        this.process.stderr?.on('data', (data: Buffer) => {
          const message = data.toString().trim();
          if (message) {
            logMessage(message);
          }
        });

        this.process.on('error', (error) => {
          logMessage(`Failed to start Python service: ${error.message}`);
          this.process = null;
          resolve(false);
        });

        this.process.on('exit', (code, signal) => {
          if (!this.isShuttingDown) {
            logMessage(`Python service exited with code ${code}, signal ${signal}`);
          }
          this.process = null;
        });

        this.waitForHealthy().then((healthy) => {
          if (healthy) {
            logMessage(`Python Agent Tools service started successfully on port ${this.options.port}`);
            resolve(true);
          } else {
            logMessage('Python service failed health check');
            this.stop();
            resolve(false);
          }
        });
      } catch (error) {
        logMessage(`Error starting Python service: ${error}`);
        resolve(false);
      }
    });
  }

  private async waitForHealthy(): Promise<boolean> {
    await this.sleep(this.options.startupDelayMs);

    for (let i = 0; i < this.options.healthCheckRetries; i++) {
      try {
        const response = await fetch(`http://localhost:${this.options.port}/health`);
        if (response.ok) {
          return true;
        }
      } catch {
        // Service not ready yet
      }
      await this.sleep(this.options.healthCheckIntervalMs);
    }

    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  stop(): void {
    if (this.process) {
      this.isShuttingDown = true;
      logMessage('Stopping Python Agent Tools service...');

      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(this.process.pid), '/f', '/t']);
        } else {
          this.process.kill('SIGTERM');

          setTimeout(() => {
            if (this.process && !this.process.killed) {
              this.process.kill('SIGKILL');
            }
          }, 5000);
        }
      } catch (error) {
        logMessage(`Error stopping Python service: ${error}`);
      }

      this.process = null;
      this.isShuttingDown = false;
      logMessage('Python Agent Tools service stopped');
    }
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  getPort(): number {
    return this.options.port;
  }
}

export const pythonServiceManager = new PythonServiceManager({
  port: parseInt(process.env.PYTHON_TOOLS_PORT || '8001', 10),
});

export { PythonServiceManager, PythonServiceOptions };
