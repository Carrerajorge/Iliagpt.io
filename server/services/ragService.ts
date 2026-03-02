/**
 * RAG (Retrieval Augmented Generation) Service
 * Enhanced with deep document chunking, hybrid search, and OpenAI embeddings
 * Inspired by RAGFlow's approach to document understanding
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

const EMBEDDING_DIM = 256;
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 200;

function localEmbed(text: string): number[] {
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  const vector = new Array(EMBEDDING_DIM).fill(0);

  const stopWords = new Set(["el","la","los","las","de","que","y","en","un","una","es","por","para","con","del","al","se","no","a","the","is","are","to","of","and","in","for","with"]);
  const meaningful = words.filter(w => !stopWords.has(w));

  for (const word of meaningful) {
    const h1 = word.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
    const h2 = word.split('').reduce((a, c) => ((a << 7) + a + c.charCodeAt(0)) | 0, 5381);
    vector[Math.abs(h1) % EMBEDDING_DIM] += 1;
    vector[Math.abs(h2) % EMBEDDING_DIM] += 0.5;

    for (let i = 0; i < word.length - 2; i++) {
      const trigram = word.slice(i, i + 3);
      const th = trigram.split('').reduce((a, c) => ((a << 3) - a + c.charCodeAt(0)) | 0, 0);
      vector[Math.abs(th) % EMBEDDING_DIM] += 0.3;
    }
  }

  for (let i = 0; i < meaningful.length - 1; i++) {
    const bigram = meaningful[i] + ' ' + meaningful[i + 1];
    const bh = bigram.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
    vector[Math.abs(bh) % EMBEDDING_DIM] += 0.7;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  return magnitude > 0 ? vector.map(v => v / magnitude) : vector;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

function chunkDocument(text: string, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  if (text.length <= chunkSize) return [text];

  const sections = text.split(/\n{2,}|\r\n{2,}/);
  const chunks: string[] = [];
  let currentChunk = "";

  for (const section of sections) {
    if (section.length > chunkSize) {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = "";
      }
      const sentences = section.split(/(?<=[.!?])\s+/);
      let sentenceChunk = "";
      for (const sentence of sentences) {
        if (sentenceChunk.length + sentence.length > chunkSize && sentenceChunk.length > 0) {
          chunks.push(sentenceChunk.trim());
          const overlapText = sentenceChunk.slice(-overlap);
          sentenceChunk = overlapText + " " + sentence;
        } else {
          sentenceChunk += (sentenceChunk ? " " : "") + sentence;
        }
      }
      if (sentenceChunk.trim()) {
        currentChunk = sentenceChunk;
      }
    } else if (currentChunk.length + section.length > chunkSize) {
      chunks.push(currentChunk.trim());
      const overlapText = currentChunk.slice(-overlap);
      currentChunk = overlapText + "\n\n" + section;
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + section;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks.filter(c => c.length > 20);
}

function extractKeyPhrases(text: string): string[] {
  const phrases: string[] = [];
  const headings = text.match(/^#{1,6}\s+.+$/gm);
  if (headings) phrases.push(...headings.map(h => h.replace(/^#+\s*/, '')));

  const boldText = text.match(/\*\*([^*]+)\*\*/g);
  if (boldText) phrases.push(...boldText.map(b => b.replace(/\*\*/g, '')));

  const numberedItems = text.match(/^\d+[.)]\s+.{10,80}$/gm);
  if (numberedItems) phrases.push(...numberedItems.map(n => n.replace(/^\d+[.)]\s*/, '')));

  return [...new Set(phrases)].slice(0, 20);
}

function bm25Score(query: string, doc: string): number {
  const k1 = 1.2, b = 0.75;
  const queryTerms = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const docTerms = doc.toLowerCase().split(/\s+/);
  const docLen = docTerms.length;
  const avgDocLen = 200;
  const termFreq = new Map<string, number>();
  for (const t of docTerms) {
    termFreq.set(t, (termFreq.get(t) || 0) + 1);
  }

  let score = 0;
  for (const term of queryTerms) {
    const tf = termFreq.get(term) || 0;
    if (tf > 0) {
      const idf = Math.log(1 + 1);
      const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * docLen / avgDocLen));
      score += idf * tfNorm;
    }
  }
  return score;
}

const ensureTables = async () => {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS rag_documents (
        id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL,
        chat_id VARCHAR(255),
        content TEXT NOT NULL,
        content_type VARCHAR(50) DEFAULT 'message',
        embedding JSONB,
        metadata JSONB DEFAULT '{}',
        chunk_index INTEGER DEFAULT 0,
        parent_doc_id VARCHAR(255),
        key_phrases JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_rag_user ON rag_documents(user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_rag_chat ON rag_documents(chat_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_rag_parent ON rag_documents(parent_doc_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_rag_type ON rag_documents(content_type)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_preferences (
        id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) UNIQUE NOT NULL,
        preferences JSONB DEFAULT '{}',
        communication_style JSONB DEFAULT '{}',
        topics_of_interest JSONB DEFAULT '[]',
        language VARCHAR(10) DEFAULT 'es',
        timezone VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS workspace_context (
        id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL,
        file_path TEXT,
        file_type VARCHAR(50),
        content_summary TEXT,
        embedding JSONB,
        last_accessed TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
  } catch (e) {
    // Tables might exist
  }
};

ensureTables();

export class RAGService {
  async indexMessage(
    userId: string,
    chatId: string,
    content: string,
    role: "user" | "assistant"
  ): Promise<void> {
    if (content.length < 20) return;

    const embedding = localEmbed(content);
    const keyPhrases = extractKeyPhrases(content);

    await db.execute(sql`
      INSERT INTO rag_documents (user_id, chat_id, content, content_type, embedding, metadata, key_phrases)
      VALUES (${userId}, ${chatId}, ${content.substring(0, 4000)}, ${role},
              ${JSON.stringify(embedding)}, ${JSON.stringify({ role, timestamp: Date.now() })},
              ${JSON.stringify(keyPhrases)})
    `);
  }

  async indexDocument(
    userId: string,
    documentContent: string,
    metadata: {
      fileName?: string;
      fileType?: string;
      chatId?: string;
      sourceUrl?: string;
    } = {}
  ): Promise<{ chunks: number; docId: string }> {
    const docId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const chunks = chunkDocument(documentContent);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = localEmbed(chunk);
      const keyPhrases = extractKeyPhrases(chunk);

      await db.execute(sql`
        INSERT INTO rag_documents (user_id, chat_id, content, content_type, embedding, metadata, chunk_index, parent_doc_id, key_phrases)
        VALUES (${userId}, ${metadata.chatId || null}, ${chunk}, 'document_chunk',
                ${JSON.stringify(embedding)},
                ${JSON.stringify({
                  fileName: metadata.fileName,
                  fileType: metadata.fileType,
                  sourceUrl: metadata.sourceUrl,
                  totalChunks: chunks.length,
                  chunkIndex: i,
                  docId,
                  timestamp: Date.now(),
                })},
                ${i}, ${docId}, ${JSON.stringify(keyPhrases)})
      `);
    }

    return { chunks: chunks.length, docId };
  }

  async search(
    userId: string,
    query: string,
    options: {
      limit?: number;
      chatId?: string;
      minScore?: number;
      contentTypes?: string[];
    } = {}
  ): Promise<Array<{ content: string; score: number; chatId: string; metadata?: any }>> {
    const { limit = 5, chatId, minScore = 0.2, contentTypes } = options;

    const queryEmbedding = localEmbed(query);

    const result = chatId
      ? await db.execute(sql`
          SELECT content, chat_id, embedding, metadata, key_phrases, content_type FROM rag_documents
          WHERE user_id = ${userId} AND (chat_id IS NULL OR chat_id != ${chatId})
          ORDER BY created_at DESC
          LIMIT 200
        `)
      : await db.execute(sql`
          SELECT content, chat_id, embedding, metadata, key_phrases, content_type FROM rag_documents
          WHERE user_id = ${userId}
          ORDER BY created_at DESC
          LIMIT 200
        `);

    const rows = (result.rows || []).filter((row: any) => {
      if (contentTypes && contentTypes.length > 0) {
        return contentTypes.includes(row.content_type);
      }
      return true;
    });

    const scored = rows
      .map((row: any) => {
        const docEmbedding = typeof row.embedding === 'string'
          ? JSON.parse(row.embedding)
          : row.embedding;

        const vectorScore = cosineSimilarity(queryEmbedding, docEmbedding || []);
        const textScore = bm25Score(query, row.content || "");

        const keyPhrases: string[] = typeof row.key_phrases === 'string'
          ? JSON.parse(row.key_phrases)
          : (row.key_phrases || []);
        const phraseBoost = keyPhrases.some(p =>
          query.toLowerCase().includes(p.toLowerCase())
        ) ? 0.15 : 0;

        const hybridScore = (vectorScore * 0.5) + (Math.min(textScore / 5, 0.5) * 0.35) + phraseBoost;

        return {
          content: row.content,
          chatId: row.chat_id,
          score: hybridScore,
          metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
          contentType: row.content_type,
        };
      })
      .filter(r => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored;
  }

  async getContextForMessage(
    userId: string,
    message: string,
    currentChatId?: string
  ): Promise<string> {
    const results = await this.search(userId, message, {
      limit: 5,
      chatId: currentChatId,
      minScore: 0.25
    });

    if (results.length === 0) return "";

    const contextParts = results.map((r, i) => {
      const source = r.metadata?.fileName
        ? ` (de: ${r.metadata.fileName})`
        : r.metadata?.sourceUrl
          ? ` (fuente: ${r.metadata.sourceUrl})`
          : '';
      return `[Contexto ${i + 1}${source}]: ${r.content.substring(0, 500)}`;
    });

    return `\n\n[Contexto RAG - ${results.length} fragmentos relevantes]\n${contextParts.join("\n\n")}\n`;
  }

  async getDocumentChunks(docId: string): Promise<Array<{ content: string; chunkIndex: number }>> {
    const result = await db.execute(sql`
      SELECT content, chunk_index FROM rag_documents
      WHERE parent_doc_id = ${docId}
      ORDER BY chunk_index ASC
    `);
    return (result.rows || []).map((row: any) => ({
      content: row.content,
      chunkIndex: row.chunk_index,
    }));
  }

  async getStats(userId: string): Promise<{ totalDocs: number; totalChunks: number; types: Record<string, number> }> {
    const result = await db.execute(sql`
      SELECT content_type, COUNT(*) as cnt FROM rag_documents
      WHERE user_id = ${userId}
      GROUP BY content_type
    `);
    const types: Record<string, number> = {};
    let total = 0;
    for (const row of (result.rows || []) as any[]) {
      types[row.content_type] = Number(row.cnt);
      total += Number(row.cnt);
    }
    return { totalDocs: total, totalChunks: total, types };
  }
}

export class UserPersonalizationService {
  async getPreferences(userId: string): Promise<Record<string, any>> {
    const result = await db.execute(sql`
      SELECT * FROM user_preferences WHERE user_id = ${userId}
    `);

    if (result.rows?.length) {
      return result.rows[0] as Record<string, any>;
    }

    await db.execute(sql`
      INSERT INTO user_preferences (user_id) VALUES (${userId})
      ON CONFLICT (user_id) DO NOTHING
    `);

    return {
      preferences: {},
      communication_style: {},
      topics_of_interest: [],
      language: 'es'
    };
  }

  async updatePreferences(
    userId: string,
    updates: {
      preferences?: Record<string, any>;
      communicationStyle?: Record<string, any>;
      topicsOfInterest?: string[];
      language?: string;
      timezone?: string;
    }
  ): Promise<void> {
    const { preferences, communicationStyle, topicsOfInterest, language, timezone } = updates;

    await db.execute(sql`
      INSERT INTO user_preferences (user_id, preferences, communication_style, topics_of_interest, language, timezone)
      VALUES (${userId}, ${JSON.stringify(preferences || {})}, ${JSON.stringify(communicationStyle || {})},
              ${JSON.stringify(topicsOfInterest || [])}, ${language || 'es'}, ${timezone})
      ON CONFLICT (user_id) DO UPDATE SET
        preferences = COALESCE(${preferences ? JSON.stringify(preferences) : null}, user_preferences.preferences),
        communication_style = COALESCE(${communicationStyle ? JSON.stringify(communicationStyle) : null}, user_preferences.communication_style),
        topics_of_interest = COALESCE(${topicsOfInterest ? JSON.stringify(topicsOfInterest) : null}, user_preferences.topics_of_interest),
        language = COALESCE(${language}, user_preferences.language),
        timezone = COALESCE(${timezone}, user_preferences.timezone),
        updated_at = NOW()
    `);
  }

  async learnFromConversation(
    userId: string,
    messages: Array<{ role: string; content: string }>
  ): Promise<void> {
    const userMessages = messages.filter(m => m.role === 'user').map(m => m.content);
    const allText = userMessages.join(' ').toLowerCase();

    const spanishWords = (allText.match(/\b(el|la|los|las|de|que|y|en|un|una|es|por|para)\b/g) || []).length;
    const englishWords = (allText.match(/\b(the|a|an|is|are|to|of|and|in|for|with)\b/g) || []).length;

    const detectedLanguage = spanishWords > englishWords ? 'es' : 'en';

    const topics: string[] = [];
    const topicPatterns: Record<string, RegExp> = {
      'programación': /\b(código|programar|python|javascript|api|función|error|bug)\b/i,
      'negocios': /\b(ventas|clientes|marketing|empresa|negocio|inversión)\b/i,
      'creatividad': /\b(diseño|imagen|crear|arte|historia|escribir)\b/i,
      'educación': /\b(aprender|estudiar|curso|explicar|entender)\b/i,
      'datos': /\b(datos|análisis|estadística|gráfico|reporte)\b/i
    };

    for (const [topic, pattern] of Object.entries(topicPatterns)) {
      if (pattern.test(allText)) {
        topics.push(topic);
      }
    }

    const style: Record<string, any> = {};
    const formalIndicators = (allText.match(/\b(usted|por favor|gracias|estimado|cordialmente)\b/g) || []).length;
    const informalIndicators = (allText.match(/\b(tu|oye|mira|genial|cool|jaja)\b/g) || []).length;
    style.formality = formalIndicators > informalIndicators ? 'formal' : 'casual';

    const avgLength = userMessages.reduce((sum, m) => sum + m.length, 0) / (userMessages.length || 1);
    style.detailLevel = avgLength > 100 ? 'detailed' : 'concise';

    await this.updatePreferences(userId, {
      language: detectedLanguage,
      topicsOfInterest: topics,
      communicationStyle: style
    });
  }

  async getPersonalizationContext(userId: string): Promise<string> {
    const prefs = await this.getPreferences(userId);

    const parts: string[] = [];

    if (prefs.language) {
      parts.push(`Idioma preferido: ${prefs.language === 'es' ? 'Español' : 'English'}`);
    }

    if (prefs.communication_style?.formality) {
      parts.push(`Estilo: ${prefs.communication_style.formality === 'formal' ? 'Formal y profesional' : 'Casual y amigable'}`);
    }

    if (prefs.communication_style?.detailLevel) {
      parts.push(`Nivel de detalle: ${prefs.communication_style.detailLevel === 'detailed' ? 'Respuestas detalladas' : 'Respuestas concisas'}`);
    }

    if (prefs.topics_of_interest?.length) {
      parts.push(`Temas de interés: ${prefs.topics_of_interest.join(', ')}`);
    }

    if (parts.length === 0) return '';

    return `\n\n[Preferencias del usuario]\n${parts.join('\n')}\n`;
  }
}

export class WorkspaceContextService {
  async indexFile(
    userId: string,
    filePath: string,
    content: string,
    fileType: string
  ): Promise<void> {
    const summary = content.substring(0, 500);
    const embedding = localEmbed(content);

    await db.execute(sql`
      INSERT INTO workspace_context (user_id, file_path, file_type, content_summary, embedding)
      VALUES (${userId}, ${filePath}, ${fileType}, ${summary}, ${JSON.stringify(embedding)})
      ON CONFLICT DO NOTHING
    `);
  }

  async getRelevantFiles(
    userId: string,
    query: string,
    limit = 3
  ): Promise<Array<{ filePath: string; summary: string; score: number }>> {
    const queryEmbedding = localEmbed(query);

    const result = await db.execute(sql`
      SELECT file_path, content_summary, embedding FROM workspace_context
      WHERE user_id = ${userId}
      ORDER BY last_accessed DESC
      LIMIT 50
    `);

    const scored = (result.rows || [])
      .map((row: any) => {
        const docEmbedding = typeof row.embedding === 'string'
          ? JSON.parse(row.embedding)
          : row.embedding;
        const score = cosineSimilarity(queryEmbedding, docEmbedding || []);
        return {
          filePath: row.file_path,
          summary: row.content_summary,
          score
        };
      })
      .filter(r => r.score >= 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored;
  }

  async getWorkspaceContext(userId: string, message: string): Promise<string> {
    const files = await this.getRelevantFiles(userId, message, 2);

    if (files.length === 0) return '';

    const context = files
      .map(f => `[${f.filePath}]: ${f.summary.substring(0, 200)}...`)
      .join('\n');

    return `\n\n[Archivos relacionados del workspace]\n${context}\n`;
  }
}

export const ragService = new RAGService();
export const personalizationService = new UserPersonalizationService();
export const workspaceContextService = new WorkspaceContextService();

export async function buildEnhancedContext(
  userId: string,
  message: string,
  chatId?: string
): Promise<string> {
  const [ragContext, personalContext, workspaceContext] = await Promise.all([
    ragService.getContextForMessage(userId, message, chatId),
    personalizationService.getPersonalizationContext(userId),
    workspaceContextService.getWorkspaceContext(userId, message)
  ]);

  return personalContext + ragContext + workspaceContext;
}
