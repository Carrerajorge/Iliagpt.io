import { Router, Request, Response } from 'express';
import { createLiveKitToken } from '../services/livekitService';

const router = Router();

// POST /api/livekit/token
// Frontend requests a token to join a room
router.post('/token', async (req: Request, res: Response) => {
    try {
        const { roomName, participantName, participantIdentity } = req.body;

        if (!roomName || !participantName || !participantIdentity) {
            return res.status(400).json({
                error: 'roomName, participantName, and participantIdentity are required'
            });
        }

        const token = await createLiveKitToken(roomName, participantName, participantIdentity);

        const serverUrl = process.env.LIVEKIT_URL || 'ws://localhost:7880';
        res.json({ token, serverUrl });

        // Spin up the agent in the background
        setImmediate(async () => {
            try {
                // Generate a token for the AI Agent
                const agentToken = await createLiveKitToken(roomName, 'ILIA Voice Assistant', 'agent-' + Date.now(), {
                    canPublish: true,
                    canSubscribe: true,
                    canPublishData: true
                });

                const { livekitAgentService } = await import('../services/livekitAgentService');
                await livekitAgentService.joinRoom(serverUrl, agentToken);
            } catch (err) {
                console.error('Failed to automatically bootstrap Livekit Agent:', err);
            }
        });
    } catch (error: unknown) {
        console.error('Error generating LiveKit token:', error instanceof Error ? error.message : error);
        res.status(500).json({ error: 'Failed to generate connection token' });
    }
});

export default router;
