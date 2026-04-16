
export interface FigmaFile {
  key: string;
  name: string;
  thumbnailUrl?: string;
  lastModified: string;
}

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  children?: FigmaNode[];
  absoluteBoundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  fills?: any[];
  strokes?: any[];
  effects?: any[];
  style?: any;
  characters?: string;
}

export interface FigmaDesignToken {
  name: string;
  type: "color" | "typography" | "spacing" | "effect";
  value: any;
  description?: string;
}

export interface FigmaCodeContext {
  html: string;
  css: string;
  react: string;
  tokens: FigmaDesignToken[];
}

const FIGMA_API_BASE = "https://api.figma.com/v1";

class FigmaService {
  private accessToken: string | null = null;

  setAccessToken(token: string) {
    this.accessToken = token;
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  private async request<T>(endpoint: string): Promise<T> {
    if (!this.accessToken) {
      throw new Error("Figma access token not configured");
    }

    // Validate endpoint to prevent SSRF via path injection (CodeQL: server-side-request-forgery)
    if (!/^\/[\w\-\/.,?=&%]+$/.test(endpoint)) {
      throw new Error("Invalid Figma API endpoint");
    }
    const fullUrl = `${FIGMA_API_BASE}${endpoint}`;
    const parsed = new URL(fullUrl);
    if (parsed.origin !== new URL(FIGMA_API_BASE).origin) {
      throw new Error("Figma API endpoint resolves to unexpected origin");
    }

    const response = await fetch(fullUrl, {
      headers: {
        "X-Figma-Token": this.accessToken,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Figma API error: ${response.status} - ${error}`);
    }

    return response.json() as Promise<T>;
  }

  async getFile(fileKey: string): Promise<any> {
    return this.request(`/files/${fileKey}`);
  }

  async getFileNodes(fileKey: string, nodeIds: string[]): Promise<any> {
    const ids = nodeIds.join(",");
    return this.request(`/files/${fileKey}/nodes?ids=${encodeURIComponent(ids)}`);
  }

  async getImages(fileKey: string, nodeIds: string[], format: "png" | "svg" | "jpg" = "png", scale: number = 2): Promise<Record<string, string>> {
    const ids = nodeIds.join(",");
    const result = await this.request<{ images: Record<string, string> }>(
      `/images/${fileKey}?ids=${encodeURIComponent(ids)}&format=${format}&scale=${scale}`
    );
    return result.images;
  }

  async getTeamProjects(teamId: string): Promise<any> {
    return this.request(`/teams/${teamId}/projects`);
  }

  async getProjectFiles(projectId: string): Promise<FigmaFile[]> {
    const result = await this.request<{ files: any[] }>(`/projects/${projectId}/files`);
    return result.files.map((f: any) => ({
      key: f.key,
      name: f.name,
      thumbnailUrl: f.thumbnail_url,
      lastModified: f.last_modified,
    }));
  }

  async getLocalVariables(fileKey: string): Promise<any> {
    return this.request(`/files/${fileKey}/variables/local`);
  }

  async getStyles(fileKey: string): Promise<any> {
    return this.request(`/files/${fileKey}/styles`);
  }

  extractDesignTokens(fileData: any): FigmaDesignToken[] {
    const tokens: FigmaDesignToken[] = [];
    
    const extractColors = (node: any, path: string = "") => {
      if (node.fills && Array.isArray(node.fills)) {
        node.fills.forEach((fill: any, index: number) => {
          if (fill.type === "SOLID" && fill.color) {
            const { r, g, b, a = 1 } = fill.color;
            tokens.push({
              name: `${path}${node.name}-fill-${index}`,
              type: "color",
              value: {
                r: Math.round(r * 255),
                g: Math.round(g * 255),
                b: Math.round(b * 255),
                a,
                hex: `#${Math.round(r * 255).toString(16).padStart(2, "0")}${Math.round(g * 255).toString(16).padStart(2, "0")}${Math.round(b * 255).toString(16).padStart(2, "0")}`,
              },
            });
          }
        });
      }

      if (node.style) {
        const style = node.style;
        if (style.fontFamily) {
          tokens.push({
            name: `${path}${node.name}-typography`,
            type: "typography",
            value: {
              fontFamily: style.fontFamily,
              fontSize: style.fontSize,
              fontWeight: style.fontWeight,
              lineHeight: style.lineHeightPx,
              letterSpacing: style.letterSpacing,
            },
          });
        }
      }

      if (node.children) {
        node.children.forEach((child: any) => {
          extractColors(child, `${path}${node.name}/`);
        });
      }
    };

    if (fileData.document) {
      extractColors(fileData.document);
    }

    return tokens;
  }

  generateReactCode(node: any, depth: number = 0): string {
    const indent = "  ".repeat(depth);
    const nodeType = node.type;
    const name = node.name?.replace(/[^a-zA-Z0-9]/g, "") || "Component";

    let code = "";
    let styles: string[] = [];

    if (node.absoluteBoundingBox) {
      const { width, height } = node.absoluteBoundingBox;
      styles.push(`width: ${Math.round(width)}px`);
      styles.push(`height: ${Math.round(height)}px`);
    }

    if (node.fills && node.fills[0]?.type === "SOLID") {
      const { r, g, b, a = 1 } = node.fills[0].color;
      const hex = `#${Math.round(r * 255).toString(16).padStart(2, "0")}${Math.round(g * 255).toString(16).padStart(2, "0")}${Math.round(b * 255).toString(16).padStart(2, "0")}`;
      styles.push(`backgroundColor: '${hex}'`);
    }

    if (node.cornerRadius) {
      styles.push(`borderRadius: ${node.cornerRadius}px`);
    }

    const styleString = styles.length > 0 ? ` style={{ ${styles.join(", ")} }}` : "";

    switch (nodeType) {
      case "TEXT":
        code = `${indent}<p${styleString}>${node.characters || ""}</p>`;
        break;
      case "FRAME":
      case "GROUP":
      case "COMPONENT":
      case "INSTANCE":
        const children = node.children?.map((child: any) => this.generateReactCode(child, depth + 1)).join("\n") || "";
        code = `${indent}<div${styleString}>\n${children}\n${indent}</div>`;
        break;
      case "RECTANGLE":
        code = `${indent}<div${styleString} />`;
        break;
      case "ELLIPSE":
        styles.push("borderRadius: '50%'");
        code = `${indent}<div style={{ ${styles.join(", ")} }} />`;
        break;
      case "VECTOR":
      case "LINE":
        code = `${indent}{/* Vector: ${node.name} */}`;
        break;
      default:
        if (node.children) {
          const children = node.children.map((child: any) => this.generateReactCode(child, depth + 1)).join("\n");
          code = `${indent}<div${styleString}>\n${children}\n${indent}</div>`;
        } else {
          code = `${indent}<div${styleString} />`;
        }
    }

    return code;
  }

  async getDesignContext(fileKey: string, nodeId?: string): Promise<FigmaCodeContext> {
    const fileData = await this.getFile(fileKey);
    const tokens = this.extractDesignTokens(fileData);

    let targetNode = fileData.document;
    if (nodeId) {
      const nodesData = await this.getFileNodes(fileKey, [nodeId]);
      if (nodesData.nodes && nodesData.nodes[nodeId]) {
        targetNode = nodesData.nodes[nodeId].document;
      }
    }

    const reactCode = `
import React from 'react';

export function ${targetNode.name?.replace(/[^a-zA-Z0-9]/g, "") || "FigmaComponent"}() {
  return (
${this.generateReactCode(targetNode, 2)}
  );
}
`.trim();

    const cssVars = tokens
      .filter(t => t.type === "color")
      .map(t => `  --${t.name.replace(/[^a-zA-Z0-9-]/g, "-")}: ${t.value.hex};`)
      .join("\n");

    const css = `:root {\n${cssVars}\n}`;

    return {
      html: this.generateReactCode(targetNode).replace(/className/g, "class"),
      css,
      react: reactCode,
      tokens,
    };
  }

  parseFileUrl(url: string): { fileKey: string; nodeId?: string } | null {
    const fileMatch = url.match(/figma\.com\/(?:file|design)\/([a-zA-Z0-9]+)/);
    if (!fileMatch) return null;

    const fileKey = fileMatch[1];
    const nodeMatch = url.match(/node-id=([^&]+)/);
    const nodeId = nodeMatch ? decodeURIComponent(nodeMatch[1]) : undefined;

    return { fileKey, nodeId };
  }
}

export const figmaService = new FigmaService();
