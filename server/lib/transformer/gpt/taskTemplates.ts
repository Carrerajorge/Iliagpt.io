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

// ---------------------------------------------------------------------------
// §3.9.3 SAT Analogies template
// ---------------------------------------------------------------------------

export interface SatAnalogyChoice {
  label: string; // e.g. "a", "b", "c", "d", "e"
  left: string;
  right: string;
}

export interface SatAnalogyExample {
  /** The source analogy: "Audacious is to boldness". */
  sourceLeft: string;
  sourceRight: string;
  /** The five candidate continuations. */
  choices: SatAnalogyChoice[];
  /** The correct choice label (must match one of `choices[].label`). */
  answer: string;
}

export interface SatAnalogyTemplateInput {
  examples: SatAnalogyExample[];
  query: {
    sourceLeft: string;
    sourceRight: string;
    choices: SatAnalogyChoice[];
  };
  tokenize: TokenizeFn;
}

function renderSatAnalogyBlock(
  sourceLeft: string,
  sourceRight: string,
  choices: SatAnalogyChoice[],
): string {
  const header = `${sourceLeft} is to ${sourceRight} as`;
  const lines = choices.map(
    (c) => `(${c.label}) ${c.left} is to ${c.right}`,
  );
  return [header, ...lines].join("\n");
}

/**
 * §3.9.3 SAT analogies task (Brown et al. 2020).
 *
 * Paper format (verbatim from Appendix G):
 *
 *     Audacious is to boldness as
 *     (a) sanctimonious is to hypocrisy
 *     (b) anonymous is to identity
 *     (c) remorseful is to misdeed
 *     (d) deleterious is to result
 *     (e) impressionable is to temptation
 *     Answer: a
 *
 * The template renders each demonstration as a full analogy block
 * followed by `Answer: <letter>`, then the query analogy followed by
 * a bare `Answer: ` primer for the model to complete.
 */
export function satAnalogyPrompt(
  input: SatAnalogyTemplateInput,
): BuiltInContextPrompt {
  const { tokenize } = input;
  const examples: InContextExample[] = input.examples.map((ex) => ({
    input: tokenize(
      renderSatAnalogyBlock(ex.sourceLeft, ex.sourceRight, ex.choices),
    ),
    output: tokenize(ex.answer),
  }));
  return buildInContextPrompt({
    taskDescription: [],
    examples,
    query: tokenize(
      renderSatAnalogyBlock(
        input.query.sourceLeft,
        input.query.sourceRight,
        input.query.choices,
      ),
    ),
    inputOutputSeparator: tokenize("\nAnswer: "),
    exampleSeparator: tokenize("\n\n"),
  });
}

// ---------------------------------------------------------------------------
// §3.9.4 News Article Generation template
// ---------------------------------------------------------------------------

export interface NewsArticleExample {
  title: string;
  /** Optional subtitle / kicker. Paper uses "(AI-generated)" or similar. */
  subtitle?: string;
  /** Full body text — paper shows a few-sentence news paragraph. */
  body: string;
}

export interface NewsArticleTemplateInput {
  examples: NewsArticleExample[];
  /** Query title the model should generate an article for. */
  queryTitle: string;
  querySubtitle?: string;
  tokenize: TokenizeFn;
}

function renderNewsArticleInput(title: string, subtitle?: string): string {
  return subtitle ? `Title: ${title}\nSubtitle: ${subtitle}` : `Title: ${title}`;
}

/**
 * §3.9.4 news article generation template (Brown et al. 2020).
 *
 * The paper evaluates GPT-3's ability to generate news articles so
 * realistic that humans can't distinguish them from human-written
 * articles. The prompt format pairs each demonstration title (and
 * optional subtitle) with the full article body, separated by an
 * `Article: ` marker.
 *
 *     Title: Samsung unveils ...
 *     Article: SAN FRANCISCO — Samsung said on Tuesday ...
 *
 *     Title: <query>
 *     Article:
 */
export function newsArticlePrompt(
  input: NewsArticleTemplateInput,
): BuiltInContextPrompt {
  const { tokenize } = input;
  return buildInContextPrompt({
    taskDescription: [],
    examples: input.examples.map((ex) => ({
      input: tokenize(renderNewsArticleInput(ex.title, ex.subtitle)),
      output: tokenize(ex.body),
    })),
    query: tokenize(renderNewsArticleInput(input.queryTitle, input.querySubtitle)),
    inputOutputSeparator: tokenize("\nArticle: "),
    exampleSeparator: tokenize("\n\n"),
  });
}

// ---------------------------------------------------------------------------
// §3.9.5 Learning and Using Novel Words template
// ---------------------------------------------------------------------------

export interface NovelWordExample {
  /** The made-up word, e.g. "whatpu". */
  word: string;
  /** The definition, e.g. "a small, furry animal native to Tanzania". */
  definition: string;
  /** A natural-sounding sentence using the word. */
  exampleSentence: string;
}

export interface NovelWordTemplateInput {
  examples: NovelWordExample[];
  /** The novel word the model must *use* in a new sentence. */
  queryWord: string;
  queryDefinition: string;
  tokenize: TokenizeFn;
}

/**
 * §3.9.5 "Learning and Using Novel Words" template.
 *
 * Paper's famous example (verbatim from §3.9.5):
 *
 *     A "whatpu" is a small, furry animal native to Tanzania. An
 *     example of a sentence that uses the word whatpu is:
 *     We were traveling in Africa and we saw these very cute whatpus.
 *
 *     A "farduddle" means to jump up and down really fast. An example
 *     of a sentence that uses the word farduddle is:
 *
 * The model then generates a one-shot usage of the made-up word. The
 * template renders the paper's exact phrasing — `A "<word>" <def>.
 * An example of a sentence that uses the word <word> is:` — so there
 * is no parameter to configure on the separators.
 */
export function novelWordPrompt(
  input: NovelWordTemplateInput,
): BuiltInContextPrompt {
  const { tokenize } = input;
  const renderStem = (word: string, definition: string): string =>
    `A "${word}" ${definition}. An example of a sentence that uses the word ${word} is:`;
  return buildInContextPrompt({
    taskDescription: [],
    examples: input.examples.map((ex) => ({
      input: tokenize(renderStem(ex.word, ex.definition)),
      output: tokenize(ex.exampleSentence),
    })),
    query: tokenize(renderStem(input.queryWord, input.queryDefinition)),
    // The paper renders the example sentence on a new line immediately
    // after the stem — so the "input→output separator" is just "\n".
    inputOutputSeparator: tokenize("\n"),
    exampleSeparator: tokenize("\n\n"),
  });
}

// ---------------------------------------------------------------------------
// §3.9.6 English Grammar Correction template
// ---------------------------------------------------------------------------

export interface GrammarCorrectionExample {
  /** The ill-formed input. */
  poor: string;
  /** The grammatically corrected output. */
  good: string;
}

export interface GrammarCorrectionTemplateInput {
  examples: GrammarCorrectionExample[];
  query: string;
  tokenize: TokenizeFn;
}

/**
 * §3.9.6 English grammar correction template. Paper format:
 *
 *     Poor English input: I eated the purple berries.
 *     Good English output: I ate the purple berries.
 *
 *     Poor English input: <query>
 *     Good English output:
 *
 * Each demonstration is a (Poor, Good) pair, separated from the next
 * by a blank line. The task exercises the model's grammatical-fluency
 * prior without any task-specific fine-tuning.
 */
export function grammarCorrectionPrompt(
  input: GrammarCorrectionTemplateInput,
): BuiltInContextPrompt {
  const { tokenize } = input;
  return buildInContextPrompt({
    taskDescription: [],
    examples: input.examples.map((ex) => ({
      input: tokenize(`Poor English input: ${ex.poor}`),
      output: tokenize(ex.good),
    })),
    query: tokenize(`Poor English input: ${input.query}`),
    inputOutputSeparator: tokenize("\nGood English output: "),
    exampleSeparator: tokenize("\n\n"),
  });
}
