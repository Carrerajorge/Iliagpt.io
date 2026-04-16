import { describe, it, expect } from "vitest";

/**
 * Artifact Detection Tests
 *
 * Tests the pure detection logic used to identify artifact types
 * (HTML, diagrams, tables, large code blocks) within assistant messages.
 * This logic is extracted from the client-side artifact rendering pipeline
 * into a testable pure function.
 */

function detectArtifactType(content: string): { type: string; detected: boolean } {
  // HTML detection
  if (
    content.includes("<!DOCTYPE") ||
    content.includes("<html") ||
    /```html\s*\n[\s\S]*<html/i.test(content)
  ) {
    if (/```html?\s*\n([\s\S]*?)```/.test(content)) {
      return { type: "html", detected: true };
    }
  }

  // Mermaid detection
  if (/```mermaid\s*\n([\s\S]*?)```/.test(content)) {
    return { type: "diagram", detected: true };
  }

  // Table detection (3+ pipe-delimited lines)
  const tableLines = content.split("\n").filter((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith("|") && trimmed.endsWith("|");
  });
  if (tableLines.length >= 3) {
    return { type: "table", detected: true };
  }

  // Large code block detection (>15 lines)
  const codeBlockPattern = /```(\w*)\s*\n([\s\S]*?)```/g;
  let match;
  while ((match = codeBlockPattern.exec(content)) !== null) {
    const code = match[2];
    if (code.split("\n").length > 15) {
      return { type: "code", detected: true };
    }
  }

  return { type: "none", detected: false };
}

describe("Artifact Detection", () => {
  it("detects HTML with DOCTYPE as type html", () => {
    const content = "```html\n<!DOCTYPE html>\n<html><body><h1>Hello</h1></body></html>\n```";
    const result = detectArtifactType(content);
    expect(result.type).toBe("html");
    expect(result.detected).toBe(true);
  });

  it("detects HTML in code fence as type html", () => {
    const content = "```html\n<html>\n<head><title>Test</title></head>\n<body>\n<p>Content</p>\n</body>\n</html>\n```";
    const result = detectArtifactType(content);
    expect(result.type).toBe("html");
    expect(result.detected).toBe(true);
  });

  it("detects Mermaid graph as type diagram", () => {
    const content = "```mermaid\ngraph TD\n  A[Start] --> B[Process]\n  B --> C[End]\n```";
    const result = detectArtifactType(content);
    expect(result.type).toBe("diagram");
    expect(result.detected).toBe(true);
  });

  it("detects Mermaid sequence diagram as type diagram", () => {
    const content =
      "```mermaid\nsequenceDiagram\n  participant A as Alice\n  participant B as Bob\n  A->>B: Hello Bob\n  B-->>A: Hello Alice\n```";
    const result = detectArtifactType(content);
    expect(result.type).toBe("diagram");
    expect(result.detected).toBe(true);
  });

  it("detects Markdown table with 3+ rows as type table", () => {
    const content = [
      "| Name   | Age | City     |",
      "|--------|-----|----------|",
      "| Alice  | 30  | New York |",
      "| Bob    | 25  | London   |",
      "| Carlos | 35  | Madrid   |",
    ].join("\n");
    const result = detectArtifactType(content);
    expect(result.type).toBe("table");
    expect(result.detected).toBe(true);
  });

  it("detects code block with 20 lines as type code", () => {
    const codeLines = Array.from({ length: 20 }, (_, i) => `  const x${i} = ${i};`).join("\n");
    const content = "```typescript\n" + codeLines + "\n```";
    const result = detectArtifactType(content);
    expect(result.type).toBe("code");
    expect(result.detected).toBe(true);
  });

  it("does NOT detect code block with only 5 lines", () => {
    const codeLines = Array.from({ length: 5 }, (_, i) => `  const x${i} = ${i};`).join("\n");
    const content = "```javascript\n" + codeLines + "\n```";
    const result = detectArtifactType(content);
    expect(result.detected).toBe(false);
    expect(result.type).toBe("none");
  });

  it("does NOT detect plain text as artifact", () => {
    const content = "This is just a regular message with no special formatting or code blocks.";
    const result = detectArtifactType(content);
    expect(result.detected).toBe(false);
    expect(result.type).toBe("none");
  });

  it("does NOT detect table with only 2 pipe-delimited lines", () => {
    const content = ["| Header1 | Header2 |", "|---------|---------|"].join("\n");
    const result = detectArtifactType(content);
    expect(result.detected).toBe(false);
    expect(result.type).toBe("none");
  });

  it("detects first matching type in mixed content (HTML before mermaid)", () => {
    const content = [
      "Here is some HTML:",
      "```html",
      "<html><body><p>Hello</p></body></html>",
      "```",
      "",
      "And a diagram:",
      "```mermaid",
      "graph TD",
      "  A --> B",
      "```",
    ].join("\n");
    const result = detectArtifactType(content);
    // HTML check comes first in the detection order
    expect(result.type).toBe("html");
    expect(result.detected).toBe(true);
  });
});
