/**
 * Notification Sound - ILIAGPT PRO 3.0
 * Web Audio API based notification sounds
 */

let audioContext: AudioContext | null = null;
let soundEnabled = true;

function getAudioContext(): AudioContext | null {
    if (!audioContext && typeof window !== 'undefined' && window.AudioContext) {
        try {
            audioContext = new AudioContext();
        } catch (e) {
            console.warn('[NotificationSound] Failed to create AudioContext:', e);
            return null;
        }
    }
    return audioContext;
}

export function setSoundEnabled(enabled: boolean): void {
    soundEnabled = enabled;
}

export function isSoundEnabled(): boolean {
    return soundEnabled;
}

/**
 * Play a success notification sound (ascending chime)
 */
export async function playSuccessSound(): Promise<void> {
    if (!soundEnabled) return;

    const ctx = getAudioContext();
    if (!ctx) return;

    // Resume context if suspended (browser autoplay policy)
    if (ctx.state === 'suspended') {
        try {
            await ctx.resume();
        } catch {
            return;
        }
    }

    const now = ctx.currentTime;

    // Create oscillator for pleasant chime
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sine';
    osc2.type = 'sine';

    // Ascending notes (C5 -> E5)
    osc1.frequency.setValueAtTime(523.25, now); // C5
    osc1.frequency.setValueAtTime(659.25, now + 0.15); // E5

    osc2.frequency.setValueAtTime(659.25, now); // E5
    osc2.frequency.setValueAtTime(783.99, now + 0.15); // G5

    // Envelope
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.15, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.4);
    osc2.stop(now + 0.4);
}

/**
 * Play an error notification sound (descending tone)
 */
export async function playErrorSound(): Promise<void> {
    if (!soundEnabled) return;

    const ctx = getAudioContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
        try {
            await ctx.resume();
        } catch {
            return;
        }
    }

    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.3);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.35);
}

/**
 * Play a subtle notification sound (single soft ping)
 */
export async function playNotificationPing(): Promise<void> {
    if (!soundEnabled) return;

    const ctx = getAudioContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
        try {
            await ctx.resume();
        } catch {
            return;
        }
    }

    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now); // A5

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.1, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.25);
}
