import { RAGRetriever, SearchResult, SearchOptions } from './ragRetriever';
import { DetectedIntent, IntentType } from './intentRouter';
import { HydratedConversationState } from '@shared/schema';

export interface RetrievalConfig {
  ragTopK: number;
  ragMinScore: number;
  recencyWindowSize: number;
  enableRunningSummary: boolean;
  maxFactsToInclude: number;
}

export interface RetrievedChunk {
  id: string;
  content: string;
  score: number;
  type: string;
  citationLabel: string;
}

export interface RecencyMessage {
  role: string;
  content: string;
  turnNumber?: number;
}

export interface RelevantFact {
  type: string;
  content: string;
  confidence: number;
}

export interface ReferencedImage {
  id: string;
  prompt: string;
  imageUrl: string;
}

export interface ReferencedArtifact {
  id: string;
  fileName?: string;
  artifactType: string;
  extractedText?: string;
}

export interface RetrievedContext {
  relevantChunks: RetrievedChunk[];
  recencyWindow: RecencyMessage[];
  runningSummary?: string;
  relevantFacts: RelevantFact[];
  referencedImages: ReferencedImage[];
  referencedArtifacts: ReferencedArtifact[];
  totalTokensRetrieved: number;
  retrievalTimeMs: number;
}

const DEFAULT_CONFIG: RetrievalConfig = {
  ragTopK: 5,
  ragMinScore: 0.3,
  recencyWindowSize: 10,
  enableRunningSummary: true,
  maxFactsToInclude: 5,
};

export class ContextRetriever {
  private ragRetriever: RAGRetriever;
  private config: RetrievalConfig;

  constructor(ragRetriever: RAGRetriever, config: Partial<RetrievalConfig> = {}) {
    this.ragRetriever = ragRetriever;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async retrieve(
    state: HydratedConversationState,
    query: string,
    intent: DetectedIntent
  ): Promise<RetrievedContext> {
    const startTime = performance.now();

    const relevantChunks: RetrievedChunk[] = [];
    const referencedImages: ReferencedImage[] = [];
    const referencedArtifacts: ReferencedArtifact[] = [];
    const relevantFacts: RelevantFact[] = [];

    if (intent.requiresRAG && query.trim()) {
      const searchOptions: SearchOptions = {
        topK: this.config.ragTopK,
        minScore: this.config.ragMinScore,
      };

      const results = this.ragRetriever.search(query, searchOptions);
      
      results.forEach((result, index) => {
        relevantChunks.push({
          id: result.id,
          content: result.content,
          score: result.score,
          type: result.type,
          citationLabel: `[${index + 1}]`,
        });
      });
    }

    const recencyWindow = this.getRecencyWindow(state);

    this.resolveImageReferences(state, intent, referencedImages);
    this.resolveArtifactReferences(state, intent, referencedArtifacts);

    this.collectRelevantFacts(state, relevantFacts);

    const runningSummary = this.config.enableRunningSummary
      ? state.context?.summary || undefined
      : undefined;

    const totalTokensRetrieved = this.calculateTotalTokens(
      relevantChunks,
      recencyWindow,
      runningSummary,
      relevantFacts,
      referencedArtifacts
    );

    const retrievalTimeMs = performance.now() - startTime;

    return {
      relevantChunks,
      recencyWindow,
      runningSummary,
      relevantFacts,
      referencedImages,
      referencedArtifacts,
      totalTokensRetrieved,
      retrievalTimeMs,
    };
  }

  private getRecencyWindow(state: HydratedConversationState): RecencyMessage[] {
    const messages = state.messages || [];
    const windowSize = this.config.recencyWindowSize;
    
    const recentMessages = messages.slice(-windowSize);
    const startIndex = Math.max(0, messages.length - windowSize);
    
    return recentMessages.map((msg, index) => ({
      role: msg.role,
      content: msg.content,
      turnNumber: startIndex + index + 1,
    }));
  }

  private resolveImageReferences(
    state: HydratedConversationState,
    intent: DetectedIntent,
    referencedImages: ReferencedImage[]
  ): void {
    const images = state.images || [];

    for (const ref of intent.imageReferences) {
      if (ref.resolvedImageId) {
        const image = images.find(img => img.id === ref.resolvedImageId);
        if (image) {
          referencedImages.push({
            id: image.id,
            prompt: image.prompt,
            imageUrl: image.imageUrl,
          });
        }
      }
    }

    if (intent.type === IntentType.EDIT_IMAGE && intent.imageEditParams?.baseImageId) {
      const baseImageId = intent.imageEditParams.baseImageId;
      const alreadyAdded = referencedImages.some(img => img.id === baseImageId);
      
      if (!alreadyAdded) {
        const image = images.find(img => img.id === baseImageId);
        if (image) {
          referencedImages.push({
            id: image.id,
            prompt: image.prompt,
            imageUrl: image.imageUrl,
          });
        }
      }
    }
  }

  private resolveArtifactReferences(
    state: HydratedConversationState,
    intent: DetectedIntent,
    referencedArtifacts: ReferencedArtifact[]
  ): void {
    const artifacts = state.artifacts || [];

    for (const ref of intent.artifactReferences) {
      if (ref.resolvedArtifactId) {
        const artifact = artifacts.find(a => a.id === ref.resolvedArtifactId);
        if (artifact) {
          referencedArtifacts.push({
            id: artifact.id,
            fileName: artifact.fileName || undefined,
            artifactType: artifact.artifactType,
            extractedText: artifact.extractedText || undefined,
          });
        }
      }
    }
  }

  private collectRelevantFacts(
    state: HydratedConversationState,
    relevantFacts: RelevantFact[]
  ): void {
    const context = state.context;
    if (!context) return;

    if (context.entities && Array.isArray(context.entities)) {
      const topEntities = context.entities
        .sort((a, b) => (b.mentions || 0) - (a.mentions || 0))
        .slice(0, this.config.maxFactsToInclude);

      for (const entity of topEntities) {
        relevantFacts.push({
          type: 'entity',
          content: `${entity.name} (${entity.type})`,
          confidence: 80,
        });
      }
    }

    if (context.userPreferences && typeof context.userPreferences === 'object') {
      const prefs = context.userPreferences;
      const prefKeys = Object.keys(prefs).slice(0, this.config.maxFactsToInclude - relevantFacts.length);
      
      for (const key of prefKeys) {
        relevantFacts.push({
          type: 'user_preference',
          content: `${key}: ${JSON.stringify(prefs[key])}`,
          confidence: 90,
        });
      }
    }
  }

  private calculateTotalTokens(
    chunks: RetrievedChunk[],
    recencyWindow: RecencyMessage[],
    runningSummary: string | undefined,
    facts: RelevantFact[],
    artifacts: ReferencedArtifact[]
  ): number {
    let totalChars = 0;

    for (const chunk of chunks) {
      totalChars += chunk.content.length;
    }

    for (const msg of recencyWindow) {
      totalChars += msg.content.length;
    }

    if (runningSummary) {
      totalChars += runningSummary.length;
    }

    for (const fact of facts) {
      totalChars += fact.content.length;
    }

    for (const artifact of artifacts) {
      if (artifact.extractedText) {
        totalChars += artifact.extractedText.length;
      }
    }

    return Math.ceil(totalChars / 4);
  }

  getConfig(): RetrievalConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<RetrievalConfig>): void {
    this.config = { ...this.config, ...updates };
  }
}
