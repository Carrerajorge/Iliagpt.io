/**
 * Client-Side Logger Utility
 * Fix #11: Replace console.log in chat-interface.tsx with structured logging
 * 
 * This provides a consistent logging interface that:
 * - Can be easily toggled on/off
 * - Adds component prefixes for filtering
 * - Can be extended to send logs to a backend
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  component: string;
  message: string;
  data?: unknown;
  timestamp: Date;
}

// Check if we're in development mode
const isDev = typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    import.meta.env?.DEV);

// Log level filtering - in production, only show warnings and errors
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MIN_LOG_LEVEL: LogLevel = isDev ? 'debug' : 'warn';

class ClientLogger {
  private component: string;
  private enabled: boolean;

  constructor(component: string) {
    this.component = component;
    this.enabled = true;
  }

  private shouldLog(level: LogLevel): boolean {
    if (!this.enabled) return false;
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[MIN_LOG_LEVEL];
  }

  private formatMessage(level: LogLevel, message: string): string {
    return `[${this.component}] ${message}`;
  }

  debug(message: string, data?: unknown): void {
    if (!this.shouldLog('debug')) return;
    if (data !== undefined) {
      console.debug(this.formatMessage('debug', message), data);
    } else {
      console.debug(this.formatMessage('debug', message));
    }
  }

  info(message: string, data?: unknown): void {
    if (!this.shouldLog('info')) return;
    if (data !== undefined) {
      console.info(this.formatMessage('info', message), data);
    } else {
      console.info(this.formatMessage('info', message));
    }
  }

  warn(message: string, data?: unknown): void {
    if (!this.shouldLog('warn')) return;
    if (data !== undefined) {
      console.warn(this.formatMessage('warn', message), data);
    } else {
      console.warn(this.formatMessage('warn', message));
    }
  }

  error(message: string, error?: unknown): void {
    if (!this.shouldLog('error')) return;
    if (error !== undefined) {
      console.error(this.formatMessage('error', message), error);
    } else {
      console.error(this.formatMessage('error', message));
    }
  }

  /**
   * Create a child logger with a sub-component prefix
   */
  child(subComponent: string): ClientLogger {
    return new ClientLogger(`${this.component}:${subComponent}`);
  }

  /**
   * Disable logging for this instance
   */
  disable(): void {
    this.enabled = false;
  }

  /**
   * Enable logging for this instance
   */
  enable(): void {
    this.enabled = true;
  }
}

/**
 * Create a logger for a specific component
 * @param component Component name (e.g., 'ChatInterface', 'VoiceInput')
 */
export function createLogger(component: string): ClientLogger {
  return new ClientLogger(component);
}

/**
 * Pre-configured loggers for common components
 */
export const loggers = {
  chat: createLogger('ChatInterface'),
  voice: createLogger('VoiceInput'),
  docs: createLogger('DocEditor'),
  figma: createLogger('Figma'),
  agent: createLogger('Agent'),
  analysis: createLogger('Analysis'),
  message: createLogger('MessageList'),
};

// Named exports for components that import them directly
export const chatLogger = loggers.chat;
export const messageLogger = loggers.message;
export const voiceLogger = loggers.voice;
export const docsLogger = loggers.docs;
export const agentLogger = loggers.agent;

export default ClientLogger;
