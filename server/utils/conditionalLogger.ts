/**
 * Conditional Console Logger
 * 
 * Replaces console.log in production with a no-op or structured logging.
 * Import this at the top of files to use conditional logging.
 */

import { logger } from './logger';

const isProduction = process.env.NODE_ENV === 'production';
const isDebug = process.env.DEBUG === 'true';

export const devLog = {
    log: (...args: any[]) => {
        if (!isProduction || isDebug) {
            console.log(...args);
        }
    },
    info: (...args: any[]) => {
        if (!isProduction || isDebug) {
            console.info(...args);
        } else {
            logger.info(args.join(' '));
        }
    },
    warn: (...args: any[]) => {
        console.warn(...args);
        if (isProduction) {
            logger.warn(args.join(' '));
        }
    },
    error: (...args: any[]) => {
        console.error(...args);
        if (isProduction) {
            logger.error(args.join(' '));
        }
    },
    debug: (...args: any[]) => {
        if (!isProduction) {
            console.log('[DEBUG]', ...args);
        }
    }
};

// Override global console in production to reduce noise
export function setupProductionLogging() {
    if (isProduction && !isDebug) {
        const originalLog = console.log;
        const originalInfo = console.info;
        
        // Filter out verbose logs in production
        console.log = (...args: any[]) => {
            const message = args[0]?.toString() || '';
            // Allow important startup messages
            if (message.includes('✅') || 
                message.includes('🚀') || 
                message.includes('listening') ||
                message.includes('connected') ||
                message.includes('ERROR') ||
                message.includes('WARN')) {
                originalLog(...args);
            }
        };
        
        console.info = (...args: any[]) => {
            const message = args[0]?.toString() || '';
            if (message.includes('[') && message.includes(']')) {
                // Allow tagged logs like [Database] or [Server]
                originalInfo(...args);
            }
        };
    }
}

export default devLog;
