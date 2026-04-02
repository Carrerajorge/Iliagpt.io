import { AccessToken } from 'livekit-server-sdk';
import { EPHEMERAL_LIVEKIT_API_KEY, EPHEMERAL_LIVEKIT_API_SECRET } from './livekitController';

/**
 * Creates a LiveKit access token for a given participant and room.
 * This token allows the frontend to connect to the LiveKit server.
 */
export async function createLiveKitToken(
    roomName: string,
    participantName: string,
    participantIdentity: string,
    permissions?: {
        canPublish?: boolean;
        canSubscribe?: boolean;
        canPublishData?: boolean;
    }
): Promise<string> {
    const apiKey = EPHEMERAL_LIVEKIT_API_KEY;
    const apiSecret = EPHEMERAL_LIVEKIT_API_SECRET;

    if (!apiKey || !apiSecret) {
        throw new Error('LiveKit internal credentials are not initialized.');
    }

    const at = new AccessToken(apiKey, apiSecret, {
        identity: participantIdentity,
        name: participantName,
        ttl: '1h', // Tokens are valid for 1 hour by default
    });

    const canPublish = permissions?.canPublish ?? true;
    const canSubscribe = permissions?.canSubscribe ?? true;
    const canPublishData = permissions?.canPublishData ?? true;

    at.addGrant({
        roomJoin: true,
        room: roomName,
        canPublish,
        canSubscribe,
        canPublishData
    });

    return await at.toJwt();
}
