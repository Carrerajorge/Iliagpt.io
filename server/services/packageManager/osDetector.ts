import fs from "fs";
import os from "os";

export type OSFamily = "linux" | "macos" | "windows" | "wsl" | "unknown";

export interface OSContext {
  family: OSFamily;
  platform: NodeJS.Platform;
  release: string;
  distro?: string;
  version?: string;
  architecture: string;
  isContainer: boolean;
}

function readOsRelease(): { id?: string; versionId?: string } {
  try {
    const content = fs.readFileSync("/etc/os-release", "utf-8");
    const lines = content.split("\n");
    const lookup: Record<string, string> = {};
    for (const line of lines) {
      const [key, rawValue] = line.split("=");
      if (!key || !rawValue) continue;
      lookup[key.trim().toLowerCase()] = rawValue.replace(/^["']|["']$/g, "");
    }
    return {
      id: lookup["id"],
      versionId: lookup["version_id"],
    };
  } catch {
    return {};
  }
}

export function detectOS(): OSContext {
  const platform = process.platform;
  const release = os.release();
  const architecture = os.arch();
  const isWSL =
    platform === "linux" &&
    (release.toLowerCase().includes("microsoft") || !!process.env.WSL_DISTRO_NAME);

  const isContainer = fs.existsSync("/.dockerenv") || fs.existsSync("/run/.containerenv");

  let family: OSFamily = "unknown";
  if (platform === "darwin") {
    family = "macos";
  } else if (platform === "win32") {
    family = "windows";
  } else if (platform === "linux") {
    family = isWSL ? "wsl" : "linux";
  }

  const { id, versionId } = readOsRelease();

  return {
    family,
    platform,
    release,
    architecture,
    isContainer,
    distro: id,
    version: versionId,
  };
}
