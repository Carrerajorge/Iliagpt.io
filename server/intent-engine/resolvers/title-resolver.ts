import { BaseResolver } from './base-resolver';
import { PipelineContext, StructuredOutput } from '../types';

interface TitleOutput extends StructuredOutput {
  type: 'titles';
  items: string[];
}

export class TitleResolver extends BaseResolver<TitleOutput> {
  getPromptTemplate(context: PipelineContext): string {
    const { constraints, normalizedInput } = context;
    const count = constraints.n || 10;
    
    let prompt = `Genera exactamente ${count} títulos sobre: "${normalizedInput.entities.topic || normalizedInput.cleanedText}"

## Dominio: ${constraints.domain}
## Tono: ${constraints.tone}`;

    if (constraints.mustKeep.length > 0) {
      prompt += `\n\n## OBLIGATORIO incluir en cada título: ${constraints.mustKeep.join(', ')}`;
    }

    if (constraints.mustNotUse.length > 0) {
      prompt += `\n\n## PROHIBIDO usar: ${constraints.mustNotUse.join(', ')}`;
    }

    prompt += `\n\n## Responde SOLO con este formato JSON:
{
  "titles": [
    "Título 1",
    "Título 2",
    ...
  ]
}

IMPORTANTE: Deben ser EXACTAMENTE ${count} títulos, ni más ni menos.`;

    return prompt;
  }

  parseOutput(rawOutput: string): TitleOutput {
    try {
      const jsonStr = this.extractJSON(rawOutput);
      const parsed = JSON.parse(jsonStr);
      
      if (parsed.titles && Array.isArray(parsed.titles)) {
        return {
          type: 'titles',
          items: parsed.titles.map((t: string) => t.trim())
        };
      }

      if (Array.isArray(parsed)) {
        return {
          type: 'titles',
          items: parsed.map((t: string) => t.trim())
        };
      }

      return {
        type: 'titles',
        items: []
      };
    } catch {
      const lines = rawOutput.split('\n')
        .map(line => line.replace(/^\d+[\.\)]\s*/, '').trim())
        .filter(line => line.length > 5);

      return {
        type: 'titles',
        items: lines
      };
    }
  }

  getOutputSchema(): object {
    return {
      type: 'object',
      properties: {
        titles: {
          type: 'array',
          items: { type: 'string' }
        }
      },
      required: ['titles']
    };
  }
}

export const titleResolver = new TitleResolver();
