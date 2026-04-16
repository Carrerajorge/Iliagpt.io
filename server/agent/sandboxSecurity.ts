import { z } from "zod";

export const SandboxConfigSchema = z.object({
  allowNetwork: z.boolean().default(false),
  allowedHosts: z.array(z.string()).default([]),
  maxMemoryMB: z.number().int().positive().default(512),
  maxCpuPercent: z.number().int().min(1).max(100).default(50),
  maxExecutionTimeMs: z.number().int().positive().default(30000),
  blockedModules: z.array(z.string()).default([
    "child_process",
    "fs",
    "net",
    "dgram",
    "cluster",
    "worker_threads",
    "vm"
  ]),
  allowedModules: z.array(z.string()).default([]),
});

export type SandboxConfig = z.infer<typeof SandboxConfigSchema>;

const DEFAULT_CONFIG: SandboxConfig = {
  allowNetwork: false,
  allowedHosts: [],
  maxMemoryMB: 512,
  maxCpuPercent: 50,
  maxExecutionTimeMs: 30000,
  blockedModules: ["child_process", "fs", "net", "dgram", "cluster", "worker_threads", "vm"],
  allowedModules: [],
};

const WEBTOOL_CONFIG: SandboxConfig = {
  allowNetwork: true,
  allowedHosts: [
    "*.google.com",
    "*.bing.com", 
    "*.duckduckgo.com",
    "*.wikipedia.org",
    "*.github.com",
    "*.stackoverflow.com",
    "*.worldbank.org",
    "api.worldbank.org",
  ],
  maxMemoryMB: 1024,
  maxCpuPercent: 75,
  maxExecutionTimeMs: 60000,
  blockedModules: ["child_process", "cluster", "worker_threads", "vm"],
  allowedModules: ["http", "https", "url", "querystring"],
};

export type SecurityProfile = "default" | "webtool" | "code_execution";

const SECURITY_PROFILES: Record<SecurityProfile, SandboxConfig> = {
  default: DEFAULT_CONFIG,
  webtool: WEBTOOL_CONFIG,
  code_execution: {
    ...DEFAULT_CONFIG,
    maxExecutionTimeMs: 30000,
    maxMemoryMB: 256,
  },
};

export class SandboxSecurityManager {
  private config: SandboxConfig;
  
  constructor(config: Partial<SandboxConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  isModuleAllowed(moduleName: string): boolean {
    if (this.config.blockedModules.includes(moduleName)) {
      console.warn(`[SandboxSecurity] Blocked module: ${moduleName}`);
      return false;
    }
    if (this.config.allowedModules.length > 0 && !this.config.allowedModules.includes(moduleName)) {
      console.warn(`[SandboxSecurity] Module not in allowlist: ${moduleName}`);
      return false;
    }
    return true;
  }
  
  isHostAllowed(host: string): boolean {
    if (!this.config.allowNetwork) {
      console.warn(`[SandboxSecurity] Network access denied (disabled)`);
      return false;
    }
    if (this.config.allowedHosts.length === 0) {
      return true;
    }
    const normalizedHost = host.toLowerCase();
    const allowed = this.config.allowedHosts.some(pattern => {
      const normalizedPattern = pattern.toLowerCase();
      if (normalizedPattern.startsWith("*.")) {
        const suffix = normalizedPattern.slice(1);
        return normalizedHost.endsWith(suffix) || normalizedHost === normalizedPattern.slice(2);
      }
      return normalizedHost === normalizedPattern;
    });
    if (!allowed) {
      console.warn(`[SandboxSecurity] Host not in allowlist: ${host}`);
    }
    return allowed;
  }
  
  getResourceLimits(): { memory: number; cpu: number; time: number } {
    return {
      memory: this.config.maxMemoryMB * 1024 * 1024,
      cpu: this.config.maxCpuPercent,
      time: this.config.maxExecutionTimeMs,
    };
  }
  
  validateConfig(): { valid: boolean; errors: string[] } {
    const result = SandboxConfigSchema.safeParse(this.config);
    if (!result.success) {
      return { valid: false, errors: result.error.errors.map(e => e.message) };
    }
    return { valid: true, errors: [] };
  }

  static forProfile(profile: SecurityProfile): SandboxSecurityManager {
    return new SandboxSecurityManager(SECURITY_PROFILES[profile]);
  }

  static getProfile(profile: SecurityProfile): SandboxConfig {
    return { ...SECURITY_PROFILES[profile] };
  }

  isHostAllowedWithWildcard(host: string): boolean {
    if (!this.config.allowNetwork) {
      return false;
    }
    if (this.config.allowedHosts.length === 0) {
      return true;
    }
    const normalizedHost = host.toLowerCase();
    return this.config.allowedHosts.some(pattern => {
      if (pattern.startsWith("*.")) {
        const suffix = pattern.slice(1);
        return normalizedHost.endsWith(suffix) || normalizedHost === pattern.slice(2);
      }
      return normalizedHost === pattern.toLowerCase();
    });
  }
}

export const sandboxSecurity = new SandboxSecurityManager();
export const webtoolSecurity = SandboxSecurityManager.forProfile("webtool");
