import { BaseResolver } from './base-resolver';
import { PipelineContext, StructuredOutput, OutlineSection } from '../types';

interface OutlineOutput extends StructuredOutput {
  type: 'outline';
  sections: OutlineSection[];
}

export class OutlineResolver extends BaseResolver<OutlineOutput> {
  getPromptTemplate(context: PipelineContext): string {
    const { constraints, normalizedInput } = context;
    
    let prompt = `Crea un índice/esquema estructurado sobre: "${normalizedInput.entities.topic || normalizedInput.cleanedText}"

## Dominio: ${constraints.domain}
## Tono: ${constraints.tone}`;

    if (constraints.mustKeep.length > 0) {
      prompt += `\n\n## OBLIGATORIO incluir secciones sobre: ${constraints.mustKeep.join(', ')}`;
    }

    if (constraints.mustNotUse.length > 0) {
      prompt += `\n\n## PROHIBIDO incluir secciones sobre: ${constraints.mustNotUse.join(', ')}`;
    }

    prompt += `\n\n## Responde SOLO con este formato JSON:
{
  "sections": [
    {
      "title": "Título de sección",
      "level": 1,
      "subsections": [
        {
          "title": "Subsección",
          "level": 2,
          "subsections": []
        }
      ]
    }
  ]
}

Crea una estructura completa y coherente con al menos 5 secciones principales.`;

    return prompt;
  }

  parseOutput(rawOutput: string): OutlineOutput {
    try {
      const jsonStr = this.extractJSON(rawOutput);
      const parsed = JSON.parse(jsonStr);
      
      if (parsed.sections && Array.isArray(parsed.sections)) {
        return {
          type: 'outline',
          sections: this.normalizeSections(parsed.sections)
        };
      }

      return {
        type: 'outline',
        sections: []
      };
    } catch {
      return this.parseFromText(rawOutput);
    }
  }

  private normalizeSections(sections: unknown[]): OutlineSection[] {
    return sections.map((s: unknown) => {
      const section = s as Record<string, unknown>;
      return {
        title: String(section.title || ''),
        level: Number(section.level) || 1,
        subsections: Array.isArray(section.subsections) 
          ? this.normalizeSections(section.subsections)
          : undefined
      };
    }).filter(s => s.title.length > 0);
  }

  private parseFromText(text: string): OutlineOutput {
    const lines = text.split('\n').filter(l => l.trim());
    const sections: OutlineSection[] = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)/) || 
                          trimmed.match(/^(\d+\.)\s+(.+)/) ||
                          trimmed.match(/^[-*]\s+(.+)/);
      
      if (headingMatch) {
        const level = headingMatch[1].length || 1;
        const title = headingMatch[2] || headingMatch[1];
        sections.push({ title, level, subsections: [] });
      }
    }

    return {
      type: 'outline',
      sections
    };
  }

  getOutputSchema(): object {
    return {
      type: 'object',
      properties: {
        sections: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              level: { type: 'number' },
              subsections: { type: 'array' }
            }
          }
        }
      },
      required: ['sections']
    };
  }
}

export const outlineResolver = new OutlineResolver();
