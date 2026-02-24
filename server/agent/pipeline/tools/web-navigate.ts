import { ToolDefinition, ExecutionContext, ToolResult, Artifact } from "../types";
import { browserSessionManager } from "../../browser";
import { extractWithReadability } from "../../extractor";
import { ObjectStorageService } from "../../../objectStorage";
import { getUserPrivacySettings } from "../../../services/privacyService";
import crypto from "crypto";

const objectStorage = new ObjectStorageService();

function extractHtmlTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1]?.trim() || null;
}

export const webNavigateTool: ToolDefinition = {
  id: "web_navigate",
  name: "Navigate Web Page",
  description: "Navigate to a URL and capture the page content, optionally taking a screenshot",
  category: "web",
  capabilities: ["navigate", "browse", "fetch", "url", "website", "webpage"],
  inputSchema: {
    url: { type: "string", description: "The URL to navigate to", required: true },
    takeScreenshot: { type: "boolean", description: "Whether to capture a screenshot", default: true },
    waitForSelector: { type: "string", description: "CSS selector to wait for before capturing" },
    timeout: { type: "number", description: "Navigation timeout in ms", default: 30000 }
  },
  outputSchema: {
    html: { type: "string", description: "The page HTML content" },
    title: { type: "string", description: "The page title" },
    url: { type: "string", description: "The final URL after any redirects" },
    screenshot: { type: "string", description: "Path to the screenshot if taken" }
  },
  timeout: 60000,
  
  async execute(context: ExecutionContext, params: Record<string, any>): Promise<ToolResult> {
    const { url, takeScreenshot = true, waitForSelector, timeout = 30000 } = params;
    
    console.log("WEB_NAVIGATE: Starting with URL:", url);
    
    const startTime = Date.now();
    let sessionId: string | null = null;
    const artifacts: Artifact[] = [];

    // Enforce privacy: if remote browser data access is disabled, use stateless fetch (no cookies/DOM/screenshots).
    let remoteBrowserAllowed = false;
    try {
      if (context.userId) {
        const privacy = await getUserPrivacySettings(context.userId);
        remoteBrowserAllowed = !!privacy.remoteBrowserDataAccess;
      }
    } catch (e) {
      remoteBrowserAllowed = false;
    }

    if (!remoteBrowserAllowed) {
      try {
        context.onProgress({
          runId: context.runId,
          stepId: `nav_${context.stepIndex}`,
          status: "progress",
          message: `Fetching ${url} (sin navegador remoto)...`,
          progress: 30,
          detail: { url, mode: "stateless_fetch" }
        });

        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), timeout);
        const response = await fetch(url, {
          signal: controller.signal,
          redirect: "follow",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9"
          }
        });
        clearTimeout(t);

        if (!response.ok) {
          return {
            success: false,
            error: `HTTP ${response.status}: ${response.statusText}`
          };
        }

        const html = await response.text();
        const finalUrl = response.url || url;
        const extracted = extractWithReadability(html, finalUrl);

        const finalTitle =
          extracted?.title ||
          extractHtmlTitle(html) ||
          new URL(finalUrl).hostname;

        const textContent = (extracted?.textContent || "").slice(0, 50000);
        const links = extracted?.links?.slice(0, 50);

        if (textContent) {
          artifacts.push({
            id: crypto.randomUUID(),
            type: "text",
            name: `content_${new URL(finalUrl).hostname}.txt`,
            content: textContent,
            metadata: { title: finalTitle, mode: "stateless_fetch" }
          });
        }

        const domain = new URL(finalUrl).hostname;
        const webSources = [{
          url: finalUrl,
          title: finalTitle,
          domain,
          favicon: `https://www.google.com/s2/favicons?domain=${domain}&sz=32`,
          snippet: textContent.slice(0, 200)
        }];

        return {
          success: true,
          data: {
            url: finalUrl,
            title: finalTitle,
            textContent,
            links,
            duration: Date.now() - startTime,
            webSources
          },
          artifacts,
          metadata: {
            finalUrl,
            title: finalTitle,
            duration: Date.now() - startTime,
            fetchMethod: "stateless_fetch",
            screenshotSkipped: takeScreenshot || undefined,
            waitForSelectorSkipped: waitForSelector || undefined
          }
        };
      } catch (error: any) {
        return { success: false, error: error?.message || String(error) };
      }
    }
    
    try {
      console.log("WEB_NAVIGATE: Creating browser session...");
      sessionId = await browserSessionManager.createSession(
        `Navigate to ${url}`,
        { timeout },
        undefined
      );
      console.log("WEB_NAVIGATE: Session created:", sessionId);
      
      if (takeScreenshot) {
        browserSessionManager.startScreenshotStreaming(sessionId, 1500);
        console.log("WEB_NAVIGATE: Screenshot streaming started");
      }
      
      context.onProgress({
        runId: context.runId,
        stepId: `nav_${context.stepIndex}`,
        status: "progress",
        message: `Navigating to ${url}...`,
        progress: 30,
        detail: { browserSessionId: sessionId, url }
      });
      
      const result = await browserSessionManager.navigate(sessionId, url);
      
      if (!result.success) {
        return {
          success: false,
          error: result.error || "Navigation failed"
        };
      }

      if (waitForSelector) {
        const waitScript = `
          new Promise((resolve, reject) => {
            const selector = ${JSON.stringify(waitForSelector)};
            const timeout = ${Math.min(timeout, 10000)};
            const start = Date.now();
            const check = () => {
              if (document.querySelector(selector)) {
                resolve(true);
              } else if (Date.now() - start > timeout) {
                resolve(false);
              } else {
                requestAnimationFrame(check);
              }
            };
            check();
          })
        `;
        await browserSessionManager.evaluate(sessionId, waitScript);
      }

      if (takeScreenshot && result.screenshot) {
        try {
          const screenshotBuffer = Buffer.from(result.screenshot.replace(/^data:image\/png;base64,/, ""), "base64");
          const { uploadURL, storagePath } = await objectStorage.getObjectEntityUploadURLWithPath();
          await fetch(uploadURL, {
            method: "PUT",
            headers: { "Content-Type": "image/png" },
            body: screenshotBuffer
          });
          
          artifacts.push({
            id: crypto.randomUUID(),
            type: "screenshot",
            name: `screenshot_${new URL(url).hostname}.png`,
            storagePath,
            mimeType: "image/png",
            metadata: { url, title: result.data?.title }
          });
        } catch (e) {
          console.error("Failed to save screenshot:", e);
        }
      }

      const pageState = await browserSessionManager.getPageState(sessionId);
      
      let extractedContent: any = null;
      if (pageState?.visibleText) {
        extractedContent = {
          textContent: pageState.visibleText,
          title: pageState.title,
          links: pageState.links
        };
        
        artifacts.push({
          id: crypto.randomUUID(),
          type: "text",
          name: `content_${new URL(url).hostname}.txt`,
          content: pageState.visibleText.slice(0, 50000),
          metadata: {
            title: pageState.title,
            linksCount: pageState.links?.length || 0
          }
        });
      }

      const finalUrl = result.data?.url || url;
      const finalTitle = result.data?.title || pageState?.title;
      const domain = new URL(finalUrl).hostname;
      const webSources = [{
        url: finalUrl,
        title: finalTitle || domain,
        domain: domain,
        favicon: `https://www.google.com/s2/favicons?domain=${domain}&sz=32`,
        snippet: extractedContent?.textContent?.slice(0, 200) || ""
      }];

      return {
        success: true,
        data: {
          url: finalUrl,
          title: finalTitle,
          textContent: extractedContent?.textContent?.slice(0, 50000),
          links: extractedContent?.links?.slice(0, 50),
          duration: result.duration,
          webSources
        },
        artifacts,
        metadata: {
          finalUrl,
          title: finalTitle,
          duration: result.duration,
          fetchMethod: "browser_session"
        }
      };
    } catch (error: any) {
      console.error("WEB_NAVIGATE: Error:", error.message, error.stack);
      return {
        success: false,
        error: error.message
      };
    } finally {
      if (sessionId) {
        if (takeScreenshot) browserSessionManager.stopScreenshotStreaming(sessionId);
        // Delay closing to allow frontend to receive final screenshot
        setTimeout(async () => {
          await browserSessionManager.closeSession(sessionId!).catch(() => {});
        }, 5000);
      }
    }
  }
};
