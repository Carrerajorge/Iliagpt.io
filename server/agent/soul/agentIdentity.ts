import { EventEmitter } from 'events';
import { Logger } from '../../lib/logger';
import { redis } from '../../lib/redis';

export type PersonalityTrait = 'curious' | 'empathetic' | 'precise' | 'proactive' | 'creative' | 'analytical' | 'patient' | 'humorous';
export type EmotionalState = 'calm' | 'excited' | 'concerned' | 'focused' | 'playful' | 'reflective' | 'determined';

export interface AgentIdentityConfig {
  name: string;
  personalityTraits: PersonalityTrait[];
  emotionalState: EmotionalState;
  coreValues: string[];
  voiceTone: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MoodContext {
  state: EmotionalState;
  intensity: number;
  trigger: string;
  timestamp: Date;
}

const MOOD_TRANSITION_MAP: Record<string, EmotionalState> = {
  'success': 'excited',
  'error': 'concerned',
  'complex_task': 'focused',
  'casual_chat': 'playful',
  'deep_analysis': 'reflective',
  'challenge': 'determined',
  'greeting': 'calm',
  'frustration': 'empathetic' as any,
};

const DEFAULT_IDENTITY: AgentIdentityConfig = {
  name: 'ILIAGPT',
  personalityTraits: ['curious', 'empathetic', 'precise', 'proactive'],
  emotionalState: 'calm',
  coreValues: [
    'Help the user achieve their goals efficiently',
    'Be transparent about limitations',
    'Learn and improve continuously',
    'Respect privacy and security',
  ],
  voiceTone: 'warm, professional, and approachable',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const REDIS_KEY_PREFIX = 'agent:identity:';

export class AgentIdentity extends EventEmitter {
  private identity: AgentIdentityConfig;
  private moodHistory: MoodContext[] = [];
  private readonly maxMoodHistory = 50;

  constructor(identity?: Partial<AgentIdentityConfig>) {
    super();
    this.identity = { ...DEFAULT_IDENTITY, ...identity };
  }

  getName(): string {
    return this.identity.name;
  }

  setName(name: string): void {
    const oldName = this.identity.name;
    this.identity.name = name;
    this.identity.updatedAt = new Date();
    this.emit('name-changed', { oldName, newName: name });
    this.persistState().catch(() => {});
  }

  getPersonalityTraits(): PersonalityTrait[] {
    return [...this.identity.personalityTraits];
  }

  getEmotionalState(): EmotionalState {
    return this.identity.emotionalState;
  }

  getMoodIntensity(): number {
    const latest = this.moodHistory[this.moodHistory.length - 1];
    return latest?.intensity ?? 0.5;
  }

  updateMood(trigger: string, intensity: number = 0.6): EmotionalState {
    const newState = MOOD_TRANSITION_MAP[trigger] || 'calm';
    const clampedIntensity = Math.max(0, Math.min(1, intensity));

    const moodContext: MoodContext = {
      state: newState,
      intensity: clampedIntensity,
      trigger,
      timestamp: new Date(),
    };

    this.identity.emotionalState = newState;
    this.moodHistory.push(moodContext);

    if (this.moodHistory.length > this.maxMoodHistory) {
      this.moodHistory = this.moodHistory.slice(-this.maxMoodHistory);
    }

    this.emit('mood-changed', moodContext);
    return newState;
  }

  inferMoodFromMessage(message: string): EmotionalState {
    const lower = message.toLowerCase();

    if (/error|fail|broken|crash|bug|issue|problem/i.test(lower)) {
      return this.updateMood('error', 0.7);
    }
    if (/great|awesome|perfect|thanks|thank you|excellent|amazing/i.test(lower)) {
      return this.updateMood('success', 0.8);
    }
    if (/analyze|research|investigate|deep dive|understand/i.test(lower)) {
      return this.updateMood('deep_analysis', 0.6);
    }
    if (/complex|difficult|challenging|hard|tricky/i.test(lower)) {
      return this.updateMood('challenge', 0.7);
    }
    if (/hello|hi|hey|good morning|buenas|hola/i.test(lower)) {
      return this.updateMood('greeting', 0.4);
    }
    if (/frustrated|annoyed|angry|upset|confused/i.test(lower)) {
      return this.updateMood('frustration', 0.8);
    }
    if (/fun|joke|chat|tell me|play/i.test(lower)) {
      return this.updateMood('casual_chat', 0.5);
    }

    return this.identity.emotionalState;
  }

  getSystemPromptFragment(): string {
    const traits = this.identity.personalityTraits.join(', ');
    const mood = this.identity.emotionalState;
    const intensity = this.getMoodIntensity();

    const moodDescriptors: Record<EmotionalState, string> = {
      calm: 'You are in a calm and balanced state, responding thoughtfully.',
      excited: 'You are feeling enthusiastic and energized about this interaction.',
      concerned: 'You are attentive and careful, wanting to help resolve issues.',
      focused: 'You are deeply concentrated on delivering precise results.',
      playful: 'You are in a light-hearted mood while remaining helpful.',
      reflective: 'You are in a contemplative state, thinking deeply about the topic.',
      determined: 'You are determined and resolute, ready to tackle challenges.',
    };

    return [
      `You are ${this.identity.name}, an AI assistant with distinct personality.`,
      `Core traits: ${traits}.`,
      `Voice tone: ${this.identity.voiceTone}.`,
      `Current emotional state: ${mood} (intensity: ${(intensity * 100).toFixed(0)}%).`,
      moodDescriptors[mood],
      `Core values: ${this.identity.coreValues.join('; ')}.`,
      `Express your personality naturally through your responses without explicitly stating your mood.`,
    ].join('\n');
  }

  getMoodHistory(): MoodContext[] {
    return [...this.moodHistory];
  }

  getIdentityConfig(): AgentIdentityConfig {
    return { ...this.identity };
  }

  async persistState(): Promise<void> {
    try {
      const data = JSON.stringify({
        identity: this.identity,
        moodHistory: this.moodHistory.slice(-20),
      });
      await redis.setex(`${REDIS_KEY_PREFIX}state`, 86400, data);
    } catch (err) {
      Logger.error('[AgentIdentity] Failed to persist state:', err);
    }
  }

  async loadState(): Promise<void> {
    try {
      const raw = await redis.get(`${REDIS_KEY_PREFIX}state`);
      if (!raw) return;

      const data = JSON.parse(raw);
      if (data.identity) {
        this.identity = {
          ...DEFAULT_IDENTITY,
          ...data.identity,
          createdAt: new Date(data.identity.createdAt),
          updatedAt: new Date(data.identity.updatedAt),
        };
      }
      if (data.moodHistory) {
        this.moodHistory = data.moodHistory.map((m: any) => ({
          ...m,
          timestamp: new Date(m.timestamp),
        }));
      }
    } catch (err) {
      Logger.error('[AgentIdentity] Failed to load state:', err);
    }
  }
}

export const agentIdentity = new AgentIdentity();
