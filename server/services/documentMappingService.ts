import { cvTemplates, CvTemplateConfig } from './documentTemplates';
import { cvSpecSchema } from '@shared/documentSpecs';

export function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  
  const isoMatch = dateStr.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (isoMatch) {
    const [, year, month] = isoMatch;
    const monthNames = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];
    const monthIndex = parseInt(month, 10) - 1;
    if (monthIndex >= 0 && monthIndex < 12) {
      return `${monthNames[monthIndex]} ${year}`;
    }
  }
  
  return dateStr;
}

export function formatDateRange(start: string, end: string | null | undefined): string {
  const formattedStart = formatDate(start);
  
  if (!end) {
    return `${formattedStart} - Present`;
  }
  
  const formattedEnd = formatDate(end);
  return `${formattedStart} - ${formattedEnd}`;
}

export function generateSkillDots(proficiency: number, maxLevel: number = 5): string {
  const filled = Math.min(Math.max(0, Math.round(proficiency)), maxLevel);
  const empty = maxLevel - filled;
  return '●'.repeat(filled) + '○'.repeat(empty);
}

export function generateSkillBar(proficiency: number, maxLevel: number = 5): { filled: number; empty: number } {
  const filled = Math.min(Math.max(0, Math.round(proficiency)), maxLevel);
  const empty = maxLevel - filled;
  return { filled, empty };
}

export function selectCvTemplate(style: string): CvTemplateConfig {
  const normalizedStyle = style?.toLowerCase().trim() || 'modern';
  return cvTemplates[normalizedStyle] || cvTemplates.modern;
}

export function validateCvSpec(spec: unknown): { valid: boolean; errors: string[] } {
  const result = cvSpecSchema.safeParse(spec);
  
  if (result.success) {
    return { valid: true, errors: [] };
  }
  
  const errors = result.error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  
  return { valid: false, errors };
}

export function generateSkillPercentage(proficiency: number, maxLevel: number = 5): number {
  return Math.round((proficiency / maxLevel) * 100);
}

export function generateSkillTags(skills: Array<{ name: string; proficiency: number }>): string[] {
  return skills.map(s => s.name);
}
