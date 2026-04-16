/**
 * Optional Authentication Middleware
 * 
 * Tries to authenticate but doesn't fail if not authenticated.
 * Sets req.user if authenticated, undefined otherwise.
 */

import { Request, Response, NextFunction } from 'express';
import { getUserId } from '../types/express';

export function optionalAuth(req: Request, res: Response, next: NextFunction) {
    try {
        const userId = getUserId(req);
        if (userId) {
            (req as any).user = { id: userId };
        }
    } catch (error) {
        // Silently continue without auth
    }
    next();
}

export default optionalAuth;
