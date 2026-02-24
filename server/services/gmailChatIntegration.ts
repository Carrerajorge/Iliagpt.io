import { 
  searchEmailsForUser, 
  checkGmailConnectionForUser,
  getEmailThreadForUser,
  type EmailSummary,
  type EmailThread
} from './gmailService';
import { format, parseISO, isToday, isYesterday, isThisWeek, isThisMonth } from 'date-fns';
import { es } from 'date-fns/locale';
import { geminiChat, GEMINI_MODELS, type GeminiChatMessage } from '../lib/gemini';

export interface GmailSearchRequest {
  query: string;
  maxResults?: number;
  pageToken?: string;
}

export interface FormattedEmailResult {
  markdown: string;
  emailCount: number;
  hasMore: boolean;
  nextPageToken?: string;
}

const EMAIL_PRIMARY_KEYWORDS = [
  'correo', 'correos', 'email', 'emails', 'mail', 'mails',
  'inbox', 'bandeja de entrada', 'bandeja',
  'gmail'
];

const EMAIL_ACTION_PATTERNS = [
  /(?:busca|buscar|muestra|mostrar|dame|ver|lista|listar)\s+(?:mis?\s+)?(?:correos?|emails?|mails?)/i,
  /(?:cuáles?|cuales?|qué|que)\s+(?:son\s+)?(?:mis?\s+)?(?:correos?|emails?)/i,
  /(?:correos?|emails?)\s+(?:de\s+)?(?:hoy|ayer|esta semana|este mes)/i,
  /(?:correos?|emails?)\s+(?:de|from)\s+\S+/i,
  /(?:correos?|emails?)\s+(?:no leídos?|sin leer|unread|importantes?|destacados?)/i,
  /(?:tengo|hay)\s+(?:correos?|emails?)\s+(?:nuevos?|sin leer)?/i,
  /mis\s+(?:correos?|emails?|mails?)/i
];

const TIME_FILTERS: Record<string, string> = {
  'hoy': 'newer_than:1d',
  'ayer': 'older_than:1d newer_than:2d',
  'esta semana': 'newer_than:7d',
  'este mes': 'newer_than:30d',
  'últimos 7 días': 'newer_than:7d',
  'últimos 30 días': 'newer_than:30d',
  'último mes': 'newer_than:30d',
  'semana pasada': 'older_than:7d newer_than:14d'
};

// Words that should NOT be matched as sender names
const EXCLUDED_FROM_SENDER = [
  'hoy', 'ayer', 'mañana', 'semana', 'mes', 'año',
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo',
  'esta', 'este', 'pasada', 'pasado', 'última', 'último', 'próxima', 'próximo',
  'día', 'dias', 'días', 'fecha', 'el', 'la', 'los', 'las'
];

const SENDER_PATTERNS = [
  // Email address pattern - highest priority
  /(?:de|from)\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
  // Quoted name pattern
  /(?:correos?\s+)?de\s+["']([^"']+)["']/i,
  /from\s+["']([^"']+)["']/i
];

export function detectEmailIntent(message: string): boolean {
  const lowerMessage = message.toLowerCase();
  
  const hasPrimaryKeyword = EMAIL_PRIMARY_KEYWORDS.some(keyword => lowerMessage.includes(keyword));
  
  if (hasPrimaryKeyword) {
    return true;
  }
  
  return EMAIL_ACTION_PATTERNS.some(pattern => pattern.test(message));
}

function parseSpecificDate(message: string): string | null {
  const lowerMessage = message.toLowerCase();
  
  const months: Record<string, number> = {
    'enero': 0, 'febrero': 1, 'marzo': 2, 'abril': 3, 'mayo': 4, 'junio': 5,
    'julio': 6, 'agosto': 7, 'septiembre': 8, 'octubre': 9, 'noviembre': 10, 'diciembre': 11
  };
  
  // Pattern: "23 de diciembre", "día 23 de diciembre", "el 23 de diciembre"
  const datePattern = /(?:d[ií]a\s+)?(?:el\s+)?(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/i;
  const match = lowerMessage.match(datePattern);
  
  if (match) {
    const day = parseInt(match[1], 10);
    const monthName = match[2].toLowerCase();
    const month = months[monthName];
    
    if (month !== undefined && day >= 1 && day <= 31) {
      const currentYear = new Date().getFullYear();
      // Format: YYYY/MM/DD
      const monthFormatted = String(month + 1).padStart(2, '0');
      const dayFormatted = String(day).padStart(2, '0');
      
      // Create date range for that specific day
      const startDate = `${currentYear}/${monthFormatted}/${dayFormatted}`;
      const nextDay = day + 1;
      const nextDayFormatted = String(nextDay).padStart(2, '0');
      const endDate = `${currentYear}/${monthFormatted}/${nextDayFormatted}`;
      
      return `after:${startDate} before:${endDate}`;
    }
  }
  
  return null;
}

export function extractGmailQuery(message: string): string {
  const lowerMessage = message.toLowerCase();
  let query = '';
  
  // First try to parse specific date like "23 de diciembre"
  const specificDate = parseSpecificDate(message);
  if (specificDate) {
    query += ` ${specificDate}`;
  } else {
    // Fall back to relative time filters
    for (const [phrase, gmailFilter] of Object.entries(TIME_FILTERS)) {
      if (lowerMessage.includes(phrase)) {
        query += ` ${gmailFilter}`;
        break;
      }
    }
  }
  
  // Check for sender patterns - only email addresses or quoted names
  for (const pattern of SENDER_PATTERNS) {
    const match = message.match(pattern);
    if (match && match[1]) {
      const potentialSender = match[1].trim().toLowerCase();
      
      // Skip if it's a date-related word
      const isExcluded = EXCLUDED_FROM_SENDER.some(word => 
        potentialSender === word || potentialSender.startsWith(word + ' ')
      );
      
      if (!isExcluded && potentialSender.length > 2) {
        query += ` from:${match[1]}`;
        break;
      }
    }
  }
  
  if (lowerMessage.includes('no leído') || lowerMessage.includes('no leídos') || 
      lowerMessage.includes('sin leer') || lowerMessage.includes('unread')) {
    query += ' is:unread';
  }
  
  if (lowerMessage.includes('importante') || lowerMessage.includes('important')) {
    query += ' is:important';
  }
  
  if (lowerMessage.includes('destacado') || lowerMessage.includes('starred')) {
    query += ' is:starred';
  }
  
  const subjectMatch = message.match(/(?:sobre|asunto|subject|con\s+asunto)\s+["']?([^"'\n]+)["']?/i);
  if (subjectMatch && subjectMatch[1]) {
    query += ` subject:${subjectMatch[1].trim()}`;
  }
  
  return query.trim() || 'in:inbox';
}

function formatEmailDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    
    if (isToday(date)) {
      return format(date, 'HH:mm');
    } else if (isYesterday(date)) {
      return `Ayer ${format(date, 'HH:mm')}`;
    } else if (isThisWeek(date)) {
      return format(date, 'EEE HH:mm', { locale: es });
    } else if (isThisMonth(date)) {
      return format(date, 'd MMM HH:mm', { locale: es });
    } else {
      return format(date, 'd MMM yyyy', { locale: es });
    }
  } catch {
    return dateStr;
  }
}

function formatLabels(labels: string[]): string {
  const visibleLabels = labels.filter(label => 
    !['CATEGORY_UPDATES', 'CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_PERSONAL', 'CATEGORY_FORUMS'].includes(label) ||
    labels.includes('UNREAD') || labels.includes('IMPORTANT') || labels.includes('STARRED')
  );
  
  const labelMap: Record<string, string> = {
    'UNREAD': 'UNREAD',
    'INBOX': 'INBOX',
    'IMPORTANT': 'IMPORTANT',
    'STARRED': 'STARRED',
    'SENT': 'SENT',
    'DRAFT': 'DRAFT',
    'SPAM': 'SPAM',
    'TRASH': 'TRASH',
    'CATEGORY_UPDATES': 'CATEGORY_UPDATES',
    'CATEGORY_PROMOTIONS': 'CATEGORY_PROMOTIONS',
    'CATEGORY_SOCIAL': 'CATEGORY_SOCIAL',
    'CATEGORY_PERSONAL': 'CATEGORY_PERSONAL',
    'CATEGORY_FORUMS': 'CATEGORY_FORUMS'
  };
  
  return visibleLabels
    .slice(0, 3)
    .map(label => `\`${labelMap[label] || label}\``)
    .join(', ');
}

function getFaviconDomain(email: string): string {
  try {
    const domain = email.split('@')[1];
    return domain || '';
  } catch {
    return '';
  }
}

export function formatEmailsAsMarkdown(emails: EmailSummary[], startIndex: number = 1): string {
  if (emails.length === 0) {
    return 'No se encontraron correos que coincidan con tu búsqueda.';
  }
  
  const formattedEmails = emails.map((email, index) => {
    const num = startIndex + index;
    const senderName = email.from || 'Sin remitente';
    const senderEmail = email.fromEmail || '';
    const subject = email.subject || '(Sin asunto)';
    const time = formatEmailDate(email.date);
    const labels = formatLabels(email.labels);
    const snippet = email.snippet ? email.snippet.slice(0, 80) + (email.snippet.length > 80 ? '...' : '') : '';
    const domain = getFaviconDomain(senderEmail);
    
    const emailLink = senderEmail ? `[${senderEmail}](mailto:${senderEmail}) ↗` : '';
    
    let line = `${num}. **${senderName}** ${emailLink} — *${subject}* · ${time}`;
    
    if (labels) {
      line += ` · [${labels}]`;
    }
    
    line += `.`;
    
    if (snippet) {
      const domainTag = domain ? `📧 ${domain} ` : '📧 ';
      line += `\n   ${domainTag}${snippet}`;
    }
    
    return line;
  }).join('\n\n');
  
  return formattedEmails;
}

export async function searchAndFormatEmails(
  userId: string,
  userMessage: string,
  maxResults: number = 500
): Promise<FormattedEmailResult | null> {
  try {
    const connection = await checkGmailConnectionForUser(userId);
    if (!connection.connected) {
      return null;
    }
    
    const gmailQuery = extractGmailQuery(userMessage);
    console.log(`[Gmail Chat] User query: "${userMessage}" -> Gmail query: "${gmailQuery}"`);
    
    const allEmails: EmailSummary[] = [];
    let pageToken: string | undefined = undefined;
    let totalFetched = 0;
    const batchSize = 50;
    
    while (totalFetched < maxResults) {
      const remaining = maxResults - totalFetched;
      const fetchCount = Math.min(batchSize, remaining);
      
      const result = await searchEmailsForUser(
        userId,
        gmailQuery,
        fetchCount,
        undefined,
        pageToken
      );
      
      allEmails.push(...result.emails);
      totalFetched += result.emails.length;
      
      if (!result.nextPageToken || result.emails.length < fetchCount) {
        pageToken = undefined;
        break;
      }
      
      pageToken = result.nextPageToken;
    }
    
    if (allEmails.length === 0) {
      return {
        markdown: `No encontré correos que coincidan con "${userMessage}".\n\nPuedes intentar con:\n- "correos de hoy"\n- "correos de [remitente]"\n- "correos no leídos"\n- "correos importantes"`,
        emailCount: 0,
        hasMore: false
      };
    }
    
    const markdown = formatEmailsAsMarkdown(allEmails);
    
    const header = `📬 **Encontré ${allEmails.length} correo${allEmails.length !== 1 ? 's' : ''}**\n\n`;
    
    const footer = `\n\n---\n\nSi quieres puedo:\n- **Mostrar más** (siguientes correos)\n- **Filtrar** solo los no leídos\n- **Abrir/leer** cualquiera de los correos listados (dime el número)\n\n¿Qué prefieres?`;
    
    return {
      markdown: header + markdown + footer,
      emailCount: allEmails.length,
      hasMore: !!pageToken,
      nextPageToken: pageToken
    };
    
  } catch (error: any) {
    console.error('[Gmail Chat] Error searching emails:', error);
    
    if (error.message?.includes('Gmail not connected')) {
      return {
        markdown: '❌ Gmail no está conectado. Por favor, conecta tu cuenta de Gmail desde la configuración de integraciones.',
        emailCount: 0,
        hasMore: false
      };
    }
    
    if (error.message?.includes('token expired') || error.message?.includes('reconnect')) {
      return {
        markdown: '⚠️ Tu sesión de Gmail ha expirado. Por favor, reconecta tu cuenta de Gmail.',
        emailCount: 0,
        hasMore: false
      };
    }
    
    return {
      markdown: `❌ Error al buscar correos: ${error.message}`,
      emailCount: 0,
      hasMore: false
    };
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs))
  ]);
}

async function fetchEmailContentsForContext(
  userId: string,
  emails: EmailSummary[],
  maxEmails: number = 10
): Promise<{ context: string; warnings: string[] }> {
  const emailsToFetch = emails.slice(0, maxEmails);
  const warnings: string[] = [];
  let timeoutCount = 0;
  
  const fetchPromises = emailsToFetch.map(async (email, index) => {
    const emailNumber = index + 1;
    const gmailLink = email.source?.permalink || `https://mail.google.com/mail/u/0/#all/${email.id}`;
    
    const fallbackContent = `
---
**Correo #${emailNumber}**
**De:** ${email.from}
**Fecha:** ${email.date}
**Asunto:** ${email.subject}
**Estado:** ${email.isUnread ? 'No leído' : 'Leído'}

**Vista previa:** ${email.snippet}

**Enlace Gmail:** ${gmailLink}
---`;
    
    const fetchWithTimeout = withTimeout(
      (async () => {
        try {
          const thread = await getEmailThreadForUser(userId, email.threadId);
          if (thread && thread.messages.length > 0) {
            const lastMessage = thread.messages[thread.messages.length - 1];
            const bodyPreview = lastMessage.body.slice(0, 1000) + (lastMessage.body.length > 1000 ? '...' : '');
            
            const senderInfo = email.fromEmail ? `${email.from} <${email.fromEmail}>` : email.from;
            
            return {
              content: `
---
**Correo #${emailNumber}**
**De:** ${senderInfo}
**Para:** ${email.to || 'N/A'}
**Fecha:** ${email.date}
**Asunto:** ${email.subject}
**Estado:** ${email.isUnread ? 'No leído' : 'Leído'}
**Etiquetas:** ${email.labels.join(', ') || 'Ninguna'}

**Contenido:**
${bodyPreview}

**Enlace Gmail:** ${gmailLink}
---`,
              timedOut: false
            };
          }
          return { content: fallbackContent, timedOut: false };
        } catch (error) {
          console.error(`[Gmail Chat] Error fetching thread ${email.threadId}:`, error);
          return { content: fallbackContent + '\n*(Error al cargar contenido)*', timedOut: false };
        }
      })(),
      5000,
      { content: fallbackContent + '\n*(Tiempo de espera agotado)*', timedOut: true }
    );
    
    return fetchWithTimeout;
  });
  
  const results = await Promise.all(fetchPromises);
  
  const emailContents: string[] = [];
  results.forEach((result) => {
    emailContents.push(result.content);
    if (result.timedOut) {
      timeoutCount++;
    }
  });
  
  if (timeoutCount > 0) {
    warnings.push(`${timeoutCount} correo(s) usaron vista previa por tiempo de espera`);
  }
  
  return {
    context: emailContents.join('\n\n'),
    warnings
  };
}

async function analyzeEmailsWithAI(
  userMessage: string,
  emailContext: string,
  emailCount: number
): Promise<string> {
  const systemPrompt = `Eres un asistente inteligente de correo electrónico.

FORMATO OBLIGATORIO para listar correos:

**[N]. De: [Remitente]**
- **Asunto:** [Asunto]
- **Hora:** [HH:MM]
- **Resumen:** [2 líneas máximo] [![Gmail](https://iliagpt.blog/gmail-logo.webp)]([ENLACE])

Donde [ENLACE] es el valor de "Enlace Gmail" de cada correo en el contexto.

IMPORTANTE: El logo de Gmail DEBE aparecer al final del resumen como un pequeño icono clickeable que abre el correo original.

CONTEXTO (${emailCount} correos):
${emailContext}`;

  const messages: GeminiChatMessage[] = [
    { role: 'user', parts: [{ text: userMessage }] }
  ];
  
  try {
    const response = await geminiChat(messages, {
      model: GEMINI_MODELS.FLASH,
      temperature: 0.7,
      systemInstruction: systemPrompt
    });
    
    return response.content;
  } catch (error) {
    console.error('[Gmail Chat] AI analysis error:', error);
    return `❌ Error al analizar los correos. Por favor, intenta de nuevo.`;
  }
}

export async function handleEmailChatRequest(
  userId: string,
  userMessage: string
): Promise<{ handled: boolean; response?: string }> {
  if (!detectEmailIntent(userMessage)) {
    return { handled: false };
  }
  
  const connection = await checkGmailConnectionForUser(userId);
  if (!connection.connected) {
    return { 
      handled: true, 
      response: '📧 Para acceder a tus correos, primero necesitas conectar tu cuenta de Gmail. Ve a la sección de integraciones para configurarlo.' 
    };
  }
  
  console.log(`[Gmail Chat] Processing email request for user ${userId}: "${userMessage}"`);
  
  const gmailQuery = extractGmailQuery(userMessage);
  console.log(`[Gmail Chat] Gmail query: "${gmailQuery}"`);
  
  try {
    const searchResult = await searchEmailsForUser(userId, gmailQuery, 20);
    
    if (searchResult.emails.length === 0) {
      return {
        handled: true,
        response: `📭 No encontré correos que coincidan con tu búsqueda.\n\nPuedes intentar con:\n- "Mis correos de hoy"\n- "Correos de [nombre o email]"\n- "Correos no leídos"\n- "Correos importantes"`
      };
    }
    
    const { context: emailContext, warnings } = await fetchEmailContentsForContext(userId, searchResult.emails, 10);
    
    const aiResponse = await analyzeEmailsWithAI(
      userMessage,
      emailContext,
      searchResult.emails.length
    );
    
    let finalResponse = aiResponse;
    if (warnings.length > 0) {
      finalResponse += `\n\n⚠️ *Nota: ${warnings.join('. ')}*`;
    }
    
    return {
      handled: true,
      response: finalResponse
    };
    
  } catch (error: any) {
    console.error('[Gmail Chat] Error:', error);
    
    if (error.message?.includes('token expired') || error.message?.includes('reconnect')) {
      return {
        handled: true,
        response: '⚠️ Tu sesión de Gmail ha expirado. Por favor, reconecta tu cuenta de Gmail desde la configuración.'
      };
    }
    
    return {
      handled: true,
      response: `❌ Error al procesar tu solicitud de correos: ${error.message}`
    };
  }
}
