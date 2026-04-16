import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import crypto from 'crypto';

let livekitProcess: ChildProcess | null = null;

// Generate ephemeral keys for this Hola run
export const EPHEMERAL_LIVEKIT_API_KEY = crypto.randomBytes(16).toString('hex');
export const EPHEMERAL_LIVEKIT_API_SECRET = crypto.randomBytes(32).toString('hex');

export async function startLivekitInternal(): Promise<void> {
    const binaryPath = path.resolve(import.meta.dirname, '../../bin/livekit-server');

    console.log('🚀 Starting internal LiveKit WebRTC Server...');

    return new Promise((resolve, reject) => {
        livekitProcess = spawn(binaryPath, [
            '--keys',
            `${EPHEMERAL_LIVEKIT_API_KEY}:${EPHEMERAL_LIVEKIT_API_SECRET}`,
            '--dev' // Starts LiveKit in development mode (auto-selects ports, disables TLS reqs)
        ], {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        if (!livekitProcess || !livekitProcess.stdout || !livekitProcess.stderr) {
            return reject(new Error('Failed to spawn LiveKit process.'));
        }

        livekitProcess.stdout.on('data', (data) => {
            const msg = data.toString().trim();
            // Optional: uncomment to see full LiveKit logs
            // console.log(`[LiveKit] ${msg}`);
            if (msg.includes('starting LiveKit server')) {
                console.log('✅ LiveKit internal server is running!');
                resolve();
            }
        });

        livekitProcess.stderr.on('data', (data) => {
            console.error(`[LiveKit Error] ${data.toString()}`);
        });

        livekitProcess.on('error', (err) => {
            console.error('❌ LiveKit process error:', err);
            reject(err);
        });

        livekitProcess.on('close', (code) => {
            console.log(`⚠️ LiveKit process exited with code ${code}`);
            livekitProcess = null;
        });

        // Fallback resolve if the startup message changes in future versions
        setTimeout(() => {
            if (livekitProcess && !livekitProcess.killed) {
                console.log('✅ Assuming LiveKit is running (timeout reached).');
                resolve();
            }
        }, 5000);
    });
}

export function stopLivekitInternal() {
    if (livekitProcess) {
        console.log('🛑 Stopping internal LiveKit server...');
        livekitProcess.kill('SIGTERM');
        livekitProcess = null;
    }
}

// Ensure LiveKit stops when Node.js exits
process.on('exit', stopLivekitInternal);
process.on('SIGINT', () => {
    stopLivekitInternal();
    process.exit(0);
});
process.on('SIGTERM', () => {
    stopLivekitInternal();
    process.exit(0);
});
