/**
 * Express 4 does not automatically forward promise rejections from async route
 * handlers to `next(err)`. A single `async (req, res) => { ... }` that throws can
 * become an unhandled rejection and crash the process or leave the request hanging.
 *
 * This patch wraps Express' internal Layer handlers to forward promise rejections
 * to the error middleware chain.
 *
 * Keep this file side-effectful and import it once in the server entrypoint.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

type NextFn = (err?: unknown) => void;

function isThenable(value: unknown): value is Promise<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    typeof (value as any).then === "function" &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    typeof (value as any).catch === "function"
  );
}

function patchOnce() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Layer = require("express/lib/router/layer");

  if (!Layer?.prototype) return;

  if (Layer.prototype.__iliagptAsyncPatched) return;
  Layer.prototype.__iliagptAsyncPatched = true;

  const originalHandleRequest = Layer.prototype.handle_request;
  const originalHandleError = Layer.prototype.handle_error;

  Layer.prototype.handle_request = function handle_request(req: unknown, res: unknown, next: NextFn) {
    // Express checks handler arity; keep the same semantics.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = (this as any).handle;
    if (typeof fn !== "function") {
      return originalHandleRequest.call(this, req, res, next);
    }

    if (fn.length > 3) {
      return next();
    }

    try {
      const result = fn(req, res, next);
      if (isThenable(result)) {
        result.catch(next);
      }
    } catch (err) {
      next(err);
    }
  };

  Layer.prototype.handle_error = function handle_error(err: unknown, req: unknown, res: unknown, next: NextFn) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = (this as any).handle;
    if (typeof fn !== "function") {
      return originalHandleError.call(this, err, req, res, next);
    }

    if (fn.length !== 4) {
      return next(err);
    }

    try {
      const result = fn(err, req, res, next);
      if (isThenable(result)) {
        result.catch(next);
      }
    } catch (nextErr) {
      next(nextErr);
    }
  };
}

patchOnce();

