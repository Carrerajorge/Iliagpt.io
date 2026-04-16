import { BaseResolver } from './base-resolver';
import { PipelineContext, StructuredOutput } from '../types';

interface SummaryOutput extends StructuredOutput {
  type: 'summary';
  content: string;
  keyPoints?: string[];
}

export class SummarizeResolver extends BaseResolver<SummaryOutput> {
  getPromptTemplate(context: PipelineContext): string {
    const { constraints, normalizedInput } = context;
    
    let prompt = `Resume el siguiente texto de manera ${constraints.tone}:

"${normalizedInput.cleanedText}"`;

    if (constraints.maxLength) {
      prompt += `\n\nEl resumen debe tener máximo ${constraints.maxLength} palabras.`;
    }

    if (constraints.mustKeep.length > 0) {
      prompt += `\n\n## OBLIGATORIO mencionar: ${constraints.mustKeep.join(', ')}`;
    }

    if (constraints.mustNotUse.length > 0) {
      prompt += `\n\n## PROHIBIDO mencionar: ${constraints.mustNotUse.join(', ')}`;
    }

    prompt += `\n\n## Responde SOLO con este formato JSON:
{
  "summary": "El resumen completo aquí",
  "keyPoints": [
    "Punto clave 1",
    "Punto clave 2",
    "Punto clave 3"
  ]
}`;

    return prompt;
  }

  parseOutput(rawOutput: string): SummaryOutput {
    try {
      const jsonStr = this.extractJSON(rawOutput);
      const parsed = JSON.parse(jsonStr);
      
      return {
        type: 'summary',
        content: parsed.summary || parsed.content || '',
        keyPoints: parsed.keyPoints || parsed.key_points || []
      };
    } catch {
      return {
        type: 'summary',
        content: rawOutput.trim(),
        keyPoints: []
      };
    }
  }

  getOutputSchema(): object {
    return {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        keyPoints: {
          type: 'array',
          items: { type: 'string' }
        }
      },
      required: ['summary']
    };
  }
}

export const summarizeResolver = new SummarizeResolver();
