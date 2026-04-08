import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { metaImagesPlugin } from "./vite-plugin-meta-images";

const devBackendTarget = process.env.VITE_DEV_BACKEND_URL ?? "http://localhost:5050";

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    tailwindcss(),
    metaImagesPlugin(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  css: {
    postcss: {
      plugins: [],
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    target: "es2022",
    cssCodeSplit: true,
    sourcemap: false,
    minify: "esbuild",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react-dom")) return "react-dom";
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-is") || id.includes("node_modules/scheduler")) return "react-core";
          if (id.includes("@radix-ui")) return "ui-radix";
          if (id.includes("lucide-react")) return "ui-icons";
          if (id.includes("framer-motion")) return "ui-motion";
          if (id.includes("codemirror") || id.includes("@lezer")) return "editor";
          if (id.includes("@tanstack/react-query")) return "query";
          if (id.includes("wouter")) return "router";
          if (id.includes("@hookform") || id.includes("react-hook-form")) return "forms";
          if (id.includes("i18next") || id.includes("react-i18next")) return "i18n";
          if (id.includes("mermaid") || id.includes("elkjs") || id.includes("dagre") || id.includes("cytoscape")) return "vendor-diagrams";
          if (id.includes("exceljs") || id.includes("pptxgenjs") || id.includes("docx") || id.includes("pdfkit") || id.includes("mammoth")) return "vendor-docs";
          if (id.includes("shiki") || id.includes("oniguruma") || id.includes("@shikijs")) return undefined;
          if (id.includes("node_modules/")) return "vendor";
        },
      },
    },
    chunkSizeWarningLimit: 800,
  },
  optimizeDeps: {
    include: ["react", "react-dom", "wouter", "@tanstack/react-query"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/api": {
        target: devBackendTarget,
        changeOrigin: true,
        ws: true,
      },
      "/ws": {
        target: devBackendTarget,
        changeOrigin: true,
        ws: true,
      },
      "/health": {
        target: devBackendTarget,
        changeOrigin: true,
      },
      "/uploads": {
        target: devBackendTarget,
        changeOrigin: true,
      },
      "/artifacts": {
        target: devBackendTarget,
        changeOrigin: true,
      },
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
