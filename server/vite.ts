import { type Express } from "express";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";

const viteLogger = createLogger();

export async function setupVite(server: Server, app: Express) {
  const clientRoot = path.resolve(import.meta.dirname, "..", "client");
  
  const vite = await createViteServer({
    configFile: path.resolve(import.meta.dirname, "..", "vite.config.ts"),
    root: clientRoot,
    server: {
      middlewareMode: true,
      hmr: { server, path: "/vite-hmr" },
    },
    appType: "custom",
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        // Don't exit on error - let the server continue running
      },
    },
  });

  app.use(vite.middlewares);

  // SPA fallback - only for routes that are not API or Vite-served files
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    // Skip if this looks like an API route or a file that Vite should handle
    if (url.startsWith("/api") || 
        url.startsWith("/src/") || 
        url.startsWith("/@") ||
        url.startsWith("/node_modules/") ||
        url.includes(".") && !url.endsWith(".html")) {
      return next();
    }

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}
