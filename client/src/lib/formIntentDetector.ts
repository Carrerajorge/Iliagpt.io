/**
 * Form Intent Detector - Detects when user wants to create a Google Form
 * 
 * IMPORTANT: This detector should be VERY conservative to avoid false positives.
 * Only activate Google Forms when there's clear, unambiguous intent.
 */

// Core form-related nouns (strict - only form-specific terms)
const FORM_NOUNS = [
  'formulario', 'formularios', 'encuesta', 'encuestas',
  'cuestionario', 'cuestionarios', 'form', 'forms',
  'quiz', 'quizzes', 'survey', 'surveys'
  // REMOVED: 'preguntas', 'questions', 'respuestas' - too generic
];

// Specific phrases that strongly indicate form creation intent
const FORM_SPECIFIC_PHRASES = [
  'crear formulario', 'generar formulario', 'hacer formulario',
  'crear encuesta', 'generar encuesta', 'hacer encuesta',
  'crear cuestionario', 'generar cuestionario',
  'create form', 'generate form', 'make form',
  'create survey', 'generate survey', 'make quiz',
  'google forms', 'formulario de google', 'formulario google',
  'nuevo formulario', 'nueva encuesta'
];

// Action verbs that indicate creation intent
const FORM_ACTION_VERBS = [
  'crear', 'crea', 'genera', 'generar', 'hacer', 'haz',
  'create', 'generate', 'make', 'build', 'design'
];

// Exclusion patterns - if any match, do NOT trigger form intent
// These are contexts where form-related words appear but user doesn't want a form
const EXCLUSION_PATTERNS = [
  /\bzoom\b/i,
  /\bteams\b/i,
  /\bslack\b/i,
  /\bmeet\b/i,
  /\bcompanion\b/i,
  /\basistente\b/i,
  /\bassistant\b/i,
  /\bresumen\b/i,
  /\bsummary\b/i,
  /\bresume\b/i,
  /\bexplicar?\b/i,
  /\bexplain\b/i,
  /dame un resumen/i,
  /give me a summary/i,
  /qué (es|son|hace)/i,
  /what (is|are|does)/i,
  /cómo funciona/i,
  /how (does|do) .* work/i
];

export interface FormIntentResult {
  hasFormIntent: boolean;
  confidence: 'high' | 'medium' | 'low' | 'none';
  mentionDetected: boolean;
  keywordsFound: string[];
  suggestedAction: 'generate' | 'edit' | 'preview' | 'none';
}

export function detectFormIntent(
  prompt: string,
  isGoogleFormsActive: boolean,
  hasMention: boolean
): FormIntentResult {
  const lowerPrompt = prompt.toLowerCase();

  // Debug logging
  console.log('[FormIntent] Analyzing:', lowerPrompt.substring(0, 80));

  // 1. Check for explicit @GoogleForms mention - highest priority
  if (hasMention || lowerPrompt.includes('@googleforms')) {
    console.log('[FormIntent] Explicit mention detected → high confidence');
    return {
      hasFormIntent: true,
      confidence: 'high',
      mentionDetected: true,
      keywordsFound: ['@GoogleForms'],
      suggestedAction: 'generate'
    };
  }

  // 2. If Google Forms is not active, don't detect form intent
  if (!isGoogleFormsActive) {
    return {
      hasFormIntent: false,
      confidence: 'none',
      mentionDetected: false,
      keywordsFound: [],
      suggestedAction: 'none'
    };
  }

  // 3. Check exclusion patterns FIRST - if any match, reject immediately
  for (const pattern of EXCLUSION_PATTERNS) {
    if (pattern.test(lowerPrompt)) {
      console.log('[FormIntent] Exclusion pattern matched:', pattern.source, '→ rejected');
      return {
        hasFormIntent: false,
        confidence: 'none',
        mentionDetected: false,
        keywordsFound: [],
        suggestedAction: 'none'
      };
    }
  }

  // 4. Check for specific form phrases (strongest signal)
  for (const phrase of FORM_SPECIFIC_PHRASES) {
    if (lowerPrompt.includes(phrase)) {
      console.log('[FormIntent] Specific phrase matched:', phrase, '→ high confidence');
      return {
        hasFormIntent: true,
        confidence: 'high',
        mentionDetected: false,
        keywordsFound: [phrase],
        suggestedAction: 'generate'
      };
    }
  }

  // 5. Check for action verb + form noun combination
  const foundKeywords: string[] = [];
  let hasActionVerb = false;
  let hasFormNoun = false;

  for (const noun of FORM_NOUNS) {
    if (lowerPrompt.includes(noun)) {
      hasFormNoun = true;
      foundKeywords.push(noun);
    }
  }

  for (const verb of FORM_ACTION_VERBS) {
    // Check that verb is followed by form-related content (within reasonable distance)
    const verbIndex = lowerPrompt.indexOf(verb);
    if (verbIndex !== -1) {
      // Check if any form noun is within 30 characters after the verb
      const textAfterVerb = lowerPrompt.substring(verbIndex, verbIndex + 50);
      if (FORM_NOUNS.some(noun => textAfterVerb.includes(noun))) {
        hasActionVerb = true;
        foundKeywords.push(verb);
        break;
      }
    }
  }

  // Require BOTH action verb AND form noun for medium confidence
  if (hasActionVerb && hasFormNoun) {
    console.log('[FormIntent] Action verb + form noun detected:', foundKeywords, '→ medium confidence');
    return {
      hasFormIntent: true,
      confidence: 'medium',
      mentionDetected: false,
      keywordsFound: foundKeywords,
      suggestedAction: 'generate'
    };
  }

  // Just having form noun is low confidence - not enough to trigger
  if (hasFormNoun) {
    console.log('[FormIntent] Only form noun found:', foundKeywords, '→ low confidence (no trigger)');
    return {
      hasFormIntent: false,
      confidence: 'low',
      mentionDetected: false,
      keywordsFound: foundKeywords,
      suggestedAction: 'none'
    };
  }

  return {
    hasFormIntent: false,
    confidence: 'none',
    mentionDetected: false,
    keywordsFound: [],
    suggestedAction: 'none'
  };
}

export function extractMentionFromPrompt(prompt: string): { hasMention: boolean; cleanPrompt: string } {
  const mentionRegex = /@GoogleForms\s*/gi;
  const hasMention = mentionRegex.test(prompt);
  const cleanPrompt = prompt.replace(/@GoogleForms\s*/gi, '').trim();

  return { hasMention, cleanPrompt };
}

