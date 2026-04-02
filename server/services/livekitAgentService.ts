import { Room, RoomEvent, RemoteParticipant, RemoteTrackPublication, RemoteTrack, Track } from '@livekit/rtc-node';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';

// Minimal implementation of a LiveKit Agent service using @livekit/rtc-node
// In a full implementation, this would connect to the LLM Gateway.
export class LivekitAgentService extends EventEmitter {
    private room: Room | null = null;
    private isConnected: boolean = false;

    constructor() {
        super();
    }

    async joinRoom(url: string, token: string) {
        if (this.isConnected) {
            logger.warn({ ctx: 'LivekitAgent' }, 'Agent already connected to a room');
            return;
        }

        this.room = new Room();

        this.room.on(RoomEvent.Connected, () => {
            logger.info({ ctx: 'LivekitAgent' }, 'Agent successfully joined the LiveKit room');
            this.isConnected = true;
            this.emit('connected');
        });

        this.room.on(RoomEvent.Disconnected, () => {
            logger.info({ ctx: 'LivekitAgent' }, 'Agent disconnected from the LiveKit room');
            this.isConnected = false;
            this.room = null;
            this.emit('disconnected');
        });

        this.room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
            logger.info({ ctx: 'LivekitAgent', participantIdentity: participant.identity }, 'Participant connected');

            // Send a welcome message or trigger VAD sequence
            // For now, we just log it.
        });

        this.room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
            if (track.kind === Track.Kind.Audio) {
                logger.info({ ctx: 'LivekitAgent', participantIdentity: participant.identity }, 'Audio track subscribed. Setting up VAD/Stream...');

                // Here we would pipe the track's audio stream into our VAD/STT engine
                // e.g. track.audioStream().on('data', (frame) => { ... })
            }
        });

        try {
            logger.info({ ctx: 'LivekitAgent', url }, 'Attempting to join LiveKit room...');
            await this.room.connect(url, token, {
                autoSubscribe: true,
            });
        } catch (error) {
            logger.error({ ctx: 'LivekitAgent', err: error }, 'Failed to connect agent to LiveKit room');
            throw error;
        }
    }

    async disconnect() {
        if (this.room && this.isConnected) {
            await this.room.disconnect();
            this.isConnected = false;
            this.room = null;
        }
    }
}

// Export a singleton instance
export const livekitAgentService = new LivekitAgentService();
