// Express 4 does NOT forward rejected promises from async handlers to the
// error-handling middleware — an awaited throw would hang the request (or
// surface as an unhandled rejection). Wrap every async route handler with
// `ah(...)` so errors reliably reach next(err) -> the global error middleware.
import type { Request, Response, NextFunction } from 'express';

export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
