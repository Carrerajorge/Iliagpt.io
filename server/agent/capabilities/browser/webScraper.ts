// server/agent/capabilities/browser/webScraper.ts
import { z } from 'zod';
import type { AgentCapability } from '../registry';

export const webScraperCapability: AgentCapability = {
    name: 'browser.scrape_page',
    description: 'Extrae texto HTML de una página web',
    schema: z.object({ url: z.string().url() }),
    async execute(args) {
        // Puppeteer logic goes here
        return { text: `Contenido mock de ${args.url}` };
    }
};
