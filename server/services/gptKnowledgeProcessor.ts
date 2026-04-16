/**
 * GPT Knowledge Processor
 *
 * Processes uploaded GPT knowledge files into vector chunks stored in ragChunks.
 * Reuses the document extraction pipeline from server/rag/documentProcessor.ts
 * and embedding service from server/embeddingService.ts.
 */

import crypto from "crypto";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { createLogger } from "../utils/logger";

const log = createLogger("gpt-knowledge-processor");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ChunkResult {
  text: string;
  index: number;
}

/**
 * Split text into overlapping chunks that respect sentence boundaries.
 */
function chunkText(
  text: string,
  opts: { maxChunkSize: number; overlap: number },
): ChunkResult[] {
  const chunks: ChunkResult[] = [];
  const sentences = text.split(/(?<=[.!?。])\s+/);
  let current = "";
  let idx = 0;

  for (const sentence of sentences) {
    if ((current + " " + sentence).length > opts.maxChunkSize && current.length > 0) {
      chunks.push({ text: current.trim(), index: idx++ });
      // Keep overlap by carrying trailing words from the previous chunk
      const words = current.split(/\s+/);
      const overlapWords = words.slice(-Math.floor(opts.overlap / 5));
      current = overlapWords.join(" ") + " " + sentence;
    } else {
      current = current ? current + " " + sentence : sentence;
    }
  }
  if (current.trim()) {
    chunks.push({ text: current.trim(), index: idx });
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Text extraction (delegates to documentProcessor)
// ---------------------------------------------------------------------------

async function extractTextFromFile(storageUrl: string, fileType: string): Promise<string> {
  try {
    // Read the file from storage
    const fs = await import("fs/promises");
    const path = await import("path");

    let filePath = storageUrl;
    const cwd = process.cwd();

    // Resolve storage path to local file path
    if (filePath.startsWith("/objects/uploads/")) {
      filePath = path.default.join(cwd, filePath.replace("/objects/", ""));
    } else if (filePath.startsWith("/objects/")) {
      filePath = path.default.join(cwd, filePath.replace("/objects/", ""));
    } else if (!path.default.isAbsolute(filePath)) {
      filePath = path.default.join(cwd, "uploads", filePath);
    }

    const buffer = await fs.readFile(filePath);

    // Use the document processor for extraction
    const { extractDocument } = await import("../rag/documentProcessor");
    const result = await extractDocument({
      buffer,
      filename: path.default.basename(filePath),
      mimeType: fileType,
    });

    return result.content;
  } catch (error: any) {
    log.error("Failed to extract text from file", { storageUrl, fileType, error: error.message });

    // Try GCS as fallback
    try {
      const { ObjectStorageService } = await import("../replit_integrations/object_storage/objectStorage");
      const objStore = new ObjectStorageService();
      const buffer = await objStore.getObjectEntityBuffer(storageUrl);

      const path = await import("path");
      const { extractDocument } = await import("../rag/documentProcessor");
      const result = await extractDocument({
        buffer,
        filename: path.default.basename(storageUrl),
        mimeType: fileType,
      });

      return result.content;
    } catch (gcsError: any) {
      log.error("GCS extraction also failed", { storageUrl, error: gcsError.message });
      throw new Error(`Failed to extract text: ${error.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Status updates
// ---------------------------------------------------------------------------

async function updateEmbeddingStatus(knowledgeId: string, status: string): Promise<void> {
  await db.execute(
    sql`UPDATE gpt_knowledge SET embedding_status = ${status}, updated_at = NOW() WHERE id = ${knowledgeId}`,
  );
}

// ---------------------------------------------------------------------------
// Main processor
// ---------------------------------------------------------------------------

export async function processGptKnowledge(knowledgeId: string, gptId: string): Promise<void> {
  // 1. Get the knowledge record
  const knowledgeRows = await db.execute(
    sql`SELECT * FROM gpt_knowledge WHERE id = ${knowledgeId}`,
  );
  const knowledge = (knowledgeRows as any).rows?.[0];
  if (!knowledge) {
    throw new Error(`Knowledge record not found: ${knowledgeId}`);
  }

  // 2. Update status to "processing"
  await updateEmbeddingStatus(knowledgeId, "processing");

  try {
    // 3. Extract text from file (if not already extracted)
    let text: string = knowledge.extracted_text || "";
    if (!text && knowledge.storage_url) {
      text = await extractTextFromFile(knowledge.storage_url, knowledge.file_type);
      // Save extracted text back to the knowledge record
      await db.execute(
        sql`UPDATE gpt_knowledge SET extracted_text = ${text} WHERE id = ${knowledgeId}`,
      );
    }

    if (!text || text.trim().length === 0) {
      log.warn("No text content extracted", { knowledgeId });
      await updateEmbeddingStatus(knowledgeId, "failed");
      return;
    }

    // 4. Chunk the text
    const chunks = chunkText(text, { maxChunkSize: 800, overlap: 100 });

    if (chunks.length === 0) {
      log.warn("No chunks produced", { knowledgeId });
      await updateEmbeddingStatus(knowledgeId, "failed");
      return;
    }

    // 5. Generate embeddings in batch
    const { generateEmbeddingsBatch } = await import("../embeddingService");
    const embeddings = await generateEmbeddingsBatch(chunks.map((c) => c.text));

    // 6. Determine userId — use the GPT creator or fallback to 'system'
    const gptRows = await db.execute(sql`SELECT creator_id FROM gpts WHERE id = ${gptId}`);
    const gptRecord = (gptRows as any).rows?.[0];
    const userId = gptRecord?.creator_id || "system";

    // 7. Store chunks in ragChunks table
    //    Delete any existing chunks for this knowledge item first
    await db.execute(
      sql`DELETE FROM rag_chunks WHERE source = 'gpt_knowledge' AND source_id = ${gptId} AND metadata->>'knowledgeId' = ${knowledgeId}`,
    );

    for (let i = 0; i < chunks.length; i++) {
      const chunkId = `gptk-${knowledgeId}-${i}`;
      const contentHash = crypto.createHash("sha256").update(chunks[i].text).digest("hex");
      const embeddingArray = embeddings[i];
      const metadataJson = JSON.stringify({
        knowledgeId,
        fileName: knowledge.file_name,
        chunkIndex: i,
      });

      await db.execute(sql`
        INSERT INTO rag_chunks (
          id, tenant_id, user_id, source, source_id,
          content, content_hash, embedding, chunk_index, total_chunks,
          title, metadata, is_active
        ) VALUES (
          ${chunkId},
          'default',
          ${userId},
          'gpt_knowledge',
          ${gptId},
          ${chunks[i].text},
          ${contentHash},
          ${sql.raw(`'[${embeddingArray.join(",")}]'::vector`)},
          ${i},
          ${chunks.length},
          ${knowledge.file_name || null},
          ${metadataJson}::jsonb,
          true
        )
        ON CONFLICT (id) DO UPDATE SET
          content = EXCLUDED.content,
          content_hash = EXCLUDED.content_hash,
          embedding = EXCLUDED.embedding,
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
      `);
    }

    // 8. Update knowledge record with completion status
    await db.execute(sql`
      UPDATE gpt_knowledge
      SET embedding_status = 'completed', chunk_count = ${chunks.length}, updated_at = NOW()
      WHERE id = ${knowledgeId}
    `);

    log.info("Knowledge processed successfully", {
      knowledgeId,
      gptId,
      chunks: chunks.length,
      textLength: text.length,
    });
  } catch (error: any) {
    log.error("Knowledge processing failed", {
      knowledgeId,
      gptId,
      error: error.message,
    });
    await updateEmbeddingStatus(knowledgeId, "failed");
  }
}
