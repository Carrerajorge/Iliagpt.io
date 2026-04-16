import { describe, it, expect } from "vitest";
import {
  sanitizeMathInput,
  detectMathType,
  convertToLatex,
  parseMathContent,
  preprocessMathInMarkdown,
} from "./mathParser";

describe("sanitizeMathInput", () => {
  it("returns empty/falsy input unchanged", () => {
    expect(sanitizeMathInput("")).toBe("");
    expect(sanitizeMathInput(null as any)).toBe(null);
  });

  it("strips unsafe LaTeX commands", () => {
    expect(sanitizeMathInput("\\input{secret}")).not.toContain("\\input");
    expect(sanitizeMathInput("\\include{file}")).not.toContain("\\include");
    expect(sanitizeMathInput("\\write18{rm -rf /}")).not.toContain("\\write");
    expect(sanitizeMathInput("\\openin1")).not.toContain("\\openin");
    expect(sanitizeMathInput("\\catcode`\\@=11")).not.toContain("\\catcode");
    expect(sanitizeMathInput("\\def\\cmd{bad}")).not.toContain("\\def\\");
    expect(sanitizeMathInput("\\newcommand{\\x}")).not.toContain("\\newcommand");
  });

  it("strips HTML tags", () => {
    expect(sanitizeMathInput("x<script>alert(1)</script>+y")).not.toContain("<script>");
  });

  it("strips javascript: and data: URLs", () => {
    expect(sanitizeMathInput("javascript:alert(1)")).not.toContain("javascript:");
    expect(sanitizeMathInput("data:text/html")).not.toContain("data:");
  });

  it("preserves safe math", () => {
    expect(sanitizeMathInput("x^2 + y^2 = z^2")).toBe("x^2 + y^2 = z^2");
    expect(sanitizeMathInput("\\frac{a}{b}")).toBe("\\frac{a}{b}");
    expect(sanitizeMathInput("\\sqrt{x}")).toBe("\\sqrt{x}");
  });
});

describe("detectMathType", () => {
  it("detects LaTeX block ($$...$$)", () => {
    const result = detectMathType("$$x^2 + y^2$$");
    expect(result.type).toBe("latex-block");
    expect(result.content).toBe("x^2 + y^2");
  });

  it("detects LaTeX block (\\[...\\])", () => {
    const result = detectMathType("\\[x^2\\]");
    expect(result.type).toBe("latex-block");
    expect(result.content).toBe("x^2");
  });

  it("detects LaTeX inline ($...$)", () => {
    const result = detectMathType("$x+y$");
    expect(result.type).toBe("latex-inline");
    expect(result.content).toBe("x+y");
  });

  it("detects LaTeX inline (\\(...\\))", () => {
    const result = detectMathType("\\(x+y\\)");
    expect(result.type).toBe("latex-inline");
    expect(result.content).toBe("x+y");
  });

  it("detects AsciiMath with backticks", () => {
    const result = detectMathType("`sum_(i=1)^n i`");
    expect(result.type).toBe("asciimath");
    expect(result.content).toBe("sum_(i=1)^n i");
  });

  it("detects AsciiMath with am` prefix", () => {
    const result = detectMathType("am`x^2`");
    expect(result.type).toBe("asciimath");
    expect(result.content).toBe("x^2");
  });

  it("returns plain for regular text", () => {
    const result = detectMathType("just text");
    expect(result.type).toBe("plain");
  });

  it("returns plain for empty input", () => {
    const result = detectMathType("");
    expect(result.type).toBe("plain");
  });
});

describe("convertToLatex", () => {
  it("converts LaTeX block", () => {
    const result = convertToLatex("$$x^2$$");
    expect(result.isBlock).toBe(true);
    expect(result.latex).toBe("x^2");
  });

  it("converts LaTeX inline", () => {
    const result = convertToLatex("$x+y$");
    expect(result.isBlock).toBe(false);
    expect(result.latex).toBe("x+y");
  });

  it("converts plain text", () => {
    const result = convertToLatex("hello");
    expect(result.isBlock).toBe(false);
  });
});

describe("parseMathContent", () => {
  it("returns empty segments for empty input", () => {
    expect(parseMathContent("").segments).toEqual([]);
    expect(parseMathContent(null as any).segments).toEqual([]);
  });

  it("parses text without math", () => {
    const result = parseMathContent("just text");
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].type).toBe("text");
    expect(result.segments[0].content).toBe("just text");
  });

  it("parses inline math in text", () => {
    const result = parseMathContent("The formula $x^2$ is simple");
    expect(result.segments.length).toBeGreaterThanOrEqual(3);
    const mathSeg = result.segments.find(s => s.type === "math");
    expect(mathSeg).toBeDefined();
    expect(mathSeg!.content).toContain("x^2");
  });

  it("parses block math", () => {
    const result = parseMathContent("Before $$\\frac{a}{b}$$ after");
    const mathSeg = result.segments.find(s => s.type === "math");
    expect(mathSeg).toBeDefined();
    expect(mathSeg!.mathType).toBe("block");
  });

  it("handles multiple math expressions", () => {
    const result = parseMathContent("$a$ plus $b$ equals $c$");
    const mathSegs = result.segments.filter(s => s.type === "math");
    expect(mathSegs.length).toBe(3);
  });
});

describe("preprocessMathInMarkdown", () => {
  it("converts \\[...\\] to $...$", () => {
    const result = preprocessMathInMarkdown("before \\[x^2\\] after");
    expect(result).toContain("$x^2$");
    expect(result).not.toContain("\\[");
    expect(result).not.toContain("\\]");
  });

  it("converts \\(...\\) to $...$", () => {
    const result = preprocessMathInMarkdown("before \\(x+y\\) after");
    expect(result).toContain("$x+y$");
    expect(result).not.toContain("\\(");
  });

  it("returns empty/falsy input unchanged", () => {
    expect(preprocessMathInMarkdown("")).toBe("");
    expect(preprocessMathInMarkdown(null as any)).toBe(null);
  });

  it("preserves fenced and inline code while converting LaTeX delimiters", () => {
    const input = [
      "inline \\(x+y\\)",
      "",
      "`literal \\(keep\\)`",
      "",
      "```ts",
      "const formula = \"\\\\(keep me\\\\)\";",
      "```",
      "",
      "\\[z^2\\]",
    ].join("\n");

    const result = preprocessMathInMarkdown(input);

    expect(result).toContain("inline $x+y$");
    expect(result).toContain("`literal \\(keep\\)`");
    expect(result).toContain("const formula = \"\\\\(keep me\\\\)\";");
    expect(result).toContain("$$z^2$$");
  });
});
