import compressionLib from 'compression';
import type { Request, Response, NextFunction } from 'express';

export const compression = compressionLib({
  level: 6,
  threshold: 512,
  memLevel: 8,
  filter: (req: Request, res: Response) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    const contentType = res.getHeader('content-type');
    if (typeof contentType === 'string' && (
      contentType.includes('text/event-stream') ||
      contentType.includes('application/octet-stream')
    )) {
      return false;
    }
    return compressionLib.filter(req, res);
  },
});

export type { Request, Response, NextFunction };
