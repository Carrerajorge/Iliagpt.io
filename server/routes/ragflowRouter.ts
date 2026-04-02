import { Router, Request, Response } from 'express';
import multer from 'multer';
import { ragflowClient } from '../services/ragflowClient';

const router = Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit for RAGFlow documents
});

router.post('/dataset', async (req: Request, res: Response) => {
    try {
        if (!ragflowClient) {
            return res.status(503).json({ error: 'RAGFlow is not configured on this server.' });
        }
        const { name, description } = req.body;
        if (!name) return res.status(400).json({ error: 'Dataset name is required' });

        const result = await ragflowClient.createDataset({ name, description });
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('[RAGFlow Router] Create dataset error:', error);
        res.status(500).json({
            error: 'Failed to create RAGFlow dataset',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
    try {
        if (!ragflowClient) {
            return res.status(503).json({ error: 'RAGFlow is not configured on this server.' });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'No file provided' });
        }

        const { datasetId } = req.body;
        if (!datasetId) {
            return res.status(400).json({ error: 'datasetId is required' });
        }

        const result = await ragflowClient.uploadDocument(
            datasetId,
            req.file.buffer,
            req.file.originalname
        );

        res.json({
            success: true,
            fileName: req.file.originalname,
            ...result
        });
    } catch (error) {
        console.error('[RAGFlow Router] Upload error:', error);
        res.status(500).json({
            error: 'Failed to upload document to RAGFlow',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

export default router;
