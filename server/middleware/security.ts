import helmet, { type ContentSecurityPolicyOptions } from "helmet";
import { Express } from "express";

const isProduction = process.env.NODE_ENV === "production";

const cspDirectives: NonNullable<ContentSecurityPolicyOptions["directives"]> = {
  defaultSrc: ["'self'"],
  scriptSrc: [
    "'self'",
    ...(isProduction ? [] : ["'unsafe-inline'", "'unsafe-eval'"]),
    "https://cdn.jsdelivr.net",
    "https://accounts.google.com",
  ],
  styleSrc: [
    "'self'",
    "'unsafe-inline'",
    "https://fonts.googleapis.com",
    "https://cdn.jsdelivr.net",
    "https://cdnjs.cloudflare.com",
  ],
  imgSrc: [
    "'self'",
    "data:",
    "blob:",
    "https://lh3.googleusercontent.com",
    "https://*.googleusercontent.com",
    "https://files.stripe.com",
  ],
  connectSrc: [
    "'self'",
    "https://api.x.ai",
    "https://generativelanguage.googleapis.com",
    "https://api.openai.com",
    "https://api.anthropic.com",
    "https://accounts.google.com",
    "wss:",
    ...(isProduction ? [] : ["ws:", "http:"]),
  ],
  fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net", "data:"],
  workerSrc: ["'self'", "blob:", "https://cdnjs.cloudflare.com"],
  frameSrc: ["'self'", "blob:", "https://accounts.google.com"],
  frameAncestors: ["'self'"],
  objectSrc: ["'self'", "blob:"],
  baseUri: ["'self'"],
  formAction: ["'self'", "https://accounts.google.com"],
};

if (isProduction) {
  cspDirectives.upgradeInsecureRequests = [];
}

export const setupSecurity = (app: Express) => {
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: cspDirectives,
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: isProduction ? "same-origin" : "cross-origin" },
      crossOriginOpenerPolicy: { policy: "same-origin" },
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      hsts: isProduction ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
    })
  );

  // Permissions-Policy: restrict sensitive browser APIs
  app.use((_req, res, next) => {
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=(self), usb=(), magnetometer=(), gyroscope=(), accelerometer=()"
    );
    next();
  });
};
