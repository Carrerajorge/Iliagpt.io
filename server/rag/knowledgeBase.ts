/**
 * Knowledge Base — User-facing collections for RAG.
 *
 * Users create collections, upload documents, documents are automatically
 * processed (text extraction → chunking → embedding → vector store).
 * Collections can be attached to chats for contextual retrieval.
 */

import { db } from "../db";
import { knowledgeNodes } from "@shared/schema/knowledge";
import { ragChunks } from "@shared/schema/rag";
import { eq, and, sql, desc, count } from "drizzle-orm";
import { extractDocument, chunkDocument, type DocumentInput, type ChunkOptions } from "./documentProcessor";
import { insertDocuments, deleteByCollection, type VectorDocument } from "./vectorStore";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Collection {
  id: string;
  userId: string;
  name: string;
  description: string;
  documentCount: number;
  chunkCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CollectionDocument {
  id: string;
  collectionId: string;
  filename: string;
  mimeType: string;
  wordCount: number;
  pageCount?: number;
  chunkCount: number;
  status: "processing" | "ready" | "error";
  error?: string;
  createdAt: Date;
}

export interface CreateCollectionInput {
  userId: string;
  name: string;
  description?: string;
}

export interface AddDocumentInput {
  collectionId: string;
  userId: string;
  file: DocumentInput;
  chunkOptions?: ChunkOptions;
}

export interface AddDocumentResult {
  documentId: string;
  filename: string;
  chunkCount: number;
  wordCount: number;
  processingTimeMs: number;
}

// ---------------------------------------------------------------------------
// Collection CRUD
// ---------------------------------------------------------------------------

export async function createCollection(input: CreateCollectionInput): Promise<Collection> {
  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(knowledgeNodes).values({
    id,
    userId: input.userId,
    type: "collection",
    title: input.name,
    content: input.description || "",
    metadata: { description: input.description || "", documentCount: 0, chunkCount: 0 },
    createdAt: now,
    updatedAt: now,
  } as any);

  return {
    id,
    userId: input.userId,
    name: input.name,
    description: input.description || "",
    documentCount: 0,
    chunkCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export async function listCollections(userId: string): Promise<Collection[]> {
  const rows = await db
    .select()
    .from(knowledgeNodes)
    .where(and(
      eq(knowledgeNodes.userId, userId),
      eq(knowledgeNodes.type, "collection"),
    ))
    .orderBy(desc(knowledgeNodes.updatedAt));

  return rows.map(r => {
    const meta = (r.metadata as any) || {};
    return {
      id: r.id,
      userId: r.userId,
      name: r.title || "",
      description: meta.description || r.content || "",
      documentCount: meta.documentCount || 0,
      chunkCount: meta.chunkCount || 0,
      createdAt: r.createdAt ? new Date(r.createdAt) : new Date(),
      updatedAt: r.updatedAt ? new Date(r.updatedAt) : new Date(),
    };
  });
}

export async function getCollection(userId: string, collectionId: string): Promise<Collection | null> {
  const [row] = await db
    .select()
    .from(knowledgeNodes)
    .where(and(
      eq(knowledgeNodes.id, collectionId),
      eq(knowledgeNodes.userId, userId),
      eq(knowledgeNodes.type, "collection"),
    ))
    .limit(1);

  if (!row) return null;
  const meta = (row.metadata as any) || {};
  return {
    id: row.id,
    userId: row.userId,
    name: row.title || "",
    description: meta.description || row.content || "",
    documentCount: meta.documentCount || 0,
    chunkCount: meta.chunkCount || 0,
    createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt) : new Date(),
  };
}

export async function deleteCollection(userId: string, collectionId: string): Promise<boolean> {
  // Delete all chunks in this collection
  await deleteByCollection(userId, collectionId);

  // Delete collection node and its document nodes
  await db
    .delete(knowledgeNodes)
    .where(and(
      eq(knowledgeNodes.userId, userId),
      sql`${knowledgeNodes.id} = ${collectionId} OR (${knowledgeNodes.metadata}->>'collectionId')::text = ${collectionId}`,
    ));

  return true;
}

// ---------------------------------------------------------------------------
// Document ingestion
// ---------------------------------------------------------------------------

/**
 * Add a document to a collection. Extracts text, chunks it, generates
 * embeddings, and stores in the vector store.
 */
export async function addDocument(input: AddDocumentInput): Promise<AddDocumentResult> {
  const startTime = Date.now();

  // 1. Extract text from document
  const extracted = await extractDocument(input.file);

  // 2. Chunk the extracted text
  const chunks = chunkDocument(extracted, input.chunkOptions);

  // 3. Create document node in knowledge graph
  const docId = crypto.randomUUID();
  await db.insert(knowledgeNodes).values({
    id: docId,
    userId: input.userId,
    type: "document",
    title: input.file.filename,
    content: extracted.content.slice(0, 1000), // Store preview
    metadata: {
      collectionId: input.collectionId,
      filename: input.file.filename,
      mimeType: input.file.mimeType,
      wordCount: extracted.metadata.wordCount,
      pageCount: extracted.metadata.pageCount,
      chunkCount: chunks.length,
      status: "ready",
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any);

  // 4. Insert chunks into vector store
  if (chunks.length > 0) {
    const vectorDocs: VectorDocument[] = chunks.map(chunk => ({
      content: chunk.content,
      metadata: {
        ...chunk.metadata,
        collectionId: input.collectionId,
        documentId: docId,
        source: "document",
      },
      userId: input.userId,
      tags: [input.collectionId, input.file.filename],
    }));

    await insertDocuments(vectorDocs);
  }

  // 5. Update collection metadata
  const [chunkCountResult] = await db
    .select({ count: count() })
    .from(ragChunks)
    .where(and(
      eq(ragChunks.userId, input.userId),
      eq(ragChunks.sourceId, input.collectionId),
    ));

  const docCountResult = await db
    .select({ count: count() })
    .from(knowledgeNodes)
    .where(and(
      eq(knowledgeNodes.userId, input.userId),
      eq(knowledgeNodes.type, "document"),
      sql`(${knowledgeNodes.metadata}->>'collectionId')::text = ${input.collectionId}`,
    ));

  await db
    .update(knowledgeNodes)
    .set({
      metadata: sql`jsonb_set(jsonb_set(${knowledgeNodes.metadata}::jsonb, '{chunkCount}', ${String(chunkCountResult?.count || 0)}::jsonb), '{documentCount}', ${String(docCountResult[0]?.count || 0)}::jsonb)`,
      updatedAt: new Date(),
    } as any)
    .where(eq(knowledgeNodes.id, input.collectionId));

  return {
    documentId: docId,
    filename: input.file.filename,
    chunkCount: chunks.length,
    wordCount: extracted.metadata.wordCount,
    processingTimeMs: Date.now() - startTime,
  };
}

/**
 * List documents in a collection.
 */
export async function listDocuments(userId: string, collectionId: string): Promise<CollectionDocument[]> {
  const rows = await db
    .select()
    .from(knowledgeNodes)
    .where(and(
      eq(knowledgeNodes.userId, userId),
      eq(knowledgeNodes.type, "document"),
      sql`(${knowledgeNodes.metadata}->>'collectionId')::text = ${collectionId}`,
    ))
    .orderBy(desc(knowledgeNodes.createdAt));

  return rows.map(r => {
    const meta = (r.metadata as any) || {};
    return {
      id: r.id,
      collectionId: meta.collectionId,
      filename: meta.filename || r.title || "",
      mimeType: meta.mimeType || "application/octet-stream",
      wordCount: meta.wordCount || 0,
      pageCount: meta.pageCount,
      chunkCount: meta.chunkCount || 0,
      status: meta.status || "ready",
      error: meta.error,
      createdAt: r.createdAt ? new Date(r.createdAt) : new Date(),
    };
  });
}

/**
 * Remove a document from a collection (and its chunks from vector store).
 */
export async function removeDocument(userId: string, documentId: string): Promise<boolean> {
  const [doc] = await db
    .select()
    .from(knowledgeNodes)
    .where(and(eq(knowledgeNodes.id, documentId), eq(knowledgeNodes.userId, userId)))
    .limit(1);

  if (!doc) return false;

  const meta = (doc.metadata as any) || {};

  // Delete chunks for this document
  await db
    .delete(ragChunks)
    .where(and(
      eq(ragChunks.userId, userId),
      sql`(${ragChunks.metadata}->>'documentId')::text = ${documentId}`,
    ));

  // Delete document node
  await db.delete(knowledgeNodes).where(eq(knowledgeNodes.id, documentId));

  return true;
}
