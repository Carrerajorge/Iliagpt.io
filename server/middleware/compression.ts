/**
 * Production-ready compression middleware using the standard npm compression package.
 * Replaces the buggy custom implementation that caused "write after end" crashes.
 */
import compressionLib from 'compression';
import type { Request, Response, NextFunction } from 'express';

// Use the standard compression library with production-safe settings
export const compression = compressionLib({
  // Compression level (1-9, higher = better compression but slower)
  level: 9,
  // Minimum size to compress (don't compress tiny responses)
  threshold: 1024,
  // Filter function to determine which responses to compress
  filter: (req: Request, res: Response) => {
    // Don't compress if the client doesn't support it
    if (req.headers['x-no-compression']) {
      return false;
    }
    // Use the default filter for everything else
    return compressionLib.filter(req, res);
  },
});

// Export types for compatibility
export type { Request, Response, NextFunction };
