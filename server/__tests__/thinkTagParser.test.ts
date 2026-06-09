import { describe, it, expect } from "vitest";
import { ThinkTagStreamParser } from "../llm/thinkTagParser";

function feedAll(parser: ThinkTagStreamParser, chunks: string[]) {
  let reasoning = "";
  let content = "";
  for (const c of chunks) {
    const out = parser.push(c);
    reasoning += out.reasoning;
    content += out.content;
  }
  const tail = parser.flush();
  reasoning += tail.reasoning;
  content += tail.content;
  return { reasoning, content };
}

describe("ThinkTagStreamParser", () => {
  it("splits a single-chunk think block from the answer", () => {
    const out = feedAll(new ThinkTagStreamParser(), [
      "<think>17 por 23: 17*20=340, 17*3=51, 391.</think>La respuesta es 391.",
    ]);
    expect(out.reasoning).toBe("17 por 23: 17*20=340, 17*3=51, 391.");
    expect(out.content).toBe("La respuesta es 391.");
  });

  it("handles tags split across chunk boundaries", () => {
    const out = feedAll(new ThinkTagStreamParser(), [
      "<thi", "nk>pensando ", "en voz alta</th", "ink>Respuesta",
    ]);
    expect(out.reasoning).toBe("pensando en voz alta");
    expect(out.content).toBe("Respuesta");
  });

  it("passes plain content through untouched (no tags)", () => {
    const parser = new ThinkTagStreamParser();
    const out = feedAll(parser, ["Hola, ", "¿cómo estás?"]);
    expect(out.reasoning).toBe("");
    expect(out.content).toBe("Hola, ¿cómo estás?");
    expect(parser.usedThinkTags).toBe(false);
  });

  it("does not eat angle brackets that are not think tags", () => {
    const out = feedAll(new ThinkTagStreamParser(), ["a < b y <thing> c"]);
    expect(out.content).toBe("a < b y <thing> c");
    expect(out.reasoning).toBe("");
  });

  it("treats an unterminated think block as reasoning to the end", () => {
    const out = feedAll(new ThinkTagStreamParser(), ["<think>nunca cierro"]);
    expect(out.reasoning).toBe("nunca cierro");
    expect(out.content).toBe("");
  });

  it("handles multiple think blocks interleaved with text", () => {
    const out = feedAll(new ThinkTagStreamParser(), [
      "<think>uno</think>A<think>dos</think>B",
    ]);
    expect(out.reasoning).toBe("unodos");
    expect(out.content).toBe("AB");
  });

  it("releases a dangling '<thi' that turns out to be ordinary text", () => {
    const parser = new ThinkTagStreamParser();
    const first = parser.push("texto <thi");
    const second = parser.push("ngs raros");
    const tail = parser.flush();
    expect(first.content + second.content + tail.content).toBe("texto <things raros");
    expect(first.reasoning + second.reasoning + tail.reasoning).toBe("");
  });
});
