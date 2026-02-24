import { browserSessionManager } from "./session-manager";
import { Observation, PageState, NetworkRequest } from "./types";

export interface StructuredData {
  metaTags: Record<string, string>;
  jsonLd: any[];
  openGraph: Record<string, string>;
  twitterCard: Record<string, string>;
  microdata: any[];
  tables: any[][];
  lists: string[][];
}

export interface ExtractedContent {
  title: string;
  description: string;
  mainContent: string;
  structuredData: StructuredData;
  links: { text: string; href: string }[];
  images: { src: string; alt: string }[];
  forms: { action: string; inputs: string[] }[];
}

class ObservationCollector {
  async collectFullObservation(sessionId: string): Promise<{
    state: PageState | null;
    screenshot: string | null;
    structured: StructuredData | null;
  }> {
    const state = await browserSessionManager.getPageState(sessionId);
    const screenshot = await browserSessionManager.getScreenshot(sessionId);
    const structured = state ? this.extractStructuredData(state) : null;

    return { state, screenshot, structured };
  }

  extractStructuredData(state: PageState): StructuredData {
    const openGraph: Record<string, string> = {};
    const twitterCard: Record<string, string> = {};

    Object.entries(state.metaTags).forEach(([key, value]) => {
      if (key.startsWith("og:")) {
        openGraph[key.replace("og:", "")] = value;
      } else if (key.startsWith("twitter:")) {
        twitterCard[key.replace("twitter:", "")] = value;
      }
    });

    return {
      metaTags: state.metaTags,
      jsonLd: state.jsonLd,
      openGraph,
      twitterCard,
      microdata: [],
      tables: [],
      lists: []
    };
  }

  async extractContent(sessionId: string): Promise<ExtractedContent | null> {
    const state = await browserSessionManager.getPageState(sessionId);
    if (!state) return null;

    const structured = this.extractStructuredData(state);

    return {
      title: state.title,
      description: state.metaTags["description"] || 
                   structured.openGraph["description"] || 
                   structured.twitterCard["description"] || "",
      mainContent: state.visibleText,
      structuredData: structured,
      links: state.links,
      images: state.images,
      forms: state.forms
    };
  }

  async extractDataBySelector(
    sessionId: string, 
    selectors: Record<string, string>
  ): Promise<Record<string, string | null>> {
    const session = browserSessionManager.getSession(sessionId);
    if (!session) return {};

    const result = await browserSessionManager.evaluate(sessionId, `
      (function() {
        const selectors = ${JSON.stringify(selectors)};
        const result = {};
        for (const [key, selector] of Object.entries(selectors)) {
          const el = document.querySelector(selector);
          result[key] = el ? el.textContent?.trim() || el.getAttribute('value') || null : null;
        }
        return result;
      })()
    `);

    return result.success ? result.data : {};
  }

  async extractTable(sessionId: string, tableSelector: string): Promise<string[][]> {
    const safeSelector = JSON.stringify(tableSelector);
    const result = await browserSessionManager.evaluate(sessionId, `
      (function() {
        const table = document.querySelector(${safeSelector});
        if (!table) return [];

        const rows = [];
        table.querySelectorAll('tr').forEach(tr => {
          const cells = [];
          tr.querySelectorAll('th, td').forEach(cell => {
            cells.push(cell.textContent?.trim() || '');
          });
          if (cells.length > 0) rows.push(cells);
        });
        return rows;
      })()
    `);

    return result.success ? result.data : [];
  }

  async extractList(sessionId: string, listSelector: string): Promise<string[]> {
    const safeSelector = JSON.stringify(listSelector);
    const result = await browserSessionManager.evaluate(sessionId, `
      (function() {
        const list = document.querySelector(${safeSelector});
        if (!list) return [];

        return Array.from(list.querySelectorAll('li')).map(li => li.textContent?.trim() || '');
      })()
    `);

    return result.success ? result.data : [];
  }

  formatObservationForLLM(state: PageState | null, screenshot: string | null): string {
    if (!state) return "No page state available.";

    const sections: string[] = [
      `# Current Page State`,
      `**URL:** ${state.url}`,
      `**Title:** ${state.title}`,
      ``,
      `## Visible Text (truncated):`,
      state.visibleText.slice(0, 2000),
      ``,
      `## Available Links (${state.links.length} total):`,
      ...state.links.slice(0, 15).map(l => `- [${l.text.slice(0, 50)}](${l.href})`),
      ``,
      `## Forms on Page (${state.forms.length}):`,
      ...state.forms.slice(0, 5).map(f => `- Action: ${f.action}, Fields: ${f.inputs.join(", ")}`),
    ];

    if (Object.keys(state.metaTags).length > 0) {
      sections.push(``, `## Meta Tags:`);
      Object.entries(state.metaTags).slice(0, 10).forEach(([k, v]) => {
        sections.push(`- ${k}: ${v.slice(0, 100)}`);
      });
    }

    if (state.jsonLd.length > 0) {
      sections.push(``, `## Structured Data (JSON-LD):`, JSON.stringify(state.jsonLd[0], null, 2).slice(0, 500));
    }

    return sections.join("\n");
  }
}

export const observationCollector = new ObservationCollector();
