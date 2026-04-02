export type SelfExpandCatalogCandidate = {
  provider: "github" | "gitlab" | "npm" | "pypi" | "local";
  name: string;
  url?: string;
  reason?: string;
  tags?: string[];
};

export type SelfExpandCatalogEntry = {
  capability: string;
  tags?: string[];
  candidates: SelfExpandCatalogCandidate[];
};

export const SELF_EXPAND_CATALOG: SelfExpandCatalogEntry[] = [
  {
    capability: "scraping",
    tags: ["browser", "crawl", "automation", "web"],
    candidates: [
      {
        provider: "github",
        name: "cheeriojs/cheerio",
        url: "https://github.com/cheeriojs/cheerio.git",
        reason: "Fast HTML parsing and scraping.",
        tags: ["node", "html", "parse"],
      },
      {
        provider: "github",
        name: "puppeteer/puppeteer",
        url: "https://github.com/puppeteer/puppeteer.git",
        reason: "Headless browser automation and scraping.",
        tags: ["node", "browser"],
      },
    ],
  },
  {
    capability: "escape_string_regexp",
    tags: ["string", "regexp", "sanitize"],
    candidates: [
      {
        provider: "github",
        name: "sindresorhus/escape-string-regexp",
        url: "https://github.com/sindresorhus/escape-string-regexp.git",
        reason: "Small, dependency-free string regexp escaping.",
        tags: ["node", "string"],
      },
    ],
  },
  {
    capability: "vision",
    tags: ["image", "cv", "computer-vision"],
    candidates: [
      {
        provider: "github",
        name: "lovell/sharp",
        url: "https://github.com/lovell/sharp.git",
        reason: "High-performance image processing.",
        tags: ["node", "image"],
      },
      {
        provider: "github",
        name: "opencv/opencv",
        url: "https://github.com/opencv/opencv.git",
        reason: "Computer vision core library.",
        tags: ["cpp", "cv"],
      },
    ],
  },
  {
    capability: "ml",
    tags: ["machine-learning", "ai", "model"],
    candidates: [
      {
        provider: "github",
        name: "tensorflow/tfjs",
        url: "https://github.com/tensorflow/tfjs.git",
        reason: "Machine learning in JavaScript.",
        tags: ["node", "ml"],
      },
      {
        provider: "github",
        name: "onnx/onnxruntime",
        url: "https://github.com/microsoft/onnxruntime.git",
        reason: "High-performance inference runtime.",
        tags: ["cpp", "ml"],
      },
    ],
  },
];
