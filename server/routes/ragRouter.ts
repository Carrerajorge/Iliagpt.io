import { Router, Request, Response } from 'express';
import multer from 'multer';
import { ragPipeline } from '../services/ragPipeline';
import { visualRetrieval } from '../services/visualRetrieval';
import { advancedRAG } from '../services/advancedRAG';
import { ragFeedback } from '../services/ragFeedback';
import { db } from '../db';
import { files, fileChunks } from '@shared/schema';
import { eq, inArray } from 'drizzle-orm';
import { streamChat } from '../services/chatService';

const router = Router();
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

router.post('/index', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const { fileId } = req.body;
    if (!fileId) {
      return res.status(400).json({ error: 'fileId is required' });
    }

    const result = await ragPipeline.indexDocument(
      fileId,
      req.file.buffer,
      req.file.mimetype,
      req.file.originalname
    );

    res.json({
      success: true,
      fileId,
      fileName: req.file.originalname,
      ...result
    });
  } catch (error) {
    console.error('[RAG Router] Index error:', error);
    res.status(500).json({ 
      error: 'Failed to index document',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.post('/query', async (req: Request, res: Response) => {
  try {
    const { query, fileIds, topK = 5, language = 'es' } = req.body;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Query is required' });
    }

    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ error: 'fileIds array is required' });
    }

    const result = await ragPipeline.answerWithRAG(query, fileIds, {
      topK,
      language
    });

    res.json({
      success: true,
      query,
      context: {
        chunksRetrieved: result.context.chunks.length,
        totalChunks: result.context.totalChunks,
        processingTimeMs: result.context.processingTimeMs
      },
      chunks: result.context.chunks,
      citations: result.citations,
      tables: result.tables,
      prompt: result.prompt
    });
  } catch (error) {
    console.error('[RAG Router] Query error:', error);
    res.status(500).json({ 
      error: 'Failed to query documents',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.post('/answer', async (req: Request, res: Response) => {
  try {
    const { query, fileIds, topK = 5, language = 'es', stream = false } = req.body;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Query is required' });
    }

    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ error: 'fileIds array is required' });
    }

    const ragResult = await ragPipeline.answerWithRAG(query, fileIds, {
      topK,
      language
    });

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      res.write(`data: ${JSON.stringify({ 
        type: 'context',
        citations: ragResult.citations,
        tables: ragResult.tables,
        chunksRetrieved: ragResult.context.chunks.length
      })}\n\n`);

      try {
        const { GoogleGenAI } = await import('@google/genai');
        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
        
        if (!apiKey) {
          res.write(`data: ${JSON.stringify({ 
            type: 'error', 
            error: 'No API key configured' 
          })}\n\n`);
          res.end();
          return;
        }

        const genAI = new GoogleGenAI({ apiKey });
        const result = await genAI.models.generateContentStream({
          model: 'gemini-2.0-flash',
          contents: ragResult.prompt
        });

        for await (const chunk of result) {
          const text = chunk.text;
          if (text) {
            res.write(`data: ${JSON.stringify({ type: 'chunk', content: text })}\n\n`);
          }
        }

        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        res.end();
      } catch (streamError) {
        console.error('[RAG Router] Stream error:', streamError);
        res.write(`data: ${JSON.stringify({ 
          type: 'error', 
          error: streamError instanceof Error ? streamError.message : 'Stream error' 
        })}\n\n`);
        res.end();
      }
    } else {
      try {
        const { GoogleGenAI } = await import('@google/genai');
        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
        
        if (!apiKey) {
          return res.status(500).json({ error: 'No API key configured' });
        }

        const genAI = new GoogleGenAI({ apiKey });
        const result = await genAI.models.generateContent({
          model: 'gemini-2.0-flash',
          contents: ragResult.prompt
        });

        const answer = result.text || '';

        res.json({
          success: true,
          query,
          answer,
          citations: ragResult.citations,
          tables: ragResult.tables,
          context: {
            chunksRetrieved: ragResult.context.chunks.length,
            totalChunks: ragResult.context.totalChunks,
            processingTimeMs: ragResult.context.processingTimeMs
          }
        });
      } catch (llmError) {
        console.error('[RAG Router] LLM error:', llmError);
        res.status(500).json({ 
          error: 'Failed to generate answer',
          details: llmError instanceof Error ? llmError.message : 'Unknown error'
        });
      }
    }
  } catch (error) {
    console.error('[RAG Router] Answer error:', error);
    res.status(500).json({ 
      error: 'Failed to answer query',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.get('/chunks/:fileId', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const pageNum = parseInt(page as string) || 1;
    const limitNum = parseInt(limit as string) || 20;
    const offset = (pageNum - 1) * limitNum;

    const chunks = await db
      .select()
      .from(fileChunks)
      .where(eq(fileChunks.fileId, fileId))
      .orderBy(fileChunks.chunkIndex)
      .limit(limitNum)
      .offset(offset);

    const totalResult = await db
      .select({ count: fileChunks.id })
      .from(fileChunks)
      .where(eq(fileChunks.fileId, fileId));

    res.json({
      success: true,
      fileId,
      chunks: chunks.map(c => ({
        id: c.id,
        content: c.content,
        chunkIndex: c.chunkIndex,
        pageNumber: c.pageNumber,
        metadata: c.metadata,
        hasEmbedding: !!c.embedding
      })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalResult.length,
        hasMore: offset + chunks.length < totalResult.length
      }
    });
  } catch (error) {
    console.error('[RAG Router] Get chunks error:', error);
    res.status(500).json({ 
      error: 'Failed to get chunks',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.delete('/chunks/:fileId', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;

    await db.delete(fileChunks).where(eq(fileChunks.fileId, fileId));

    res.json({
      success: true,
      message: `Deleted all chunks for file ${fileId}`
    });
  } catch (error) {
    console.error('[RAG Router] Delete chunks error:', error);
    res.status(500).json({ 
      error: 'Failed to delete chunks',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.post('/semantic-search', async (req: Request, res: Response) => {
  try {
    const { query, fileIds, topK = 10, minScore = 0.1 } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ error: 'fileIds array is required' });
    }

    const context = await ragPipeline.hybridRetrieve(query, fileIds, {
      topK,
      minScore
    });

    res.json({
      success: true,
      query,
      results: context.chunks,
      totalChunks: context.totalChunks,
      processingTimeMs: context.processingTimeMs
    });
  } catch (error) {
    console.error('[RAG Router] Semantic search error:', error);
    res.status(500).json({ 
      error: 'Failed to perform semantic search',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.post('/analyze-image', upload.single('image'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image provided' });
    }

    const { context, query } = req.body;

    const analysis = await visualRetrieval.analyzeImageWithVision(
      req.file.buffer,
      req.file.mimetype,
      context
    );

    let chartData = null;
    if (analysis.elements.some(e => ['chart', 'graph'].includes(e.type))) {
      chartData = await visualRetrieval.extractChartData(
        req.file.buffer,
        req.file.mimetype
      );
    }

    let ragDescription = null;
    if (query) {
      ragDescription = await visualRetrieval.describeVisualForRAG(
        req.file.buffer,
        req.file.mimetype,
        query
      );
    }

    res.json({
      success: true,
      analysis,
      chartData,
      ragDescription,
      fileName: req.file.originalname
    });
  } catch (error) {
    console.error('[RAG Router] Analyze image error:', error);
    res.status(500).json({ 
      error: 'Failed to analyze image',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.post('/reindex-all', async (req: Request, res: Response) => {
  try {
    const { fileIds } = req.body;

    if (!fileIds || !Array.isArray(fileIds)) {
      return res.status(400).json({ error: 'fileIds array is required' });
    }

    const results: Array<{ fileId: string; success: boolean; error?: string }> = [];

    for (const fileId of fileIds) {
      try {
        const file = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
        if (file.length === 0) {
          results.push({ fileId, success: false, error: 'File not found' });
          continue;
        }

        results.push({ fileId, success: true });
      } catch (err) {
        results.push({ 
          fileId, 
          success: false, 
          error: err instanceof Error ? err.message : 'Unknown error' 
        });
      }
    }

    res.json({
      success: true,
      results
    });
  } catch (error) {
    console.error('[RAG Router] Reindex error:', error);
    res.status(500).json({ 
      error: 'Failed to reindex files',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.post('/advanced/query', async (req: Request, res: Response) => {
  try {
    const { 
      query, 
      fileIds, 
      topK = 5, 
      language = 'es',
      useMultiHop = false,
      useCompression = true,
      useCache = true
    } = req.body;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Query is required' });
    }

    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ error: 'fileIds array is required' });
    }

    const startTime = Date.now();
    
    const result = await advancedRAG.fullRAGPipeline(query, fileIds, {
      topK,
      language,
      useMultiHop,
      useCompression,
      useCache
    });

    res.json({
      success: true,
      query,
      answer: result.answer,
      confidence: result.confidence,
      citations: result.citations,
      suggestedFollowups: result.suggestedFollowups,
      tables: result.tables,
      reasoning: result.reasoning,
      chunksRetrieved: result.chunks.length,
      processingTimeMs: Date.now() - startTime
    });
  } catch (error) {
    console.error('[RAG Router] Advanced query error:', error);
    res.status(500).json({ 
      error: 'Failed to process advanced query',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.post('/advanced/answer-stream', async (req: Request, res: Response) => {
  try {
    const { 
      query, 
      fileIds, 
      topK = 5, 
      language = 'es',
      useMultiHop = false,
      sessionId
    } = req.body;

    if (!query || !fileIds || fileIds.length === 0) {
      return res.status(400).json({ error: 'Query and fileIds are required' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const expansion = await advancedRAG.expandQuery(query);
    res.write(`data: ${JSON.stringify({ type: 'expansion', data: { 
      subQueries: expansion.subQueries.length,
      keywords: expansion.keywords.slice(0, 5)
    }})}\n\n`);

    let chunks;
    let reasoning: string[] = [];
    
    if (useMultiHop) {
      const multiHopResult = await advancedRAG.multiHopRetrieval(query, fileIds);
      chunks = multiHopResult.chunks;
      reasoning = multiHopResult.reasoning;
      res.write(`data: ${JSON.stringify({ type: 'reasoning', data: reasoning })}\n\n`);
    } else {
      chunks = await advancedRAG.hybridRetrieveAdvanced(query, fileIds, expansion, { topK: topK * 2 });
    }

    chunks = await advancedRAG.crossEncoderRerank(query, chunks, topK);
    
    res.write(`data: ${JSON.stringify({ 
      type: 'context', 
      data: { 
        chunksRetrieved: chunks.length,
        citations: chunks.map(c => ({
          pageNumber: c.pageNumber,
          sectionTitle: c.sectionTitle,
          score: c.score
        }))
      }
    })}\n\n`);

    if (sessionId) {
      ragFeedback.recordImplicitSignals(
        query,
        chunks.map((c, i) => ({ id: c.id, position: i })),
        null,
        sessionId
      );
    }

    const { answer, citations, suggestedFollowups, confidence } = 
      await advancedRAG.generateAnswerWithCitations(query, chunks, { language });

    const words = answer.split(/\s+/);
    for (let i = 0; i < words.length; i += 5) {
      const chunk = words.slice(i, i + 5).join(' ') + ' ';
      res.write(`data: ${JSON.stringify({ type: 'token', data: chunk })}\n\n`);
      await new Promise(r => setTimeout(r, 20));
    }

    res.write(`data: ${JSON.stringify({ 
      type: 'complete', 
      data: {
        citations,
        suggestedFollowups,
        confidence,
        chunkIds: chunks.map(c => c.id)
      }
    })}\n\n`);

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('[RAG Router] Advanced stream error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', data: error instanceof Error ? error.message : 'Unknown error' })}\n\n`);
    res.end();
  }
});

router.post('/advanced/expand-query', async (req: Request, res: Response) => {
  try {
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    const expansion = await advancedRAG.expandQuery(query);

    res.json({
      success: true,
      original: query,
      hypotheticalDocument: expansion.hypothetical.slice(0, 500),
      subQueries: expansion.subQueries,
      keywords: expansion.keywords,
      extractedFilters: expansion.filters
    });
  } catch (error) {
    console.error('[RAG Router] Expand query error:', error);
    res.status(500).json({ 
      error: 'Failed to expand query',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.post('/advanced/multi-hop', async (req: Request, res: Response) => {
  try {
    const { query, fileIds, maxHops = 3 } = req.body;

    if (!query || !fileIds || fileIds.length === 0) {
      return res.status(400).json({ error: 'Query and fileIds are required' });
    }

    const result = await advancedRAG.multiHopRetrieval(query, fileIds, maxHops);

    res.json({
      success: true,
      query,
      reasoning: result.reasoning,
      chunksRetrieved: result.chunks.length,
      chunks: result.chunks.map(c => ({
        id: c.id,
        content: c.content.slice(0, 300),
        pageNumber: c.pageNumber,
        score: c.score,
        vectorScore: c.vectorScore,
        bm25Score: c.bm25Score
      }))
    });
  } catch (error) {
    console.error('[RAG Router] Multi-hop error:', error);
    res.status(500).json({ 
      error: 'Failed to perform multi-hop retrieval',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.post('/feedback/signal', async (req: Request, res: Response) => {
  try {
    const { query, chunkId, signal, sessionId, metadata } = req.body;

    if (!query || !chunkId || !signal || !sessionId) {
      return res.status(400).json({ 
        error: 'query, chunkId, signal, and sessionId are required' 
      });
    }

    const validSignals = ['click', 'dwell', 'copy', 'cite', 'thumbsUp', 'thumbsDown'];
    if (!validSignals.includes(signal)) {
      return res.status(400).json({ 
        error: `Invalid signal. Must be one of: ${validSignals.join(', ')}` 
      });
    }

    ragFeedback.recordFeedback(query, chunkId, signal, sessionId, metadata);

    res.json({ success: true, message: 'Feedback recorded' });
  } catch (error) {
    console.error('[RAG Router] Feedback signal error:', error);
    res.status(500).json({ 
      error: 'Failed to record feedback',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.post('/feedback/answer', async (req: Request, res: Response) => {
  try {
    const { query, chunkIds, rating, sessionId } = req.body;

    if (!query || !chunkIds || !rating || !sessionId) {
      return res.status(400).json({ 
        error: 'query, chunkIds, rating, and sessionId are required' 
      });
    }

    if (!['thumbsUp', 'thumbsDown'].includes(rating)) {
      return res.status(400).json({ 
        error: 'rating must be thumbsUp or thumbsDown' 
      });
    }

    ragFeedback.recordAnswerFeedback(query, chunkIds, rating, sessionId);

    res.json({ success: true, message: 'Answer feedback recorded' });
  } catch (error) {
    console.error('[RAG Router] Answer feedback error:', error);
    res.status(500).json({ 
      error: 'Failed to record answer feedback',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.get('/feedback/stats', async (req: Request, res: Response) => {
  try {
    const stats = ragFeedback.getFeedbackStats();
    res.json({ success: true, ...stats });
  } catch (error) {
    console.error('[RAG Router] Feedback stats error:', error);
    res.status(500).json({ 
      error: 'Failed to get feedback stats',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.post('/advanced/index', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const { fileId } = req.body;
    if (!fileId) {
      return res.status(400).json({ error: 'fileId is required' });
    }

    const basicResult = await ragPipeline.indexDocument(
      fileId,
      req.file.buffer,
      req.file.mimetype,
      req.file.originalname
    );

    const existingChunks = await db
      .select()
      .from(fileChunks)
      .where(eq(fileChunks.fileId, fileId));

    let embeddingsGenerated = 0;
    for (const chunk of existingChunks) {
      if (!chunk.embedding) {
        try {
          const embedding = await ragPipeline.generateEmbeddingGemini(chunk.content);
          if (embedding && embedding.length > 0) {
            await db
              .update(fileChunks)
              .set({ embedding })
              .where(eq(fileChunks.id, chunk.id));
            embeddingsGenerated++;
          }
        } catch (err) {
          console.error(`[RAG Router] Failed to generate embedding for chunk ${chunk.id}:`, err);
        }
      }
    }

    res.json({
      success: true,
      fileId,
      fileName: req.file.originalname,
      chunksCreated: basicResult.chunksCreated,
      embeddingsGenerated,
      processingTimeMs: basicResult.processingTimeMs
    });
  } catch (error) {
    console.error('[RAG Router] Advanced index error:', error);
    res.status(500).json({ 
      error: 'Failed to index document with advanced chunking',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.post('/llamaindex/query', async (req: Request, res: Response) => {
  try {
    const { query, documents, config } = req.body;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Query string is required' });
    }

    const llamaIndex = await import('../lib/integrations/llamaIndexRAG');

    if (!llamaIndex.isAvailable()) {
      return res.status(503).json({ error: 'LlamaIndex not available (missing OPENAI_API_KEY)' });
    }

    let docs: Array<{ text: string; metadata?: Record<string, unknown> }> = [];

    if (documents && Array.isArray(documents) && documents.length > 0) {
      docs = documents.map((d: any) => ({
        text: typeof d === 'string' ? d : d.text || d.content || JSON.stringify(d),
        metadata: typeof d === 'object' && d !== null ? (d.metadata || {}) : {},
      }));
    } else {
      const { fileIds } = req.body;
      if (fileIds && Array.isArray(fileIds) && fileIds.length > 0) {
        const chunks = await db
          .select({ content: fileChunks.content })
          .from(fileChunks)
          .where(inArray(fileChunks.fileId, fileIds));
        docs = chunks.map(c => ({ text: c.content }));
      }
    }

    if (docs.length === 0) {
      return res.status(400).json({ error: 'No documents provided. Send `documents` array or `fileIds`.' });
    }

    const result = await llamaIndex.ragQuery(docs, query, config);

    res.json({
      success: true,
      engine: 'llamaindex',
      response: result.response,
      sourceNodes: result.sourceNodes,
    });
  } catch (error) {
    console.error('[RAG Router] LlamaIndex query error:', error);
    res.status(500).json({
      error: 'LlamaIndex query failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
