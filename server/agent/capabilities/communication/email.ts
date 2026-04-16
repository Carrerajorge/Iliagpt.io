import { z } from 'zod';
import type { AgentCapability } from '../registry';

// --- T17: EMAIL SCRAPING & IMAP ---
export const emailFetcherCapability: AgentCapability = {
    name: 'communication.email_fetch',
    description: 'Solicita al motor leer los últimos emails no leídos del inbox del usuario vía IMAP / OAUTH2.',
    schema: z.object({
        limit: z.number().min(1).max(50).default(10).describe("Cantidad máxima de emails a extraer."),
        folder: z.string().default('INBOX').describe("Carpeta o Label ('INBOX', 'SPAM', 'SENT')")
    }),
    async execute(args) {
        // En una implementación real, aquí se usa node-imap o la Google Gmail API.
        console.log(`[EmailCapability] Fetching top ${args.limit} unread emails from ${args.folder}...`);

        await new Promise(r => setTimeout(r, 600)); // Simular latencia de red

        return {
            success: true,
            folder: args.folder,
            emails: [
                { id: 'mail_1', from: 'jorge@iliagpt.com', subject: 'Revisión Plan Maestro', snippet: '[Mock] Todo listo Director.', date: new Date().toISOString() },
                { id: 'mail_2', from: 'alerts@aws.com', subject: 'Billing threshold reached', snippet: '[Mock] Attention your AWS bill...', date: new Date().toISOString() }
            ].slice(0, args.limit)
        };
    }
};
