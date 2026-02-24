/**
 * RAG (Retrieval Augmented Generation) Service
 * Embeddings + Vector Search for context retrieval
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

// Simple embedding using TF-IDF-like approach (for production use OpenAI embeddings)
function simpleEmbed(text: string): number[] {
  const words = text.toLowerCase().split(/\s+/);
  const vocab = new Map<string, number>();
  
  // Build vocabulary with positions
  words.forEach((word, idx) => {
    if (!vocab.has(word)) {
      vocab.set(word, vocab.size);
    }
  });
  
  // Create sparse vector (simplified 256-dim)
  const vector = new Array(256).fill(0);
  words.forEach(word => {
    const hash = word.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
    const idx = Math.abs(hash) % 256;
    vector[idx] += 1 / words.length;
  });
  
  // Normalize
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

// Ensure tables exist
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
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_rag_user ON rag_documents(user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_rag_chat ON rag_documents(chat_id)`);
    
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
  /**
   * Index a message for future retrieval
   */
  async indexMessage(
    userId: string,
    chatId: string,
    content: string,
    role: "user" | "assistant"
  ): Promise<void> {
    if (content.length < 20) return; // Skip very short messages
    
    const embedding = simpleEmbed(content);
    
    await db.execute(sql`
      INSERT INTO rag_documents (user_id, chat_id, content, content_type, embedding, metadata)
      VALUES (${userId}, ${chatId}, ${content.substring(0, 2000)}, ${role}, 
              ${JSON.stringify(embedding)}, ${JSON.stringify({ role, timestamp: Date.now() })})
    `);
  }

  /**
   * Search for relevant context
   */
  async search(
    userId: string,
    query: string,
    options: {
      limit?: number;
      chatId?: string;
      minScore?: number;
    } = {}
  ): Promise<Array<{ content: string; score: number; chatId: string }>> {
    const { limit = 5, chatId, minScore = 0.3 } = options;
    
    const queryEmbedding = simpleEmbed(query);
    
    let whereClause = sql`user_id = ${userId}`;
    if (chatId) {
      whereClause = sql`user_id = ${userId} AND chat_id != ${chatId}`;
    }
    
    const result = await db.execute(sql`
      SELECT content, chat_id, embedding FROM rag_documents
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT 100
    `);
    
    // Calculate similarity scores
    const scored = (result.rows || [])
      .map((row: any) => {
        const docEmbedding = typeof row.embedding === 'string' 
          ? JSON.parse(row.embedding) 
          : row.embedding;
        const score = cosineSimilarity(queryEmbedding, docEmbedding || []);
        return {
          content: row.content,
          chatId: row.chat_id,
          score
        };
      })
      .filter(r => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    
    return scored;
  }

  /**
   * Get context for a new message
   */
  async getContextForMessage(
    userId: string,
    message: string,
    currentChatId?: string
  ): Promise<string> {
    const results = await this.search(userId, message, {
      limit: 3,
      chatId: currentChatId,
      minScore: 0.4
    });
    
    if (results.length === 0) return "";
    
    const context = results
      .map((r, i) => `[Contexto ${i + 1}]: ${r.content.substring(0, 300)}...`)
      .join("\n");
    
    return `\n\n[Contexto de conversaciones anteriores]\n${context}\n`;
  }
}

export class UserPersonalizationService {
  /**
   * Get or create user preferences
   */
  async getPreferences(userId: string): Promise<Record<string, any>> {
    const result = await db.execute(sql`
      SELECT * FROM user_preferences WHERE user_id = ${userId}
    `);
    
    if (result.rows?.length) {
      return result.rows[0] as Record<string, any>;
    }
    
    // Create default preferences
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

  /**
   * Update user preferences
   */
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

  /**
   * Learn from conversation
   */
  async learnFromConversation(
    userId: string,
    messages: Array<{ role: string; content: string }>
  ): Promise<void> {
    const userMessages = messages.filter(m => m.role === 'user').map(m => m.content);
    const allText = userMessages.join(' ').toLowerCase();
    
    // Detect language preference
    const spanishWords = (allText.match(/\b(el|la|los|las|de|que|y|en|un|una|es|por|para)\b/g) || []).length;
    const englishWords = (allText.match(/\b(the|a|an|is|are|to|of|and|in|for|with)\b/g) || []).length;
    
    const detectedLanguage = spanishWords > englishWords ? 'es' : 'en';
    
    // Detect topics of interest
    const topics: string[] = [];
    const topicPatterns = {
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
    
    // Detect communication style
    const style: Record<string, any> = {};
    
    // Formality
    const formalIndicators = (allText.match(/\b(usted|por favor|gracias|estimado|cordialmente)\b/g) || []).length;
    const informalIndicators = (allText.match(/\b(tu|oye|mira|genial|cool|jaja)\b/g) || []).length;
    style.formality = formalIndicators > informalIndicators ? 'formal' : 'casual';
    
    // Detail preference
    const avgLength = userMessages.reduce((sum, m) => sum + m.length, 0) / (userMessages.length || 1);
    style.detailLevel = avgLength > 100 ? 'detailed' : 'concise';
    
    await this.updatePreferences(userId, {
      language: detectedLanguage,
      topicsOfInterest: topics,
      communicationStyle: style
    });
  }

  /**
   * Get personalization context for system prompt
   */
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
  /**
   * Index a file in the workspace
   */
  async indexFile(
    userId: string,
    filePath: string,
    content: string,
    fileType: string
  ): Promise<void> {
    // Create summary (first 500 chars + key points)
    const summary = content.substring(0, 500);
    const embedding = simpleEmbed(content);
    
    await db.execute(sql`
      INSERT INTO workspace_context (user_id, file_path, file_type, content_summary, embedding)
      VALUES (${userId}, ${filePath}, ${fileType}, ${summary}, ${JSON.stringify(embedding)})
      ON CONFLICT DO NOTHING
    `);
  }

  /**
   * Get relevant files for a query
   */
  async getRelevantFiles(
    userId: string,
    query: string,
    limit = 3
  ): Promise<Array<{ filePath: string; summary: string; score: number }>> {
    const queryEmbedding = simpleEmbed(query);
    
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

  /**
   * Get workspace context for a message
   */
  async getWorkspaceContext(userId: string, message: string): Promise<string> {
    const files = await this.getRelevantFiles(userId, message, 2);
    
    if (files.length === 0) return '';
    
    const context = files
      .map(f => `[${f.filePath}]: ${f.summary.substring(0, 200)}...`)
      .join('\n');
    
    return `\n\n[Archivos relacionados del workspace]\n${context}\n`;
  }
}

// Export instances
export const ragService = new RAGService();
export const personalizationService = new UserPersonalizationService();
export const workspaceContextService = new WorkspaceContextService();

/**
 * Combined context builder
 */
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
