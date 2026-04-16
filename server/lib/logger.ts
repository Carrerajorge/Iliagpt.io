// Replaces the basic console.log in server/index.ts
// Uses a structured JSON format suitable for production logging stacks (ELK, Datadog, etc.)
import { logger } from "../utils/logger";

type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'security';

export class Logger {
    static info(message: string, context?: any) {
        logger.info(message, context);
    }

    static warn(message: string, context?: any) {
        logger.warn(message, context);
    }

    static error(message: string, error?: any) {
        if (error instanceof Error) {
            logger.error(message, {
                error: error.message,
                stack: error.stack,
                ...error
            });
        } else {
            logger.error(message, { error });
        }
    }

    static security(message: string, context?: any) {
        logger.warn(message, { ...context, category: 'security' });
    }

    // debug method missing in original but good to have compliant with standard
    static debug(message: string, context?: any) {
        logger.debug(message, context);
    }
}

// Backwards compatibility wrapper for existing code
export const log = (message: string, source = "express") => {
    Logger.info(`[${source}] ${message}`);
};
