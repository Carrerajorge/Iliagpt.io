import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import sanitizeHtmlLib from "sanitize-html";

// Initialize JSDOM window for DOMPurify to work in Node.js
const window = new JSDOM("").window;
const DOMPurify = createDOMPurify(window as any);

const MAX_MARKDOWN_LENGTH = 20000;

// Allowed tags for Markdown (GitHub Flavored + CommonMark)
const ALLOWED_TAGS = [
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "br", "hr",
  "ul", "ol", "li",
  "blockquote",
  "pre", "code",
  "strong", "em", "b", "i", "u", "s", "del", "mark",
  "a", "img",
  "table", "thead", "tbody", "tr", "th", "td",
  "details", "summary",
  "div", "span"
];

// Allowed attributes
const ALLOWED_ATTR = [
  "href", "src", "alt", "title",
  "class", "id",
  "width", "height",
  "align", "target", "rel",
  "start"
];

const HREF_ALLOWLIST = /^(?:https?:\/\/|mailto:|tel:|\/)/i;
const IMG_SRC_ALLOWLIST = /^(?:https?:\/\/|data:image\/(?:png|jpeg|jpg|gif|webp|avif);base64,|\/)/i;

const SANITIZE_OPTIONS = {
  ALLOWED_TAGS,
  ALLOWED_ATTR,
  FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "button"],
  FORBID_ATTR: ["style", "on*"],
  ALLOW_DATA_ATTR: false,
  ADD_TAGS: [],
  ADD_ATTR: [],
  ALLOWED_URI_REGEXP: HREF_ALLOWLIST,
};

function sanitizeMarkdownUrl(url: string, isImage?: boolean): string {
  if (!url) return "";
  if (isImage) {
    return IMG_SRC_ALLOWLIST.test(url) ? url : "";
  }
  return HREF_ALLOWLIST.test(url) ? url : "";
}

function rewriteSafeLinks(html: string): string {
  if (!html) return html;

  return html.replace(/(href|src)="([^"]+)"/g, (_match, attr: string, value: string) => {
    const isImage = attr.toLowerCase() === "src";
    const safeUrl = sanitizeMarkdownUrl(value, isImage);
    return `${attr}="${safeUrl}"`;
  });
}

/**
 * Sanitizes a Markdown string (or HTML generated from Markdown) to prevent XSS.
 * This should be used BEFORE storing user content in the database if possible,
 * or at least before rendering it on the server if server-side rendering is used.
 */
export function sanitizeMarkdown(content: string): string {
  if (!content || typeof content !== "string") return "";
  const trimmed = content.trim();
  if (!trimmed) return "";
  if (trimmed.length > MAX_MARKDOWN_LENGTH) return "";

  const sanitized = DOMPurify.sanitize(trimmed, SANITIZE_OPTIONS) as string;
  return rewriteSafeLinks(sanitized);
}

/**
 * Sanitizes specific fields of an object that are known to contain markdown/html.
 */
export function sanitizeMessageContent(content: string): string {
  return sanitizeMarkdown(content);
}

/**
 * Lightweight server-side HTML sanitizer using sanitize-html.
 * Use this when JSDOM/DOMPurify is too heavy (e.g., processing scraped web pages,
 * cleaning API responses, or sanitizing bulk content in background jobs).
 *
 * Unlike DOMPurify, this does NOT require a DOM environment — pure string processing.
 */
export function sanitizeHtml(html: string, opts?: { allowImages?: boolean }): string {
  if (!html || typeof html !== "string") return "";
  const trimmed = html.trim();
  if (!trimmed) return "";
  if (trimmed.length > MAX_MARKDOWN_LENGTH) return "";

  return sanitizeHtmlLib(trimmed, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: opts?.allowImages ? ["src", "alt", "title", "width", "height"] : [],
      code: ["class"],
      pre: ["class"],
      span: ["class"],
      div: ["class", "id"],
      td: ["align"],
      th: ["align"],
      ol: ["start"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: {
      img: ["http", "https", "data"],
    },
    disallowedTagsMode: "discard",
    transformTags: {
      a: sanitizeHtmlLib.simpleTransform("a", { rel: "noopener noreferrer", target: "_blank" }),
    },
  });
}

/**
 * Strips ALL HTML tags, returning plain text only.
 * Uses sanitize-html with no allowed tags for safe, fast stripping.
 */
export function stripHtmlToText(html: string): string {
  if (!html || typeof html !== "string") return "";
  return sanitizeHtmlLib(html, {
    allowedTags: [],
    allowedAttributes: {},
  }).trim();
}
