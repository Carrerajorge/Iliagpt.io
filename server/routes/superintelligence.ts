import { Router } from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { aiService } from '../lib/ai/modelOrchestrator';
import { researcher as scientificDiscovery, hypothesis } from '../lib/ai/scientificDiscovery';
// Note: importing instances directly
import { autoCoder } from '../lib/ai/autonomousCoding';
import { Logger } from '../lib/logger';

// Create a router instance
const router = Router();

// ============================================================================
// Model Orchestration Endpoints
// ============================================================================

router.post('/chat', async (req, res) => {
    try {
        const { messages, requirements, taskId } = req.body;

        // Local shortcut: create folder on Mac Desktop from natural language.
        const latestUser = Array.isArray(messages)
          ? [...messages].reverse().find((m: any) => m?.role === 'user')
          : null;
        const userTextRaw = typeof latestUser?.content === 'string'
          ? latestUser.content
          : Array.isArray(latestUser?.content)
            ? latestUser.content.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join(' ')
            : String(latestUser?.content || '');

        const match = String(userTextRaw || '').match(/(?:crea|crear|creame|haz|genera)\s+(?:una\s+)?carpeta(?:\s+en\s+mi\s+escritorio)?(?:\s+(?:llamada|con\s+nombre))?\s+["']?([^"'\n]{1,120})["']?/i);
        if (match?.[1]) {
          const folderName = match[1].trim().replace(/[.,;:!?]+$/g, '').trim();
          const invalid = /[\\/:*?"<>|]/.test(folderName) || folderName.includes('..');
          if (invalid || !folderName) {
            return res.status(400).json({ error: 'Nombre de carpeta inválido' });
          }
          const folderPath = path.join(os.homedir(), 'Desktop', folderName);
          await fs.mkdir(folderPath, { recursive: true });
          await fs.appendFile(
            path.join(os.homedir(), '.iliagpt-control-audit.log'),
            `${new Date().toISOString()} superintelligence_chat mkdir path=${folderPath}\n`,
            'utf-8'
          );
          return res.json({
            content: `Listo. Carpeta creada en tu escritorio: ${folderPath}`,
            provider: 'local-system',
            model: 'local-system',
          });
        }

        // Default requirements if not provided
        const reqs = requirements || { tier: 'pro' };

        const response = await aiService.generateCompletion({
            taskId: taskId || 'api-request',
            messages,
            requirements: reqs
        });

        res.json(response);
    } catch (error: any) {
        Logger.error(`[API] AI Chat Error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// Scientific Discovery Endpoints
// ============================================================================

router.post('/research/synthesize', async (req, res) => {
    try {
        const { topic } = req.body;
        // Dynamic import to avoid circular dependency issues if any
        const { researcher } = await import('../lib/ai/scientificDiscovery');

        const synthesis = await researcher.synthesizeLiterature(topic);
        res.json({ topic, synthesis });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/research/hypothesis', async (req, res) => {
    try {
        const { observation, context } = req.body;
        const { hypothesis } = await import('../lib/ai/scientificDiscovery');

        const hypotheses = await hypothesis.generateHypotheses(observation, context);
        res.json({ hypotheses });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// Autonomous Coding Endpoints
// ============================================================================

router.post('/coding/generate', async (req, res) => {
    try {
        const { prompt, language } = req.body;
        const { autoCoder } = await import('../lib/ai/autonomousCoding');

        // Assuming autoCoder has a generate method compatible with this
        const result = await autoCoder.generateCode({
            id: 'code-gen-' + Date.now(),
            description: prompt,
            files: [], // determined by agent or empty
            context: 'Language: ' + language,
            requirements: []
        });
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export const superintelligenceRouter = router;
