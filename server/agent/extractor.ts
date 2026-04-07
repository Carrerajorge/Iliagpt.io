import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import * as cheerio from "cheerio";

export interface ExtractedContent {
  title: string;
  byline: string | null;
  content: string;
  textContent: string;
  excerpt: string | null;
  siteName: string | null;
  length: number;
  links: ExtractedLink[];
  images: ExtractedImage[];
  metadata: Record<string, string>;
}

export interface ExtractedLink {
  text: string;
  href: string;
  isInternal: boolean;
}

export interface ExtractedImage {
  src: string;
  alt: string;
  width?: number;
  height?: number;
}

export function extractWithReadability(html: string, url: string): ExtractedContent | null {
  try {
    const dom = new JSDOM(html, { url });
    const document = dom.window.document;
    
    const reader = new Readability(document.cloneNode(true) as Document);
    const article = reader.parse();
    
    if (!article) return null;

    const baseUrl = new URL(url);
    const links = extractLinks(document, baseUrl);
    const images = extractImages(document, baseUrl);
    const metadata = extractMetadata(document);

    return {
      title: article.title || "",
      byline: article.byline || null,
      content: article.content || "",
      textContent: article.textContent || "",
      excerpt: article.excerpt || null,
      siteName: article.siteName || null,
      length: article.length || 0,
      links,
      images,
      metadata
    };
  } catch (error) {
    console.error("Readability extraction error:", error);
    return null;
  }
}

export function extractRawText(html: string): string {
  try {
    const dom = new JSDOM(html);
    const document = dom.window.document;
    
    const scripts = document.querySelectorAll("script, style, noscript");
    scripts.forEach(el => el.remove());
    
    return document.body?.textContent?.trim() || "";
  } catch {
    return "";
  }
}

function extractLinks(document: Document, baseUrl: URL): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  const anchors = document.querySelectorAll("a[href]");
  
  anchors.forEach((anchor: Element) => {
    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
    
    try {
      const absoluteUrl = new URL(href, baseUrl.origin);
      links.push({
        text: anchor.textContent?.trim() || "",
        href: absoluteUrl.href,
        isInternal: absoluteUrl.hostname === baseUrl.hostname
      });
    } catch (e) {
      // Invalid URL format - skip this link silently as it's expected for malformed hrefs
    }
  });

  return links.slice(0, 100);
}

function extractImages(document: Document, baseUrl: URL): ExtractedImage[] {
  const images: ExtractedImage[] = [];
  const imgElements = document.querySelectorAll("img[src]");
  
  imgElements.forEach((img: Element) => {
    const src = img.getAttribute("src");
    if (!src) return;
    
    try {
      const absoluteUrl = new URL(src, baseUrl.origin);
      images.push({
        src: absoluteUrl.href,
        alt: img.getAttribute("alt") || "",
        width: parseInt(img.getAttribute("width") || "0") || undefined,
        height: parseInt(img.getAttribute("height") || "0") || undefined
      });
    } catch (e) {
      // Invalid URL format - skip this image silently as it's expected for malformed srcs
    }
  });

  return images.slice(0, 50);
}

function extractMetadata(document: Document): Record<string, string> {
  const metadata: Record<string, string> = {};
  
  const metaTags = document.querySelectorAll("meta[name], meta[property]");
  metaTags.forEach((meta: Element) => {
    const name = meta.getAttribute("name") || meta.getAttribute("property");
    const content = meta.getAttribute("content");
    if (name && content) {
      metadata[name] = content;
    }
  });

  const title = document.querySelector("title");
  if (title?.textContent) {
    metadata["title"] = title.textContent;
  }

  const canonical = document.querySelector("link[rel='canonical']");
  if (canonical) {
    metadata["canonical"] = canonical.getAttribute("href") || "";
  }

  return metadata;
}

/**
 * Fast HTML content extraction using cheerio (~8x faster than JSDOM).
 * Use for bulk processing, scraping pipelines, or when Readability's
 * article detection isn't needed.
 */
export function extractWithCheerio(html: string, url: string): ExtractedContent | null {
  try {
    const $ = cheerio.load(html);
    const baseUrl = new URL(url);

    // Remove non-content elements
    $("script, style, noscript, nav, footer, header, aside, .ad, .sidebar, [role='banner'], [role='navigation']").remove();

    const title = $("title").text().trim()
      || $('meta[property="og:title"]').attr("content")?.trim()
      || $("h1").first().text().trim()
      || "";

    const excerpt = $('meta[name="description"]').attr("content")?.trim()
      || $('meta[property="og:description"]').attr("content")?.trim()
      || null;

    const siteName = $('meta[property="og:site_name"]').attr("content")?.trim() || null;
    const byline = $('meta[name="author"]').attr("content")?.trim()
      || $('[rel="author"]').first().text().trim()
      || null;

    // Extract main content: prefer article/main elements, fall back to body
    const mainEl = $("article, main, [role='main'], .content, .post-content, #content").first();
    const contentHtml = mainEl.length ? mainEl.html() || "" : $("body").html() || "";
    const textContent = mainEl.length ? mainEl.text().trim() : $("body").text().trim();

    // Extract links
    const links: ExtractedLink[] = [];
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
      try {
        const absoluteUrl = new URL(href, baseUrl.origin);
        links.push({
          text: $(el).text().trim(),
          href: absoluteUrl.href,
          isInternal: absoluteUrl.hostname === baseUrl.hostname,
        });
      } catch {
        // skip malformed URLs
      }
    });

    // Extract images
    const images: ExtractedImage[] = [];
    $("img[src]").each((_, el) => {
      const src = $(el).attr("src");
      if (!src) return;
      try {
        const absoluteUrl = new URL(src, baseUrl.origin);
        images.push({
          src: absoluteUrl.href,
          alt: $(el).attr("alt") || "",
          width: parseInt($(el).attr("width") || "0") || undefined,
          height: parseInt($(el).attr("height") || "0") || undefined,
        });
      } catch {
        // skip malformed URLs
      }
    });

    // Extract metadata
    const metadata: Record<string, string> = {};
    $("meta[name], meta[property]").each((_, el) => {
      const name = $(el).attr("name") || $(el).attr("property");
      const content = $(el).attr("content");
      if (name && content) metadata[name] = content;
    });
    if (title) metadata["title"] = title;
    const canonical = $("link[rel='canonical']").attr("href");
    if (canonical) metadata["canonical"] = canonical;

    return {
      title,
      byline,
      content: contentHtml,
      textContent,
      excerpt,
      siteName,
      length: textContent.length,
      links: links.slice(0, 100),
      images: images.slice(0, 50),
      metadata,
    };
  } catch {
    return null;
  }
}

/**
 * Extracts text from HTML using cheerio (fast, no DOM emulation).
 * Drop-in replacement for extractRawText when JSDOM overhead isn't acceptable.
 */
export function extractRawTextFast(html: string): string {
  try {
    const $ = cheerio.load(html);
    $("script, style, noscript").remove();
    return $("body").text().trim();
  } catch {
    return "";
  }
}

export function summarizeForLLM(extracted: ExtractedContent, maxLength: number = 8000): string {
  let summary = `# ${extracted.title}\n\n`;
  
  if (extracted.byline) {
    summary += `*By: ${extracted.byline}*\n\n`;
  }
  
  if (extracted.excerpt) {
    summary += `> ${extracted.excerpt}\n\n`;
  }

  summary += "## Content\n\n";
  
  let content = extracted.textContent;
  if (content.length > maxLength - summary.length) {
    content = content.slice(0, maxLength - summary.length - 100) + "\n\n[Content truncated...]";
  }
  
  summary += content;

  return summary;
}
