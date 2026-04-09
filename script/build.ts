import { build as esbuild } from "esbuild";
import { rm, readFile, writeFile, cp } from "fs/promises";
import { execSync } from "child_process";
import { existsSync } from "fs";
import path from "path";

const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "officeparser",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "zod",
  "zod-validation-error",
];

async function buildClient() {
  console.log("building client (Vite) in separate process...");
  execSync(
    "node --max-old-space-size=3072 node_modules/.bin/vite build",
    { stdio: "inherit", env: { ...process.env, NODE_ENV: "production" } },
  );
  console.log("client build complete.");
}

async function buildServer() {
  console.log("building server (esbuild)...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "esm",
    outfile: "dist/index.mjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    banner: {
      js: `
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
      `.trim(),
    },
    minify: true,
    external: externals,
    plugins: [
      {
        name: "native-node-modules",
        setup(build) {
          build.onResolve({ filter: /\.node$/ }, (args) => ({
            path: args.path,
            external: true,
          }));
        },
      },
    ],
    logLevel: "info",
  });

  console.log("creating start wrapper...");
  const startWrapper = `#!/usr/bin/env node
"use strict";
const { pathToFileURL } = require("url");
const { join } = require("path");
import(pathToFileURL(join(__dirname, "index.mjs")).href).catch(err => {
  console.error("Failed to start application:", err);
  process.exit(1);
});
`;
  await writeFile("dist/index.cjs", startWrapper, "utf-8");
  console.log("server build complete.");
}

async function copyOpenClawControlUI() {
  const src = path.join("node_modules", "openclaw", "dist", "control-ui");
  const dest = path.join("dist", "openclaw-control-ui");
  if (existsSync(src)) {
    console.log("copying OpenClaw control-ui assets...");
    await cp(src, dest, { recursive: true });
    console.log("OpenClaw control-ui assets copied.");
  } else {
    console.warn("OpenClaw control-ui not found, skipping copy.");
  }
}

async function buildAll() {
  await rm("dist", { recursive: true, force: true });
  await buildClient();
  await buildServer();
  await copyOpenClawControlUI();
}

async function pruneDevDeps() {
  console.log("pruning dev dependencies for production...");
  try {
    execSync("npm prune --omit=dev", { stdio: "inherit" });
  } catch (err) {
    console.warn("npm prune failed (non-fatal):", (err as Error).message?.split("\n")[0]);
  }
}

buildAll()
  .then(() => pruneDevDeps())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
