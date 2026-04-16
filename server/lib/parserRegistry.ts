/**
 * Parser Registry - Extensible parser management with circuit breaker
 * PARE Phase 2 Security Hardening
 * 
 * Provides a centralized registry for document parsers with:
 * - Priority-based parser selection
 * - Circuit breaker pattern for fault tolerance (CLOSED, OPEN, HALF_OPEN states)
 * - Fallback to text extraction on parse failures
 * - Per-parser configuration with success threshold in half-open state
 */

import type { FileParser, ParsedResult, DetectedFileType } from "../parsers/base";
import { SandboxErrorCode } from "./parserSandbox";

export enum CircuitBreakerStateEnum {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half-open',
}

export interface ParserRegistration {
  parser: FileParser;
  mimeTypes: string[];
  priority: number;
  options?: ParserOptions;
}

export interface ParserOptions {
  maxRetries?: number;
  failureThreshold?: number;
  resetTimeout?: number;
  successThreshold?: number;
  fallbackEnabled?: boolean;
  /** @deprecated Use failureThreshold instead */
  circuitBreakerThreshold?: number;
  /** @deprecated Use resetTimeout instead */
  circuitBreakerResetMs?: number;
}

export interface CircuitBreakerState {
  failures: number;
  successes: number;
  lastFailure: number;
  lastStateChange: number;
  state: CircuitBreakerStateEnum;
  totalCalls: number;
  totalFailures: number;
  halfOpenAllowed: boolean;
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeout: number;
  successThreshold: number;
}

export interface ParseAttemptResult {
  success: boolean;
  result?: ParsedResult;
  error?: string;
  errorCode?: string;
  parserUsed: string;
  fallbackUsed: boolean;
  circuitBreakerTripped: boolean;
}

const DEFAULT_OPTIONS = {
  maxRetries: 1,
  failureThreshold: 5,
  resetTimeout: 60000,
  successThreshold: 2,
  fallbackEnabled: true,
};

function normalizeOptions(options?: Partial<ParserOptions>): typeof DEFAULT_OPTIONS {
  if (!options) return { ...DEFAULT_OPTIONS };
  
  return {
    maxRetries: options.maxRetries ?? DEFAULT_OPTIONS.maxRetries,
    failureThreshold: options.failureThreshold ?? options.circuitBreakerThreshold ?? DEFAULT_OPTIONS.failureThreshold,
    resetTimeout: options.resetTimeout ?? options.circuitBreakerResetMs ?? DEFAULT_OPTIONS.resetTimeout,
    successThreshold: options.successThreshold ?? DEFAULT_OPTIONS.successThreshold,
    fallbackEnabled: options.fallbackEnabled ?? DEFAULT_OPTIONS.fallbackEnabled,
  };
}

export class ParserRegistry {
  private registrations: Map<string, ParserRegistration[]> = new Map();
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
  private circuitBreakerConfigs: Map<string, CircuitBreakerConfig> = new Map();
  private fallbackParser: FileParser | null = null;
  private globalOptions: typeof DEFAULT_OPTIONS;

  constructor(options?: Partial<ParserOptions>) {
    this.globalOptions = normalizeOptions(options);
  }

  /**
   * Register a parser for specific MIME types
   */
  registerParser(
    mimeTypes: string[],
    parser: FileParser,
    priority: number = 100,
    options?: ParserOptions
  ): void {
    const parserOpts = normalizeOptions({ ...this.globalOptions, ...options });
    
    const registration: ParserRegistration = {
      parser,
      mimeTypes,
      priority,
      options: parserOpts,
    };

    for (const mimeType of mimeTypes) {
      const existing = this.registrations.get(mimeType) || [];
      existing.push(registration);
      existing.sort((a, b) => a.priority - b.priority);
      this.registrations.set(mimeType, existing);
    }

    this.circuitBreakers.set(parser.name, {
      failures: 0,
      successes: 0,
      lastFailure: 0,
      lastStateChange: Date.now(),
      state: CircuitBreakerStateEnum.CLOSED,
      totalCalls: 0,
      totalFailures: 0,
      halfOpenAllowed: true,
    });

    this.circuitBreakerConfigs.set(parser.name, {
      failureThreshold: parserOpts.failureThreshold!,
      resetTimeout: parserOpts.resetTimeout!,
      successThreshold: parserOpts.successThreshold!,
    });

    console.log(`[ParserRegistry] Registered parser: ${parser.name} for ${mimeTypes.join(', ')} (priority: ${priority})`);
  }

  /**
   * Set the fallback parser for when all registered parsers fail
   */
  setFallbackParser(parser: FileParser): void {
    this.fallbackParser = parser;
    console.log(`[ParserRegistry] Set fallback parser: ${parser.name}`);
  }

  /**
   * Get all parsers registered for a MIME type, sorted by priority
   */
  getParsersForMime(mimeType: string): ParserRegistration[] {
    return this.registrations.get(mimeType) || [];
  }

  /**
   * Get the current state of a circuit breaker
   */
  getCircuitState(parserName: string): CircuitBreakerStateEnum | null {
    const state = this.circuitBreakers.get(parserName);
    if (!state) return null;
    
    this.updateCircuitState(parserName);
    return state.state;
  }

  /**
   * Update circuit breaker state based on time elapsed
   */
  private updateCircuitState(parserName: string): void {
    const state = this.circuitBreakers.get(parserName);
    const config = this.circuitBreakerConfigs.get(parserName);
    if (!state || !config) return;

    if (state.state === CircuitBreakerStateEnum.OPEN) {
      const timeSinceFailure = Date.now() - state.lastFailure;
      if (timeSinceFailure >= config.resetTimeout) {
        state.state = CircuitBreakerStateEnum.HALF_OPEN;
        state.lastStateChange = Date.now();
        state.halfOpenAllowed = true;
        state.successes = 0;
        console.log(`[ParserRegistry] Circuit breaker transitioned to HALF_OPEN for: ${parserName}`);
      }
    }
  }

  /**
   * Check if a parser's circuit breaker is open
   */
  isCircuitOpen(parserName: string): boolean {
    const state = this.circuitBreakers.get(parserName);
    if (!state) return false;

    this.updateCircuitState(parserName);

    if (state.state === CircuitBreakerStateEnum.OPEN) {
      return true;
    }

    if (state.state === CircuitBreakerStateEnum.HALF_OPEN) {
      if (!state.halfOpenAllowed) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a request should be allowed in half-open state
   */
  allowHalfOpenRequest(parserName: string): boolean {
    const state = this.circuitBreakers.get(parserName);
    if (!state) return true;
    
    this.updateCircuitState(parserName);

    if (state.state === CircuitBreakerStateEnum.HALF_OPEN && state.halfOpenAllowed) {
      state.halfOpenAllowed = false;
      return true;
    }

    return state.state === CircuitBreakerStateEnum.CLOSED;
  }

  /**
   * Record a parser success
   */
  recordSuccess(parserName: string): void {
    const state = this.circuitBreakers.get(parserName);
    const config = this.circuitBreakerConfigs.get(parserName);
    if (!state || !config) return;

    state.totalCalls++;

    if (state.state === CircuitBreakerStateEnum.HALF_OPEN) {
      state.successes++;
      state.halfOpenAllowed = true;
      
      if (state.successes >= config.successThreshold) {
        state.state = CircuitBreakerStateEnum.CLOSED;
        state.failures = 0;
        state.successes = 0;
        state.lastStateChange = Date.now();
        console.log(`[ParserRegistry] Circuit breaker CLOSED for: ${parserName} (${config.successThreshold} successes in half-open)`);
      }
    } else if (state.state === CircuitBreakerStateEnum.CLOSED) {
      state.failures = Math.max(0, state.failures - 1);
    }
  }

  /**
   * Record a parser failure
   */
  recordFailure(parserName: string): void {
    const state = this.circuitBreakers.get(parserName);
    const config = this.circuitBreakerConfigs.get(parserName);
    if (!state || !config) return;

    state.failures++;
    state.totalFailures++;
    state.totalCalls++;
    state.lastFailure = Date.now();

    if (state.state === CircuitBreakerStateEnum.HALF_OPEN) {
      state.state = CircuitBreakerStateEnum.OPEN;
      state.lastStateChange = Date.now();
      state.successes = 0;
      console.warn(`[ParserRegistry] Circuit breaker OPENED from half-open for: ${parserName} (failure during test)`);
    } else if (state.state === CircuitBreakerStateEnum.CLOSED) {
      if (state.failures >= config.failureThreshold) {
        state.state = CircuitBreakerStateEnum.OPEN;
        state.lastStateChange = Date.now();
        console.warn(`[ParserRegistry] Circuit breaker OPENED for: ${parserName} (${state.failures} consecutive failures)`);
      }
    }
  }

  /**
   * Parse content using registered parsers with fallback
   */
  async parse(
    content: Buffer,
    fileType: DetectedFileType,
    filename?: string
  ): Promise<ParseAttemptResult> {
    const parsers = this.getParsersForMime(fileType.mimeType);
    
    if (parsers.length === 0 && !this.fallbackParser) {
      return {
        success: false,
        error: `No parser registered for MIME type: ${fileType.mimeType}`,
        parserUsed: 'none',
        fallbackUsed: false,
        circuitBreakerTripped: false,
      };
    }

    let lastError: string | undefined;
    let circuitBreakerTripped = false;

    for (const registration of parsers) {
      const { parser } = registration;
      const state = this.circuitBreakers.get(parser.name);
      
      this.updateCircuitState(parser.name);

      if (state?.state === CircuitBreakerStateEnum.OPEN) {
        circuitBreakerTripped = true;
        console.log(`[ParserRegistry] Skipping ${parser.name} - circuit breaker OPEN`);
        continue;
      }

      if (state?.state === CircuitBreakerStateEnum.HALF_OPEN) {
        if (!this.allowHalfOpenRequest(parser.name)) {
          circuitBreakerTripped = true;
          console.log(`[ParserRegistry] Skipping ${parser.name} - circuit breaker HALF_OPEN (test in progress)`);
          continue;
        }
        console.log(`[ParserRegistry] Allowing test request for ${parser.name} in HALF_OPEN state`);
      }

      try {
        const result = await parser.parse(content, fileType);
        this.recordSuccess(parser.name);

        return {
          success: true,
          result: {
            ...result,
            metadata: {
              ...result.metadata,
              parser_used: parser.name,
              filename,
            },
          },
          parserUsed: parser.name,
          fallbackUsed: false,
          circuitBreakerTripped,
        };
      } catch (error) {
        this.recordFailure(parser.name);
        lastError = error instanceof Error ? error.message : String(error);
        console.warn(`[ParserRegistry] Parser ${parser.name} failed: ${lastError}`);
      }
    }

    if (this.fallbackParser && this.globalOptions.fallbackEnabled) {
      try {
        console.log(`[ParserRegistry] Using fallback parser for ${fileType.mimeType}`);
        const result = await this.fallbackParser.parse(content, fileType);
        
        return {
          success: true,
          result: {
            ...result,
            metadata: {
              ...result.metadata,
              parser_used: `fallback:${this.fallbackParser.name}`,
              original_mime: fileType.mimeType,
              filename,
            },
            warnings: [
              ...(result.warnings || []),
              `Original parsers failed, used fallback text extraction`,
            ],
          },
          parserUsed: this.fallbackParser.name,
          fallbackUsed: true,
          circuitBreakerTripped,
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        console.error(`[ParserRegistry] Fallback parser also failed: ${lastError}`);
      }
    }

    const errorCode = circuitBreakerTripped ? SandboxErrorCode.CIRCUIT_BREAKER_OPEN : undefined;

    return {
      success: false,
      error: lastError || 'All parsers failed',
      errorCode,
      parserUsed: 'none',
      fallbackUsed: false,
      circuitBreakerTripped,
    };
  }

  /**
   * Get circuit breaker status for all parsers (for monitoring)
   */
  getCircuitBreakerStatus(): Record<string, CircuitBreakerState> {
    const status: Record<string, CircuitBreakerState> = {};
    this.circuitBreakers.forEach((state, name) => {
      this.updateCircuitState(name);
      status[name] = { ...state };
    });
    return status;
  }

  /**
   * Get all circuit breaker states (alias for getCircuitBreakerStatus)
   */
  getCircuitBreakerStates(): Record<string, CircuitBreakerState> {
    return this.getCircuitBreakerStatus();
  }

  /**
   * Reset circuit breaker for a specific parser
   */
  resetCircuitBreaker(parserName: string): void {
    const state = this.circuitBreakers.get(parserName);
    if (state) {
      state.failures = 0;
      state.successes = 0;
      state.state = CircuitBreakerStateEnum.CLOSED;
      state.lastStateChange = Date.now();
      state.halfOpenAllowed = true;
      console.log(`[ParserRegistry] Circuit breaker manually reset for: ${parserName}`);
    }
  }

  /**
   * Reset all circuit breakers
   */
  resetAllCircuitBreakers(): void {
    this.circuitBreakers.forEach((state, name) => {
      state.failures = 0;
      state.successes = 0;
      state.state = CircuitBreakerStateEnum.CLOSED;
      state.lastStateChange = Date.now();
      state.halfOpenAllowed = true;
    });
    console.log(`[ParserRegistry] All circuit breakers reset`);
  }

  /**
   * Unregister a parser
   */
  unregisterParser(parserName: string): void {
    this.registrations.forEach((registrations, mimeType) => {
      const filtered = registrations.filter(r => r.parser.name !== parserName);
      if (filtered.length > 0) {
        this.registrations.set(mimeType, filtered);
      } else {
        this.registrations.delete(mimeType);
      }
    });
    this.circuitBreakers.delete(parserName);
    this.circuitBreakerConfigs.delete(parserName);
    console.log(`[ParserRegistry] Unregistered parser: ${parserName}`);
  }

  /**
   * Get all registered MIME types
   */
  getRegisteredMimeTypes(): string[] {
    return Array.from(this.registrations.keys());
  }

  /**
   * Get all registered parser names
   */
  getRegisteredParsers(): string[] {
    const names = new Set<string>();
    this.registrations.forEach(regs => {
      regs.forEach(r => names.add(r.parser.name));
    });
    return Array.from(names);
  }
}

export function createParserRegistry(options?: Partial<ParserOptions>): ParserRegistry {
  return new ParserRegistry(options);
}

export const defaultParserRegistry = new ParserRegistry();
