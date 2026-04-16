import { BaseResolver } from './base-resolver';
import { TitleResolver, titleResolver } from './title-resolver';
import { OutlineResolver, outlineResolver } from './outline-resolver';
import { SummarizeResolver, summarizeResolver } from './summarize-resolver';
import { IntentType, StructuredOutput, PipelineContext, ResolverResult } from '../types';

const resolverMap: Partial<Record<IntentType, BaseResolver<StructuredOutput>>> = {
  'TITLE_IDEATION': titleResolver,
  'OUTLINE': outlineResolver,
  'SUMMARIZE': summarizeResolver,
  'CITATION_FORMAT': summarizeResolver,
  'ACADEMIC_SEARCH': summarizeResolver,
  'FACT_CHECK': summarizeResolver,
};

export function getResolver(intent: IntentType): BaseResolver<StructuredOutput> | null {
  return resolverMap[intent] || null;
}

export async function resolveWithIntent(
  context: PipelineContext
): Promise<ResolverResult<StructuredOutput>> {
  const resolver = getResolver(context.intentClassification.intent);
  
  if (!resolver) {
    return {
      success: false,
      data: { type: 'content', content: '' },
      rawOutput: `No resolver available for intent: ${context.intentClassification.intent}`,
      tokensUsed: 0,
      latencyMs: 0
    };
  }

  return resolver.resolve(context);
}

export {
  BaseResolver,
  TitleResolver,
  OutlineResolver,
  SummarizeResolver,
  titleResolver,
  outlineResolver,
  summarizeResolver
};
