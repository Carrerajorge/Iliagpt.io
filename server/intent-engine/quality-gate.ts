import { 
  QualityCheckResult, 
  QualityCheck, 
  Constraints, 
  StructuredOutput,
  PipelineContext 
} from './types';

const DOMAIN_BLACKLIST: Record<string, string[]> = {
  marketing: ['docente', 'aula', 'escolar', 'educativo', 'estudiante', 'colegio', 'universidad', 'académico'],
  academic: ['ventas', 'promoción', 'descuento', 'oferta', 'cliente', 'compra'],
  business: ['aula', 'escolar', 'estudiante', 'profesor', 'examen'],
  technology: [],
  education: ['ventas', 'promoción', 'descuento', 'marketing'],
  general: []
};

export class QualityGate {
  verify(output: StructuredOutput, constraints: Constraints, context: PipelineContext): QualityCheckResult {
    const checks: QualityCheck[] = [];

    checks.push(this.checkCount(output, constraints));
    checks.push(this.checkProhibitedTerms(output, constraints));
    checks.push(this.checkDomainDrift(output, constraints));
    checks.push(this.checkRequiredTerms(output, constraints));
    checks.push(this.checkLanguage(output, constraints));
    checks.push(this.checkFormat(output, constraints));

    const failedChecks = checks
      .filter(c => !c.passed && c.severity === 'error')
      .map(c => c.name);

    const warningChecks = checks
      .filter(c => !c.passed && c.severity === 'warning')
      .map(c => c.name);

    const passedCount = checks.filter(c => c.passed).length;
    const score = passedCount / checks.length;

    return {
      passed: failedChecks.length === 0,
      checks,
      failedChecks: [...failedChecks, ...warningChecks],
      score
    };
  }

  private checkCount(output: StructuredOutput, constraints: Constraints): QualityCheck {
    if (!constraints.n) {
      return { name: 'count', passed: true, severity: 'info', message: 'No count constraint' };
    }

    let actualCount = 0;
    
    if (output.items) {
      actualCount = output.items.length;
    } else if (output.sections) {
      actualCount = output.sections.length;
    }

    const passed = actualCount === constraints.n;
    
    return {
      name: 'count',
      passed,
      severity: 'error',
      message: passed 
        ? `Count matches: ${actualCount}` 
        : `Expected ${constraints.n}, got ${actualCount}`
    };
  }

  private checkProhibitedTerms(output: StructuredOutput, constraints: Constraints): QualityCheck {
    if (constraints.mustNotUse.length === 0) {
      return { name: 'prohibited_terms', passed: true, severity: 'info', message: 'No prohibited terms' };
    }

    const content = this.flattenOutput(output).toLowerCase();
    const violations: string[] = [];

    for (const term of constraints.mustNotUse) {
      const termLower = term.toLowerCase();
      if (content.includes(termLower)) {
        violations.push(term);
      }
      
      const variations = this.getTermVariations(termLower);
      for (const variation of variations) {
        if (content.includes(variation)) {
          violations.push(term);
          break;
        }
      }
    }

    const uniqueViolations = [...new Set(violations)];
    const passed = uniqueViolations.length === 0;

    return {
      name: 'prohibited_terms',
      passed,
      severity: 'error',
      message: passed 
        ? 'No prohibited terms found' 
        : `Found prohibited terms: ${uniqueViolations.join(', ')}`
    };
  }

  private checkDomainDrift(output: StructuredOutput, constraints: Constraints): QualityCheck {
    const blacklist = DOMAIN_BLACKLIST[constraints.domain] || [];
    if (blacklist.length === 0) {
      return { name: 'domain_drift', passed: true, severity: 'info', message: 'No domain blacklist' };
    }

    const content = this.flattenOutput(output).toLowerCase();
    const violations: string[] = [];

    for (const term of blacklist) {
      if (content.includes(term.toLowerCase())) {
        violations.push(term);
      }
    }

    const passed = violations.length === 0;

    return {
      name: 'domain_drift',
      passed,
      severity: 'warning',
      message: passed 
        ? 'Content stays within domain' 
        : `Possible domain drift: found "${violations.join(', ')}" (expected domain: ${constraints.domain})`
    };
  }

  private checkRequiredTerms(output: StructuredOutput, constraints: Constraints): QualityCheck {
    if (constraints.mustKeep.length === 0) {
      return { name: 'required_terms', passed: true, severity: 'info', message: 'No required terms' };
    }

    const content = this.flattenOutput(output).toLowerCase();
    const missing: string[] = [];

    for (const term of constraints.mustKeep) {
      const termLower = term.toLowerCase();
      const found = content.includes(termLower) || 
                   this.getTermVariations(termLower).some(v => content.includes(v));
      
      if (!found) {
        missing.push(term);
      }
    }

    const passed = missing.length === 0;

    return {
      name: 'required_terms',
      passed,
      severity: 'warning',
      message: passed 
        ? 'All required terms present' 
        : `Missing required terms: ${missing.join(', ')}`
    };
  }

  private checkLanguage(output: StructuredOutput, constraints: Constraints): QualityCheck {
    const content = this.flattenOutput(output);
    
    const spanishIndicators = ['el', 'la', 'los', 'las', 'de', 'en', 'que', 'para', 'con', 'por'];
    const englishIndicators = ['the', 'is', 'are', 'and', 'to', 'of', 'in', 'for', 'with', 'on'];
    
    const words = content.toLowerCase().split(/\s+/);
    let spanishCount = 0;
    let englishCount = 0;

    for (const word of words) {
      if (spanishIndicators.includes(word)) spanishCount++;
      if (englishIndicators.includes(word)) englishCount++;
    }

    const detectedLang = spanishCount >= englishCount ? 'es' : 'en';
    const passed = detectedLang === constraints.language;

    return {
      name: 'language',
      passed,
      severity: 'warning',
      message: passed 
        ? `Language matches: ${constraints.language}` 
        : `Expected ${constraints.language}, detected ${detectedLang}`
    };
  }

  private checkFormat(output: StructuredOutput, constraints: Constraints): QualityCheck {
    let passed = true;
    let message = 'Format is correct';

    switch (constraints.format) {
      case 'list':
        passed = !!output.items && output.items.length > 0;
        message = passed ? 'List format correct' : 'Expected list format';
        break;
      case 'structured':
        passed = !!output.sections || !!output.metadata;
        message = passed ? 'Structured format correct' : 'Expected structured format';
        break;
      default:
        passed = true;
    }

    return {
      name: 'format',
      passed,
      severity: 'warning',
      message
    };
  }

  private flattenOutput(output: StructuredOutput): string {
    const parts: string[] = [];

    if (output.content) {
      parts.push(output.content);
    }

    if (output.items) {
      parts.push(...output.items);
    }

    if (output.sections) {
      const flattenSections = (sections: typeof output.sections): string[] => {
        const result: string[] = [];
        for (const section of sections || []) {
          result.push(section.title);
          if (section.subsections) {
            result.push(...flattenSections(section.subsections));
          }
        }
        return result;
      };
      parts.push(...flattenSections(output.sections));
    }

    return parts.join(' ');
  }

  private getTermVariations(term: string): string[] {
    const variations: string[] = [];
    
    if (term === 'ia' || term === 'i.a.') {
      variations.push('inteligencia artificial', 'ai', 'a.i.', 'machine learning', 'ml');
    }
    
    if (term === 'inteligencia artificial') {
      variations.push('ia', 'i.a.', 'ai', 'a.i.');
    }

    return variations;
  }
}

export const qualityGate = new QualityGate();
