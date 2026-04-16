import { Router, Request, Response, NextFunction } from 'express';
import { randomUUID, createHmac } from 'crypto';

// --- Types ---
interface ApiKey {
  id: string;
  key: string;
  userId: string;
  orgId?: string;
  name: string;
  createdAt: Date;
  rateLimit: number;
}

interface Webhook {
  id: string;
  userId: string;
  url: string;
  events: string[];
  secret: string;
  createdAt: Date;
}

interface RateEntry {
  count: number;
  resetAt: number;
}

// --- Stores ---
const apiKeys = new Map<string, ApiKey>();
const webhooks = new Map<string, Webhook[]>();
const rateCounts = new Map<string, RateEntry>();

const AVAILABLE_MODELS = [
  { id: 'gpt-4o', owned_by: 'openai' },
  { id: 'gpt-4o-mini', owned_by: 'openai' },
  { id: 'claude-sonnet-4-20250514', owned_by: 'anthropic' },
  { id: 'claude-3-5-haiku-20241022', owned_by: 'anthropic' },
  { id: 'gemini-2.0-flash', owned_by: 'google' },
  { id: 'grok-3', owned_by: 'xai' },
  { id: 'deepseek-chat', owned_by: 'deepseek' },
];

// --- API Key Management ---
export function createApiKey(userId: string, name: string, orgId?: string): ApiKey {
  const entry: ApiKey = {
    id: randomUUID(),
    key: `sk-${randomUUID().replace(/-/g, '')}`,
    userId,
    orgId,
    name,
    createdAt: new Date(),
    rateLimit: 100,
  };
  apiKeys.set(entry.key, entry);
  return entry;
}

export function revokeApiKey(keyId: string): boolean {
  for (const [key, entry] of apiKeys) {
    if (entry.id === keyId) { apiKeys.delete(key); return true; }
  }
  return false;
}

export function listApiKeys(userId: string): ApiKey[] {
  return [...apiKeys.values()].filter((k) => k.userId === userId);
}

// --- Webhook System ---
export function registerWebhook(userId: string, url: string, events: string[]): Webhook {
  const wh: Webhook = {
    id: randomUUID(),
    userId,
    url,
    events,
    secret: randomUUID(),
    createdAt: new Date(),
  };
  const list = webhooks.get(userId) ?? [];
  list.push(wh);
  webhooks.set(userId, list);
  return wh;
}

export async function triggerWebhook(event: string, data: unknown): Promise<void> {
  const delays = [1000, 4000, 16000];
  for (const list of webhooks.values()) {
    for (const wh of list) {
      if (!wh.events.includes(event) && !wh.events.includes('*')) continue;
      const body = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
      const signature = createHmac('sha256', wh.secret).update(body).digest('hex');
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(wh.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': signature },
            body,
          });
          if (res.ok) break;
        } catch { /* retry */ }
        if (attempt < 2) await new Promise((r) => setTimeout(r, delays[attempt]));
      }
    }
  }
}

// --- Middleware ---
function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing API key' }); return; }
  const entry = apiKeys.get(header.slice(7));
  if (!entry) { res.status(401).json({ error: 'Invalid API key' }); return; }
  (req as any).apiKey = entry;
  next();
}

function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const key = (req as any).apiKey as ApiKey;
  const now = Date.now();
  let entry = rateCounts.get(key.id);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + 60_000 };
    rateCounts.set(key.id, entry);
  }
  entry.count++;
  if (entry.count > key.rateLimit) {
    res.status(429).json({ error: 'Rate limit exceeded' });
    return;
  }
  next();
}

// --- Router ---
export const publicApiRouter = Router();
publicApiRouter.use(authenticate, rateLimit);

publicApiRouter.get('/v1/models', (_req: Request, res: Response) => {
  res.json({
    object: 'list',
    data: AVAILABLE_MODELS.map((m) => ({ ...m, object: 'model' as const })),
  });
});

publicApiRouter.post('/v1/chat/completions', async (req: Request, res: Response) => {
  const { model, messages, stream, max_tokens, temperature } = req.body ?? {};
  if (!model || !Array.isArray(messages)) {
    res.status(400).json({ error: 'model and messages are required' });
    return;
  }

  const completionId = `chatcmpl-${randomUUID().slice(0, 12)}`;

  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Placeholder: integrate with LLM gateway for real streaming
    const content = `Response from ${model} (streaming)`;
    for (const char of content) {
      const chunk = {
        id: completionId,
        object: 'chat.completion.chunk',
        model,
        choices: [{ index: 0, delta: { content: char }, finish_reason: null }],
      };
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
    const done = {
      id: completionId,
      object: 'chat.completion.chunk',
      model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    };
    res.write(`data: ${JSON.stringify(done)}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  // Placeholder: integrate with LLM gateway for real completion
  const content = `Response from ${model}`;
  const promptTokens = messages.reduce((n: number, m: any) => n + (m.content?.length ?? 0), 0);
  res.json({
    id: completionId,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: 'stop',
    }],
    usage: {
      prompt_tokens: Math.ceil(promptTokens / 4),
      completion_tokens: Math.ceil(content.length / 4),
      total_tokens: Math.ceil((promptTokens + content.length) / 4),
    },
  });
});
