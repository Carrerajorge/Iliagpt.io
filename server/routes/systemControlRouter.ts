import { Router } from 'express';
import { z } from 'zod';
import { SystemControl } from '../services/systemControl';
import { actionTriggerDaemon } from '../services/actionTriggerDaemon';

export const systemControlRouter = Router();

// Schema Validators
const mousePositionSchema = z.object({
    x: z.number().int().min(0),
    y: z.number().int().min(0)
});

const textInputSchema = z.object({
    text: z.string().min(1)
});

const keyPressSchema = z.object({
    key: z.enum(['enter', 'escape', 'tab', 'space']) // Expanding as needed
});

const appSchema = z.object({
    appName: z.string().min(1)
});

const volumeSchema = z.object({
    level: z.number().int().min(0).max(100)
});

// Routes
systemControlRouter.post('/mouse/move', async (req, res) => {
    try {
        const { x, y } = mousePositionSchema.parse(req.body);
        await SystemControl.moveMouse(x, y);
        res.json({ success: true, message: `Mouse moved to ${x},${y}` });
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

systemControlRouter.post('/mouse/click', async (req, res) => {
    try {
        const button = req.body.button || 'left';
        await SystemControl.clickMouse(button);
        res.json({ success: true, message: `Mouse clicked ${button}` });
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

systemControlRouter.post('/keyboard/type', async (req, res) => {
    try {
        const { text } = textInputSchema.parse(req.body);
        await SystemControl.typeText(text);
        res.json({ success: true, message: `Text typed successfully` });
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

systemControlRouter.post('/keyboard/press', async (req, res) => {
    try {
        const { key } = keyPressSchema.parse(req.body);
        await SystemControl.pressKey(key);
        res.json({ success: true, message: `Key ${key} pressed` });
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

systemControlRouter.post('/screen/screenshot', async (req, res) => {
    try {
        const b64Image = await SystemControl.takeScreenshot();
        res.json({ success: true, data: b64Image });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

systemControlRouter.post('/app/open', async (req, res) => {
    try {
        const { appName } = appSchema.parse(req.body);
        await SystemControl.openApplication(appName);
        res.json({ success: true, message: `Application ${appName} launched` });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Webhook relay testing
systemControlRouter.post('/webhook/:hookId', (req, res) => {
    const { hookId } = req.params;
    actionTriggerDaemon.handleWebhook(hookId, req.body);
    res.json({ success: true, message: `Webhook ${hookId} accepted for processing` });
});
