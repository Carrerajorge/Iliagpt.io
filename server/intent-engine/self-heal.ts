import { 
  PipelineContext, 
  StructuredOutput, 
  RepairAttempt,
  QualityCheckResult,
  Constraints 
} from './types';
import { resolveWithIntent } from './resolvers';
import { qualityGate } from './quality-gate';

const MAX_REPAIR_ATTEMPTS = 3;

export class SelfHealEngine {
  async repair(
    context: PipelineContext,
    failedResult: StructuredOutput,
    qualityResult: QualityCheckResult
  ): Promise<{ success: boolean; result: StructuredOutput; attempts: RepairAttempt[] }> {
    const attempts: RepairAttempt[] = [];
    let currentOutput = failedResult;
    let currentQuality = qualityResult;

    for (let i = 0; i < MAX_REPAIR_ATTEMPTS; i++) {
      const strategy = this.selectRepairStrategy(currentQuality, context.constraints);
      
      const repairedContext = this.createRepairContext(
        context, 
        currentOutput, 
        currentQuality, 
        strategy
      );

      const repairResult = await resolveWithIntent(repairedContext);
      
      if (!repairResult.success) {
        attempts.push({
          attemptNumber: i + 1,
          failedChecks: currentQuality.failedChecks,
          repairStrategy: strategy,
          success: false
        });
        continue;
      }

      currentOutput = repairResult.data;
      currentQuality = qualityGate.verify(currentOutput, context.constraints, context);

      attempts.push({
        attemptNumber: i + 1,
        failedChecks: qualityResult.failedChecks,
        repairStrategy: strategy,
        success: currentQuality.passed,
        result: currentOutput
      });

      if (currentQuality.passed) {
        return { success: true, result: currentOutput, attempts };
      }
    }

    const transformedOutput = this.applyTransformations(
      currentOutput, 
      context.constraints,
      currentQuality
    );

    const finalQuality = qualityGate.verify(transformedOutput, context.constraints, context);
    
    return { 
      success: finalQuality.passed || finalQuality.score >= 0.7,
      result: transformedOutput, 
      attempts 
    };
  }

  private selectRepairStrategy(quality: QualityCheckResult, constraints: Constraints): string {
    const failedChecks = quality.failedChecks;

    if (failedChecks.includes('count')) {
      return 'regenerate_with_strict_count';
    }

    if (failedChecks.includes('prohibited_terms')) {
      return 'regenerate_without_prohibited';
    }

    if (failedChecks.includes('domain_drift')) {
      return 'regenerate_with_domain_focus';
    }

    if (failedChecks.includes('required_terms')) {
      return 'regenerate_with_required_terms';
    }

    return 'regenerate_stricter';
  }

  private createRepairContext(
    original: PipelineContext,
    failedOutput: StructuredOutput,
    quality: QualityCheckResult,
    strategy: string
  ): PipelineContext {
    const repairContext: PipelineContext = {
      ...original,
      normalizedInput: {
        ...original.normalizedInput,
        cleanedText: this.buildRepairPrompt(original, failedOutput, quality, strategy)
      }
    };

    return repairContext;
  }

  private buildRepairPrompt(
    context: PipelineContext,
    failedOutput: StructuredOutput,
    quality: QualityCheckResult,
    strategy: string
  ): string {
    const original = context.normalizedInput.cleanedText;
    const constraints = context.constraints;
    
    let prompt = `[CORRECCIÓN REQUERIDA]\n\nSolicitud original: "${original}"\n\n`;
    prompt += `Problemas detectados:\n`;
    
    for (const check of quality.checks.filter(c => !c.passed)) {
      prompt += `- ${check.message}\n`;
    }

    prompt += `\nEstrategia de corrección: ${strategy}\n\n`;

    switch (strategy) {
      case 'regenerate_with_strict_count':
        prompt += `CRÍTICO: Debes generar EXACTAMENTE ${constraints.n} elementos. `;
        prompt += `La respuesta anterior tenía ${failedOutput.items?.length || 0}. `;
        prompt += `NO generes más ni menos de ${constraints.n}.`;
        break;

      case 'regenerate_without_prohibited':
        prompt += `CRÍTICO: NO uses estas palabras bajo ninguna circunstancia: `;
        prompt += constraints.mustNotUse.join(', ');
        prompt += `\n\nSi algún título/elemento contiene estas palabras, reformúlalo completamente.`;
        break;

      case 'regenerate_with_domain_focus':
        prompt += `CRÍTICO: Mantente ESTRICTAMENTE en el dominio: ${constraints.domain}. `;
        prompt += `No te desvíes a otros temas como educación, tecnología u otros dominios no relacionados.`;
        break;

      case 'regenerate_with_required_terms':
        prompt += `CRÍTICO: TODOS los elementos DEBEN incluir o hacer referencia a: `;
        prompt += constraints.mustKeep.join(', ');
        break;

      default:
        prompt += `Corrige los problemas mencionados y genera una respuesta que cumpla todas las restricciones.`;
    }

    return prompt;
  }

  private applyTransformations(
    output: StructuredOutput,
    constraints: Constraints,
    quality: QualityCheckResult
  ): StructuredOutput {
    let transformed = { ...output };

    if (quality.failedChecks.includes('prohibited_terms') && transformed.items) {
      transformed.items = transformed.items.map(item => 
        this.removeProhibitedTerms(item, constraints.mustNotUse)
      ).filter(item => item.length > 0);
    }

    if (quality.failedChecks.includes('count') && constraints.n && transformed.items) {
      if (transformed.items.length > constraints.n) {
        transformed.items = transformed.items.slice(0, constraints.n);
      }
    }

    return transformed;
  }

  private removeProhibitedTerms(text: string, prohibited: string[]): string {
    let result = text;
    
    for (const term of prohibited) {
      const regex = new RegExp(`\\b${term}\\b`, 'gi');
      result = result.replace(regex, '');
    }

    return result.replace(/\s+/g, ' ').trim();
  }
}

export const selfHealEngine = new SelfHealEngine();
