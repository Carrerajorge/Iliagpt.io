#!/usr/bin/env node
/**
 * with-env.cjs — Sets environment variables from CLI args, then spawns a child process.
 *
 * Usage: node scripts/with-env.cjs KEY=VALUE KEY2=VALUE2 -- command args...
 *
 * Everything before `--` is parsed as KEY=VALUE env pairs.
 * Everything after `--` is the command to run with those env vars set.
 */

"use strict";

const { execFileSync } = require("child_process");

const args = process.argv.slice(2);
const separatorIdx = args.indexOf("--");

if (separatorIdx === -1) {
  console.error("Usage: node scripts/with-env.cjs KEY=VALUE ... -- command ...");
  process.exit(1);
}

const envPairs = args.slice(0, separatorIdx);
const commandArgs = args.slice(separatorIdx + 1);

if (commandArgs.length === 0) {
  console.error("No command specified after --");
  process.exit(1);
}

// Apply env vars
for (const pair of envPairs) {
  const eqIdx = pair.indexOf("=");
  if (eqIdx === -1) continue;
  const key = pair.slice(0, eqIdx);
  const value = pair.slice(eqIdx + 1);
  process.env[key] = value;
}

const [cmd, ...cmdArgs] = commandArgs;

try {
  execFileSync(cmd, cmdArgs, { stdio: "inherit", env: process.env });
} catch (err) {
  process.exit(err.status || 1);
}
