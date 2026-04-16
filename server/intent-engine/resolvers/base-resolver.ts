import { Constraints, ResolverResult, StructuredOutput, ResolverConfig, PipelineContext } from '../types';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

export abstract class BaseResolver<T extends StructuredOutput = StructuredOutput> {
  protected config: ResolverConfig;

  constructor(config?: Partial<ResolverConfig>) {
    this.config = {
      maxRetries: config?.maxRetries ?? 2,
      temperature: config?.temperature ?? 0.7,
      maxTokens: config?.maxTokens ?? 2000,
      model: config?.model ?? 'claude-sonnet-4-20250514'
    };
  }

  abstract getPromptTemplate(context: PipelineContext): string;
  abstract parseOutput(rawOutput: string): T;
  abstract getOutputSchema(): object;

  async resolve(context: PipelineContext): Promise<ResolverResult<T>> {
    const startTime = Date.now();
    
    try {
      const prompt = this.getPromptTemplate(context);
      const systemPrompt = this.buildSystemPrompt(context.constraints);
      
      const response = await anthropic.messages.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }]
      });

      const rawOutput = response.content[0].type === 'text' 
        ? response.content[0].text 
        : '';

      const data = this.parseOutput(rawOutput);
      
      return {
        success: true,
        data,
        rawOutput,
        tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
        latencyMs: Date.now() - startTime
      };
    } catch (error) {
      return {
        success: false,
        data: {} as T,
        rawOutput: error instanceof Error ? error.message : 'Unknown error',
        tokensUsed: 0,
        latencyMs: Date.now() - startTime
      };
    }
  }

  protected buildSystemPrompt(constraints: Constraints): string {
    const parts: string[] = [
      'Eres un asistente especializado que DEBE seguir instrucciones exactas.',
      '',
      '## Restricciones OBLIGATORIAS:',
    ];

    if (constraints.mustNotUse.length > 0) {
      parts.push(`- PROHIBIDO usar estas palabras/conceptos: ${constraints.mustNotUse.join(', ')}`);
    }

    if (constraints.mustKeep.length > 0) {
      parts.push(`- OBLIGATORIO mantener: ${constraints.mustKeep.join(', ')}`);
    }

    if (constraints.n) {
      parts.push(`- CANTIDAD EXACTA requerida: ${constraints.n} elementos`);
    }

    parts.push(`- Dominio: ${constraints.domain}`);
    parts.push(`- Tono: ${constraints.tone}`);
    parts.push(`- Idioma: ${constraints.language === 'es' ? 'español' : 'inglés'}`);

    parts.push('');
    parts.push('## Formato de salida:');
    parts.push('DEBES responder SOLO con un objeto JSON válido, sin texto adicional.');
    parts.push('No incluyas explicaciones, solo el JSON.');

    return parts.join('\n');
  }

  protected extractJSON(text: string): string {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return jsonMatch[0];
    }
    
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      return arrayMatch[0];
    }
    
    return text;
  }
}
