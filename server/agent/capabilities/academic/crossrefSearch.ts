import { z } from 'zod';
import { AgentCapability } from '../registry';

export const crossrefSearchCapability: AgentCapability = {
    name: "search_peer_reviewed_literature",
    description: "Búsqueda en base de datos Crossref para obtener literatura académica revisada por pares (peer-reviewed). Retorna DOIs, autores, resúmenes y títulos.",
    schema: z.object({
        query: z.string().describe("Término de búsqueda, puede ser palabras clave, título o autores."),
        limit: z.number().optional().default(3).describe("Número máximo de resultados a recuperar (1-10).")
    }),
    execute: async ({ query, limit }) => {
        try {
            console.log(`[Academic Submodule] Searching Crossref for: "${query}"`);

            const safeLimit = Math.min(Math.max(limit || 3, 1), 10);

            // Consultamos la API pública de Crossref filtrando por journal-article (que casi siempre es peer-reviewed)
            const url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&filter=type:journal-article&select=DOI,title,author,abstract,published,is-referenced-by-count&rows=${safeLimit}`;

            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'ILIAGPT/1.0 (mailto:hello@iliagpt.com)' // Crossref etiquette
                }
            });

            if (!response.ok) {
                throw new Error(`Crossref API responded with status: ${response.status}`);
            }

            const data = await response.json() as any;
            const items = data.message?.items || [];

            const results = items.map((item: any) => ({
                title: item.title?.[0] || 'Unknown Title',
                doi: item.DOI,
                authors: item.author?.map((a: any) => `${a.given} ${a.family}`).join(', ') || 'Unknown Authors',
                citations: item['is-referenced-by-count'] || 0,
                published_year: item.published?.['date-parts']?.[0]?.[0] || 'Unknown Year',
                // Crossref doesn't always provide abstract, limit to first 300 chars if present
                abstract_snippet: item.abstract
                    ? item.abstract.replace(/(<([^>]+)>)/ig, '').substring(0, 300) + '...'
                    : 'Abstract not provided dynamically by publisher.',
                is_peer_reviewed_probable: true // Assuming journal-article filter ensures this mostly
            }));

            return {
                query_executed: query,
                total_found: data.message?.['total-results'] || 0,
                results
            };

        } catch (error: any) {
            console.error("[Academic Submodule Error]", error.message);
            return { error: `Failed to search crossref. Reason: ${error.message}` };
        }
    }
};
