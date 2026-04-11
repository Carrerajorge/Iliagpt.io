/**
 * Canonical task prompt templates from Appendix G + §3.9 of Brown et
 * al. 2020.
 *
 * The paper documents the EXACT prompt format used for each of its
 * headline benchmarks. Re-inventing these by hand every time is both
 * error-prone and paper-unfaithful, so we ship a small library of
 * template helpers that produce a `BuiltInContextPrompt` ready to
 * feed into `gptGenerate`.
 *
 * Every template follows the same pattern:
 *
 *   1. Convert the structured task inputs (operands, words, etc.)
 *      into arrays of token ids using a caller-provided tokenizer
 *      callback.
 *   2. Call `buildInContextPrompt` with the canonical separators.
 *
 * The tokenizer callback keeps us tokenizer-agnostic — in production
 * you'd plug in a real BPE; in tests you can use a deterministic
 * per-character stand-in. Either way the template's structure (the
 * thing the paper specifies) stays identical.
 *
 * Tasks covered:
 *
 *   • §3.9.1 Arithmetic — "Q: What is X + Y? A: " pattern
 *   • §3.9.2 Word scrambling — "skicts = sticks" pattern
 *   • §3.1 LAMBADA-style cloze completion
 *   • Figure 2.1 English → French translation (and generalizable
 *     to any language pair)
 */

import {
  type BuiltInContextPrompt,
  type InContextExample,
  buildInContextPrompt,
} from "./inContextLearning";

// ---------------------------------------------------------------------------
// Tokenizer contract
// ---------------------------------------------------------------------------

/**
 * Minimal tokenizer callback. Given a string, return a sequence of
 * non-negative integer token ids that a GPT-style model can consume.
 *
 * Callers pass whichever tokenizer they like — BPE, WordPiece, the
 * per-character stand-in used in tests, etc. The only contract is
 * "string → number[]".
 */
export type TokenizeFn = (text: string) => number[];

// ---------------------------------------------------------------------------
// §3.9.1 Arithmetic template
// ---------------------------------------------------------------------------

/**
 * Arithmetic operation supported by the §3.9.1 template. Maps to the
 * paper's exact phrasing: "plus", "minus", "times".
 */
export type ArithmeticOp = "+" | "-" | "*";

function arithmeticOpPhrase(op: ArithmeticOp): string {
  switch (op) {
    case "+":
      return "plus";
    case "-":
      return "minus";
    case "*":
      return "times";
  }
}

export interface ArithmeticExample {
  a: number;
  b: number;
  op: ArithmeticOp;
  /** The gold answer — used as the demonstration completion. */
  answer: number;
}

export interface ArithmeticTemplateInput {
  /** K few-shot demonstrations; can be empty for zero-shot. */
  examples: ArithmeticExample[];
  /** The query the model must complete. */
  query: { a: number; b: number; op: ArithmeticOp };
  /** Tokenizer callback. */
  tokenize: TokenizeFn;
}

/**
 * §3.9.1 arithmetic prompt template. Matches the exact phrasing the
 * paper uses:
 *
 *     Q: What is 48 plus 76?
 *     A: 124
 *
 * The template calls `buildInContextPrompt` with:
 *   - taskDescription = empty
 *   - inputOutputSeparator = "\nA: "
 *   - exampleSeparator    = "\n\n"
 *
 * These match Table G.1 / G.2 of the paper for the arithmetic task.
 */
export function arithmeticPrompt(input: ArithmeticTemplateInput): BuiltInContextPrompt {
  const { tokenize } = input;
  const formatQuestion = (a: number, b: number, op: ArithmeticOp): string =>
    `Q: What is ${a} ${arithmeticOpPhrase(op)} ${b}?`;
  const examples: InContextExample[] = input.examples.map((ex) => ({
    input: tokenize(formatQuestion(ex.a, ex.b, ex.op)),
    output: tokenize(String(ex.answer)),
  }));
  return buildInContextPrompt({
    taskDescription: [],
    examples,
    query: tokenize(formatQuestion(input.query.a, input.query.b, input.query.op)),
    inputOutputSeparator: tokenize("\nA: "),
    exampleSeparator: tokenize("\n\n"),
  });
}

// ---------------------------------------------------------------------------
// §3.9.2 Word scrambling template
// ---------------------------------------------------------------------------

export interface WordScramblingExample {
  /** The scrambled letters. */
  scrambled: string;
  /** The gold unscrambled word. */
  unscrambled: string;
}

export interface WordScramblingTemplateInput {
  examples: WordScramblingExample[];
  query: string; // the scrambled word to unscramble
  tokenize: TokenizeFn;
}

/**
 * §3.9.2 word scrambling prompt template. Paper format:
 *
 *     Please unscramble the letters into a word, and write that word:
 *     skicts = sticks
 *     pciinc = picnic
 *     ...
 *     asinol =
 *
 * The task description explains the task; each demonstration is
 * separated by a newline, and `" = "` sits between input and output.
 */
export function wordScramblingPrompt(
  input: WordScramblingTemplateInput,
): BuiltInContextPrompt {
  const { tokenize } = input;
  return buildInContextPrompt({
    taskDescription: tokenize(
      "Please unscramble the letters into a word, and write that word:",
    ),
    taskDescriptionSeparator: tokenize("\n"),
    examples: input.examples.map((ex) => ({
      input: tokenize(ex.scrambled),
      output: tokenize(ex.unscrambled),
    })),
    query: tokenize(input.query),
    inputOutputSeparator: tokenize(" = "),
    exampleSeparator: tokenize("\n"),
  });
}

// ---------------------------------------------------------------------------
// §3.1 LAMBADA-style cloze completion
// ---------------------------------------------------------------------------

export interface ClozeExample {
  /** The passage with the final word elided. */
  passage: string;
  /** The gold final word. */
  answer: string;
}

export interface ClozeTemplateInput {
  /** Optional few-shot demonstrations (same shape as the query). */
  examples: ClozeExample[];
  /** The passage the model must complete. */
  passage: string;
  tokenize: TokenizeFn;
}

/**
 * LAMBADA-style cloze completion template (§3.1.1 of the paper).
 *
 * Format (matches the paper's "fill-in-the-blank" convention for
 * LAMBADA under few-shot):
 *
 *     Alice was friends with Bob. Alice went to visit her friend ____ . → Bob
 *     ...
 *     The passage ____ . →
 */
export function clozePrompt(input: ClozeTemplateInput): BuiltInContextPrompt {
  const { tokenize } = input;
  return buildInContextPrompt({
    taskDescription: [],
    examples: input.examples.map((ex) => ({
      input: tokenize(ex.passage),
      output: tokenize(ex.answer),
    })),
    query: tokenize(input.passage),
    inputOutputSeparator: tokenize(" → "),
    exampleSeparator: tokenize("\n"),
  });
}

// ---------------------------------------------------------------------------
// Figure 2.1 translation template
// ---------------------------------------------------------------------------

export interface TranslationExample {
  sourceText: string;
  targetText: string;
}

export interface TranslationTemplateInput {
  /** The source language, used in the task description. */
  sourceLanguage: string;
  /** The target language, used in the task description. */
  targetLanguage: string;
  /** K demonstration pairs. */
  examples: TranslationExample[];
  /** The source-language phrase the model should translate. */
  query: string;
  tokenize: TokenizeFn;
}

/**
 * Figure 2.1 translation template. Paper shows the exact form:
 *
 *     Translate English to French:
 *     sea otter => loutre de mer
 *     peppermint => menthe poivrée
 *     plush giraffe => girafe peluche
 *     cheese =>
 *
 * The task description is dynamically built from the (source, target)
 * pair so the same helper works for any language combination.
 */
export function translationPrompt(
  input: TranslationTemplateInput,
): BuiltInContextPrompt {
  const { tokenize } = input;
  const taskDescription = tokenize(
    `Translate ${input.sourceLanguage} to ${input.targetLanguage}:`,
  );
  return buildInContextPrompt({
    taskDescription,
    taskDescriptionSeparator: tokenize("\n"),
    examples: input.examples.map((ex) => ({
      input: tokenize(ex.sourceText),
      output: tokenize(ex.targetText),
    })),
    query: tokenize(input.query),
    inputOutputSeparator: tokenize(" => "),
    exampleSeparator: tokenize("\n"),
  });
}
