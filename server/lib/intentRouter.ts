/**
 * IntentRouter - Detects user intent from messages for the conversation memory system
 * Supports bilingual pattern matching (Spanish/English)
 */

export enum IntentType {
  GENERATE_IMAGE = 'generate_image',
  EDIT_IMAGE = 'edit_image',
  QUESTION_ABOUT_ARTIFACT = 'question_about_artifact',
  QUESTION_ABOUT_IMAGE = 'question_about_image',
  CONTINUE_CONVERSATION = 'continue_conversation',
  REFERENCE_PREVIOUS = 'reference_previous',
  NEW_TOPIC = 'new_topic'
}

export enum MessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
  SYSTEM = 'system',
  TOOL = 'tool'
}

export enum ImageMode {
  GENERATE = 'generate',
  EDIT = 'edit',
  VARIATION = 'variation',
  UPSCALE = 'upscale'
}

export interface ArtifactReference {
  phrase: string;
  resolvedArtifactId?: string;
  ambiguous?: boolean;
}

export interface ImageReference {
  phrase: string;
  resolvedImageId?: string;
  ambiguous?: boolean;
}

export interface MessageReference {
  phrase: string;
  turnOffset: number;
}

export interface ImageEditParams {
  baseImageId: string;
  editInstructions: string;
  editType?: string;
}

export interface DetectedIntent {
  type: IntentType;
  confidence: number;
  artifactReferences: ArtifactReference[];
  imageReferences: ImageReference[];
  messageReferences?: MessageReference[];
  requiresRAG: boolean;
  ragQuery: string | null;
  imageEditParams: ImageEditParams | null;
}

export interface ConversationState {
  artifacts: Array<{ artifactId: string; [key: string]: any }>;
  images: Array<{ imageId: string; [key: string]: any }>;
  imageHistory?: Array<{ imageId: string; [key: string]: any }>;
}

export class IntentRouter {
  private static readonly ARTIFACT_PATTERNS: RegExp[] = [
    /(?:ese|este|aquel|el|la)\s+(?:documento|doc|archivo|fichero|pdf|excel|reporte|informe)/gi,
    /(?:el|la)\s+(?:documento|archivo|pdf|excel)\s+(?:que\s+)?(?:subí|subiste|cargué|enviaste)/gi,
    /(?:el|la)\s+(?:anterior|previo|último)\s+(?:documento|archivo|pdf)/gi,
    /(?:in|from|about)\s+(?:the|that|this)\s+(?:document|file|pdf|excel|report)/gi,
    /(?:that|this|the)\s+(?:document|file|pdf|excel|report)/gi
  ];

  private static readonly IMAGE_PATTERNS: RegExp[] = [
    /(?:esa|esta|aquella|la)\s+(?:imagen|foto|fotografía|picture|image)/gi,
    /(?:la)\s+(?:imagen|foto)\s+(?:que\s+)?(?:generaste|creaste|hiciste)/gi,
    /(?:la)\s+(?:anterior|previa|última)\s+(?:imagen|foto)/gi,
    /(?:that|this|the)\s+(?:image|picture|photo)/gi
  ];

  private static readonly IMAGE_EDIT_PATTERNS: RegExp[] = [
    /(?:edita|modifica|cambia|ajusta|arregla)\s+(?:la|esa|esta)\s+(?:imagen|foto)/gi,
    /(?:añade|agrega|pon|quita|elimina|borra)\s+(?:a|de|en)\s+(?:la|esa)\s+(?:imagen|foto)/gi,
    /(?:hazla|hazlo|ponla|ponlo)\s+(?:más|menos)/gi,
    /(?:edit|modify|change|adjust|fix)\s+(?:the|that|this)\s+(?:image|picture)/gi,
    /(?:add|remove|put)\s+(?:to|from|on)\s+(?:the|that|this)\s+(?:image|picture)/gi
  ];

  private static readonly IMAGE_GENERATE_PATTERNS: RegExp[] = [
    /(?:genera|crea|dibuja|haz|hazme)\s+(?:una|un)\s+(?:imagen|foto|dibujo)/gi,
    /(?:generate|create|draw|make)\s+(?:a|an)\s+(?:image|picture)/gi,
    /(?:quiero|necesito|dame)\s+(?:una|un)\s+(?:imagen|foto)/gi,
    /(?:i\s+want|i\s+need|give\s+me)\s+(?:a|an)\s+(?:image|picture)/gi
  ];

  private static readonly MESSAGE_PATTERNS: RegExp[] = [
    /(?:lo\s+que\s+dijiste|tu\s+respuesta)\s+(?:anterior|antes|previa)/gi,
    /(?:como\s+mencionaste|como\s+dijiste)\s+(?:antes|anteriormente)/gi,
    /(?:lo\s+de\s+arriba|lo\s+anterior)/gi,
    /(?:what\s+you\s+said|your\s+response)\s+(?:earlier|before|previously)/gi,
    /(?:as\s+you\s+mentioned|as\s+you\s+said)\s+(?:before|earlier)/gi
  ];

  static detectIntent(
    message: string,
    state: ConversationState
  ): DetectedIntent {
    const images = state.imageHistory ?? state.images ?? [];
    const artifacts = state.artifacts ?? [];

    const intent: DetectedIntent = {
      type: IntentType.CONTINUE_CONVERSATION,
      confidence: 0.5,
      artifactReferences: [],
      imageReferences: [],
      messageReferences: [],
      requiresRAG: false,
      ragQuery: null,
      imageEditParams: null
    };

    this.detectArtifactReferences(message, artifacts, intent);
    this.detectImageReferences(message, images, intent);
    this.detectMessageReferences(message, intent);
    this.determineIntentType(message, intent, images);
    this.setRAGRequirements(intent, message);

    return intent;
  }

  private static detectArtifactReferences(
    message: string,
    artifacts: Array<{ artifactId: string }>,
    intent: DetectedIntent
  ): void {
    for (const pattern of this.ARTIFACT_PATTERNS) {
      pattern.lastIndex = 0;
      const matches = message.match(pattern);
      if (matches) {
        for (const match of matches) {
          const resolved = artifacts.length > 0 ? artifacts[artifacts.length - 1] : null;
          intent.artifactReferences.push({
            phrase: match,
            resolvedArtifactId: resolved?.artifactId,
            ambiguous: !resolved || artifacts.length > 1
          });
        }
      }
    }
  }

  private static detectImageReferences(
    message: string,
    images: Array<{ imageId: string }>,
    intent: DetectedIntent
  ): void {
    for (const pattern of this.IMAGE_PATTERNS) {
      pattern.lastIndex = 0;
      const matches = message.match(pattern);
      if (matches) {
        for (const match of matches) {
          const resolved = images.length > 0 ? images[images.length - 1] : null;
          intent.imageReferences.push({
            phrase: match,
            resolvedImageId: resolved?.imageId,
            ambiguous: !resolved || images.length > 1
          });
        }
      }
    }
  }

  private static detectMessageReferences(
    message: string,
    intent: DetectedIntent
  ): void {
    for (const pattern of this.MESSAGE_PATTERNS) {
      pattern.lastIndex = 0;
      const matches = message.match(pattern);
      if (matches) {
        for (const match of matches) {
          intent.messageReferences?.push({
            phrase: match,
            turnOffset: -1
          });
        }
      }
    }
  }

  private static determineIntentType(
    message: string,
    intent: DetectedIntent,
    images: Array<{ imageId: string }>
  ): void {
    if (this.matchesPatterns(message, this.IMAGE_EDIT_PATTERNS)) {
      intent.type = IntentType.EDIT_IMAGE;
      intent.confidence = 0.9;

      const baseImage = intent.imageReferences[0]?.resolvedImageId
        ? images.find(img => img.imageId === intent.imageReferences[0].resolvedImageId)
        : images[images.length - 1];

      if (baseImage) {
        intent.imageEditParams = {
          baseImageId: baseImage.imageId,
          editType: 'edit',
          editInstructions: message
        };
      }
    } else if (this.matchesPatterns(message, this.IMAGE_GENERATE_PATTERNS)) {
      intent.type = IntentType.GENERATE_IMAGE;
      intent.confidence = 0.9;
    } else if (intent.artifactReferences.length > 0) {
      intent.type = IntentType.QUESTION_ABOUT_ARTIFACT;
      intent.confidence = 0.85;
    } else if (intent.imageReferences.length > 0) {
      intent.type = IntentType.QUESTION_ABOUT_IMAGE;
      intent.confidence = 0.85;
    } else if (intent.messageReferences && intent.messageReferences.length > 0) {
      intent.type = IntentType.REFERENCE_PREVIOUS;
      intent.confidence = 0.8;
    }
  }

  private static setRAGRequirements(
    intent: DetectedIntent,
    message: string
  ): void {
    if (
      intent.artifactReferences.length > 0 ||
      (intent.messageReferences && intent.messageReferences.length > 0) ||
      intent.type === IntentType.QUESTION_ABOUT_ARTIFACT ||
      intent.type === IntentType.REFERENCE_PREVIOUS
    ) {
      intent.requiresRAG = true;
      intent.ragQuery = message;
    }
  }

  private static matchesPatterns(message: string, patterns: RegExp[]): boolean {
    return patterns.some(pattern => {
      pattern.lastIndex = 0;
      return pattern.test(message);
    });
  }
}
