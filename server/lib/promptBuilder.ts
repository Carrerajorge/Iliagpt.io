import { 
  RetrievedContext, 
  RetrievedChunk, 
  RecencyMessage, 
  RelevantFact, 
  ReferencedImage, 
  ReferencedArtifact 
} from './contextRetriever';
import { DetectedIntent, IntentType } from './intentRouter';

export interface BuiltPrompt {
  systemPrompt: string;
  userPrompt: string;
  citations: Array<{ label: string; source: string; content: string }>;
  totalTokens: number;
  metadata: {
    hasRunningSummary: boolean;
    factsIncluded: number;
    chunksIncluded: number;
    imagesReferenced: number;
    artifactsReferenced: number;
  };
}

export interface PromptBuildOptions {
  includeSystemContext?: boolean;
  language?: 'es' | 'en';
  citationFormat?: 'numbered' | 'bracketed';
}

interface SectionLabels {
  runningSummary: string;
  importantFacts: string;
  retrievedInfo: string;
  referencedImages: string;
  referencedDocuments: string;
  conversationContext: string;
  userMessage: string;
}

const LABELS_ES: SectionLabels = {
  runningSummary: '## Resumen de la conversación',
  importantFacts: '## Hechos importantes',
  retrievedInfo: '## Información relevante recuperada',
  referencedImages: '## Imágenes referenciadas',
  referencedDocuments: '## Documentos referenciados',
  conversationContext: '## Contexto de la conversación reciente',
  userMessage: '## Mensaje del usuario',
};

const LABELS_EN: SectionLabels = {
  runningSummary: '## Conversation Summary',
  importantFacts: '## Important Facts',
  retrievedInfo: '## Retrieved Relevant Information',
  referencedImages: '## Referenced Images',
  referencedDocuments: '## Referenced Documents',
  conversationContext: '## Recent Conversation Context',
  userMessage: '## User Message',
};

export class PromptBuilder {
  private maxContextTokens: number;

  constructor(maxContextTokens: number = 4000) {
    this.maxContextTokens = maxContextTokens;
  }

  build(
    userMessage: string,
    context: RetrievedContext,
    intent: DetectedIntent,
    options?: PromptBuildOptions
  ): BuiltPrompt {
    const opts = {
      includeSystemContext: true,
      language: 'es' as const,
      citationFormat: 'bracketed' as const,
      ...options,
    };

    const labels = opts.language === 'es' ? LABELS_ES : LABELS_EN;

    const truncatedContext = this.truncateContextToFit(context);

    const systemPrompt = opts.includeSystemContext
      ? this.buildSystemPrompt(truncatedContext, labels)
      : '';

    const userPrompt = this.buildUserPrompt(userMessage, truncatedContext, intent, labels);

    const citations = this.formatCitations(truncatedContext.relevantChunks, opts.citationFormat);

    const totalTokens = this.estimateTokens(systemPrompt + userPrompt);

    const metadata = {
      hasRunningSummary: !!truncatedContext.runningSummary,
      factsIncluded: truncatedContext.relevantFacts.length,
      chunksIncluded: truncatedContext.relevantChunks.length,
      imagesReferenced: truncatedContext.referencedImages.length,
      artifactsReferenced: truncatedContext.referencedArtifacts.length,
    };

    return {
      systemPrompt,
      userPrompt,
      citations,
      totalTokens,
      metadata,
    };
  }

  private buildSystemPrompt(context: RetrievedContext, labels: SectionLabels): string {
    const sections: string[] = [];

    if (context.runningSummary) {
      sections.push(`${labels.runningSummary}\n${context.runningSummary}`);
    }

    if (context.relevantFacts.length > 0) {
      const factsContent = context.relevantFacts
        .map(fact => `- ${fact.content}`)
        .join('\n');
      sections.push(`${labels.importantFacts}\n${factsContent}`);
    }

    if (context.relevantChunks.length > 0) {
      const chunksContent = context.relevantChunks
        .map(chunk => `${chunk.citationLabel} ${chunk.content}`)
        .join('\n\n');
      sections.push(`${labels.retrievedInfo}\n${chunksContent}`);
    }

    if (context.referencedImages.length > 0) {
      const imagesContent = context.referencedImages
        .map((img, idx) => `[IMG${idx + 1}] Prompt: "${img.prompt}" (ID: ${img.id})`)
        .join('\n');
      sections.push(`${labels.referencedImages}\n${imagesContent}`);
    }

    if (context.referencedArtifacts.length > 0) {
      const artifactsContent = context.referencedArtifacts
        .map((artifact, idx) => {
          const fileName = artifact.fileName || `documento_${artifact.id}`;
          const excerpt = artifact.extractedText
            ? this.truncateText(artifact.extractedText, 500)
            : '';
          return `[DOC${idx + 1}] ${fileName} (${artifact.artifactType})${excerpt ? `\nExcerpt: ${excerpt}` : ''}`;
        })
        .join('\n\n');
      sections.push(`${labels.referencedDocuments}\n${artifactsContent}`);
    }

    return sections.join('\n\n');
  }

  private buildUserPrompt(
    userMessage: string,
    context: RetrievedContext,
    intent: DetectedIntent,
    labels: SectionLabels
  ): string {
    const sections: string[] = [];

    if (context.recencyWindow.length > 0) {
      const conversationContext = this.formatRecencyWindow(context.recencyWindow);
      sections.push(`${labels.conversationContext}\n${conversationContext}`);
    }

    if (intent.type === IntentType.QUESTION_ABOUT_IMAGE || intent.type === IntentType.EDIT_IMAGE) {
      const imageContext = this.buildImageContext(context.referencedImages, intent);
      if (imageContext) {
        sections.push(imageContext);
      }
    }

    sections.push(`${labels.userMessage}\n${userMessage}`);

    return sections.join('\n\n');
  }

  private formatRecencyWindow(messages: RecencyMessage[]): string {
    return messages
      .map(msg => {
        const roleLabel = msg.role === 'user' ? 'Usuario' : 'Asistente';
        const turnPrefix = msg.turnNumber ? `[Turno ${msg.turnNumber}] ` : '';
        return `${turnPrefix}${roleLabel}: ${msg.content}`;
      })
      .join('\n');
  }

  private buildImageContext(images: ReferencedImage[], intent: DetectedIntent): string | null {
    if (images.length === 0) return null;

    const lines: string[] = ['## Contexto de imagen'];

    for (const img of images) {
      lines.push(`- Imagen referenciada: "${img.prompt}" (ID: ${img.id})`);
    }

    if (intent.type === IntentType.EDIT_IMAGE && intent.imageEditParams) {
      lines.push(`- Instrucciones de edición: ${intent.imageEditParams.editInstructions}`);
    }

    return lines.join('\n');
  }

  private formatCitations(
    chunks: RetrievedChunk[],
    citationFormat: 'numbered' | 'bracketed'
  ): Array<{ label: string; source: string; content: string }> {
    return chunks.map((chunk, index) => {
      const label = citationFormat === 'numbered'
        ? `${index + 1}.`
        : `[${index + 1}]`;

      return {
        label,
        source: chunk.type || 'unknown',
        content: chunk.content,
      };
    });
  }

  private truncateContextToFit(context: RetrievedContext): RetrievedContext {
    let totalTokens = this.estimateContextTokens(context);

    if (totalTokens <= this.maxContextTokens) {
      return context;
    }

    const result: RetrievedContext = {
      ...context,
      relevantChunks: [...context.relevantChunks],
      recencyWindow: [...context.recencyWindow],
      relevantFacts: [...context.relevantFacts],
      referencedImages: [...context.referencedImages],
      referencedArtifacts: [...context.referencedArtifacts],
    };

    while (totalTokens > this.maxContextTokens && result.relevantChunks.length > 1) {
      result.relevantChunks.pop();
      totalTokens = this.estimateContextTokens(result);
    }

    while (totalTokens > this.maxContextTokens && result.recencyWindow.length > 2) {
      result.recencyWindow.shift();
      totalTokens = this.estimateContextTokens(result);
    }

    if (totalTokens > this.maxContextTokens && result.runningSummary) {
      result.runningSummary = this.truncateText(result.runningSummary, 500);
      totalTokens = this.estimateContextTokens(result);
    }

    while (totalTokens > this.maxContextTokens && result.relevantFacts.length > 0) {
      result.relevantFacts.pop();
      totalTokens = this.estimateContextTokens(result);
    }

    result.totalTokensRetrieved = totalTokens;

    return result;
  }

  private estimateContextTokens(context: RetrievedContext): number {
    let totalChars = 0;

    if (context.runningSummary) {
      totalChars += context.runningSummary.length;
    }

    for (const fact of context.relevantFacts) {
      totalChars += fact.content.length + 10;
    }

    for (const chunk of context.relevantChunks) {
      totalChars += chunk.content.length + 20;
    }

    for (const msg of context.recencyWindow) {
      totalChars += msg.content.length + 30;
    }

    for (const img of context.referencedImages) {
      totalChars += (img.prompt?.length || 0) + 50;
    }

    for (const artifact of context.referencedArtifacts) {
      totalChars += (artifact.extractedText?.length || 0) + 100;
    }

    return this.estimateTokens(totalChars);
  }

  private estimateTokens(input: string | number): number {
    const charCount = typeof input === 'string' ? input.length : input;
    return Math.ceil(charCount / 4);
  }

  private truncateText(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars - 3) + '...';
  }

  getMaxContextTokens(): number {
    return this.maxContextTokens;
  }

  setMaxContextTokens(tokens: number): void {
    this.maxContextTokens = tokens;
  }
}
