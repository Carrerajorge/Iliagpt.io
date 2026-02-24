import { z } from 'zod';
import { AgentCapability } from '../registry';

export const citationFormatterCapability: AgentCapability = {
    name: "format_citation",
    description: "Recibe los metadatos de un paper (Autores, Año, Título, Revista, DOI) y los devuelve correctamente citados en el formato estandarizado solicitado (APA, IEEE, Chicago, MLA).",
    schema: z.object({
        format: z.enum(['APA', 'IEEE', 'MLA', 'CHICAGO']).describe("El formato de citación deseado."),
        authors: z.string().describe("Lista de autores. Ejemplo: 'Doe J., Smith A.'"),
        year: z.union([z.number(), z.string()]).describe("Año de publicación."),
        title: z.string().describe("Título del paper."),
        journal: z.string().optional().describe("Revista o journal (Opcional)."),
        doi: z.string().optional().describe("DOI del documento (Opcional).")
    }),
    execute: async ({ format, authors, year, title, journal, doi }) => {

        let citation = "";
        const jrn = journal ? ` ${journal}.` : "";
        const identifier = doi ? ` https://doi.org/${doi}` : "";

        // Heuristic string manipulation para los 4 estilos más pedidos por investigadores:
        switch (format) {
            case 'APA':
                // APA: Doe, J. (Year). Title. Journal. https://doi.org/...
                citation = `${authors} (${year}). ${title}.${jrn}${identifier}`;
                break;
            case 'IEEE':
                // IEEE: J. Doe, "Title," Journal, Year. doi: ...
                citation = `${authors}, "${title},"${jrn} ${year}.${identifier ? ' doi: ' + doi : ''}`;
                break;
            case 'MLA':
                // MLA: Doe, J. "Title." Journal, Year.
                citation = `${authors}. "${title}."${jrn} ${year}.${identifier}`;
                break;
            case 'CHICAGO':
                // Chicago: Doe, J. Year. "Title." Journal. doi.
                citation = `${authors}. ${year}. "${title}."${jrn}${identifier}`;
                break;
            default:
                citation = `${authors} (${year}). ${title}.${jrn}${identifier}`;
        }

        return {
            style_applied: format,
            formatted_citation: citation,
            status: "success"
        };
    }
};
