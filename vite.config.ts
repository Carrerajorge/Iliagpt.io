import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { metaImagesPlugin } from "./vite-plugin-meta-images";

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
    minify: "terser",
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        passes: 2,
        pure_funcs: ["console.log", "console.debug", "console.info"],
      },
      mangle: {
        safari10: true,
      },
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react-dom")) return "react-dom";
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-is") || id.includes("node_modules/scheduler")) return "react-core";
          if (id.includes("@radix-ui")) return "ui-radix";
          if (id.includes("lucide-react")) return "ui-icons";
          if (id.includes("framer-motion")) return "ui-motion";
          if (id.includes("recharts") || id.includes("d3-")) return "charts";
          if (id.includes("codemirror") || id.includes("@lezer")) return "editor";
          if (id.includes("@tanstack/react-query")) return "query";
          if (id.includes("wouter")) return "router";
          if (id.includes("marked") || id.includes("highlight.js") || id.includes("prismjs") || id.includes("katex")) return "rendering";
          if (id.includes("zod") || id.includes("drizzle")) return "schema";
          if (id.includes("date-fns") || id.includes("lodash") || id.includes("clsx") || id.includes("class-variance-authority") || id.includes("tailwind-merge")) return "utils";
          if (id.includes("@hookform") || id.includes("react-hook-form")) return "forms";
          if (id.includes("axios") || id.includes("ky") || id.includes("socket.io")) return "network";
          if (id.includes("i18next") || id.includes("react-i18next")) return "i18n";
          if (id.includes("dompurify") || id.includes("sanitize")) return "security";
          if (id.includes("node_modules/")) return "vendor";
        },
      },
    },
    chunkSizeWarningLimit: 500,
  },
  optimizeDeps: {
    include: ["react", "react-dom", "wouter", "@tanstack/react-query"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
