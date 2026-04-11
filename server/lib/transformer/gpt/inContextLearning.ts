/**
 * In-context learning prompt formatting and evaluation (§2 + §3 of
 * Brown et al. 2020 — "Language Models are Few-Shot Learners").
 *
 * This is the main *conceptual* contribution of the GPT-3 paper: a
 * single pre-trained language model is evaluated on many downstream
 * tasks WITHOUT any parameter updates, purely by conditioning on a
 * prompt that contains a short task description and zero, one, or
 * several worked examples.
 *
 * From §2:
 *
 *   Zero-shot : the task description and the query, no examples.
 *   One-shot  : the task description, ONE demonstration, and the query.
 *   Few-shot  : the task description, K demonstrations (typically
 *               K ∈ [10, 100]), and the query.
 *
 * Figure 2.1 of the paper shows the exact "Translate English to
 * French" example, structured as:
 *
 *     Translate English to French:             ← task description
 *     sea otter => loutre de mer                ← demonstration 1
 *     peppermint => menthe poivrée               ← demonstration 2
 *     plush giraffe => girafe peluche            ← demonstration 3
 *     cheese =>                                  ← query
 *
 * We codify this canonical shape so callers don't re-invent it every
 * time they run an in-context task.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One demonstration pair. `input` is the task input (e.g., an English
 * word) and `output` is the gold completion (e.g., its French
 * translation). Both are arrays of token ids — tokenization is the
 * caller's problem.
 */
export interface InContextExample {
  input: number[];
  output: number[];
}

/** Which in-context learning regime to use. */
export type InContextMode = "zero-shot" | "one-shot" | "few-shot";

/**
 * Full in-context prompt spec. The three "separator" tokens are
 * explicit so callers can adopt whichever tokenizer-specific
 * representation they like (e.g., "=>" and "\n" → specific BPE ids).
 *
 * Shape of the rendered prompt:
 *
 *   taskDescription
 *   ↵
 *   example1.input inputOutputSeparator example1.output exampleSeparator
 *   example2.input inputOutputSeparator example2.output exampleSeparator
 *   ...
 *   query inputOutputSeparator
 */
export interface InContextPromptSpec {
  /** Task description preamble (may be empty). */
  taskDescription: number[];
  /** K demonstration pairs. Empty for zero-shot. */
  examples: InContextExample[];
  /** The actual input the model should complete. */
  query: number[];
  /** Token(s) that sit between input and output (e.g., BPE of " => "). */
  inputOutputSeparator: number[];
  /** Token(s) that sit between successive examples (e.g., BPE of "\n"). */
  exampleSeparator: number[];
  /** Token(s) between the task description and the first example. */
  taskDescriptionSeparator?: number[];
}

export interface BuiltInContextPrompt {
  /** The final flat token id sequence, ready to feed into `gptGenerate`. */
  tokenIds: number[];
  /** Which mode was used (derived from `examples.length`). */
  mode: InContextMode;
  /** How many demonstration pairs were included. */
  numExamples: number;
}

// ---------------------------------------------------------------------------
// Mode helpers
// ---------------------------------------------------------------------------

export function inContextModeOf(numExamples: number): InContextMode {
  if (numExamples === 0) return "zero-shot";
  if (numExamples === 1) return "one-shot";
  return "few-shot";
}

/**
 * Enforce that the example count matches the declared mode. Returns
 * silently on success and throws on mismatch.
 */
export function assertInContextMode(
  mode: InContextMode,
  numExamples: number,
): void {
  const actual = inContextModeOf(numExamples);
  if (actual !== mode) {
    throw new Error(
      `assertInContextMode: declared mode "${mode}" but got ${numExamples} examples (→ "${actual}")`,
    );
  }
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/**
 * Render an in-context learning prompt into a flat token id sequence
 * following the Figure 2.1 shape of the paper. The result can be fed
 * directly into `gptGenerate` as the prompt.
 */
export function buildInContextPrompt(spec: InContextPromptSpec): BuiltInContextPrompt {
  const tokenIds: number[] = [];
  // Task description
  for (const t of spec.taskDescription) tokenIds.push(t);
  if (spec.taskDescriptionSeparator && spec.taskDescription.length > 0) {
    for (const t of spec.taskDescriptionSeparator) tokenIds.push(t);
  }
  // Demonstrations
  for (let k = 0; k < spec.examples.length; k++) {
    const ex = spec.examples[k];
    for (const t of ex.input) tokenIds.push(t);
    for (const t of spec.inputOutputSeparator) tokenIds.push(t);
    for (const t of ex.output) tokenIds.push(t);
    for (const t of spec.exampleSeparator) tokenIds.push(t);
  }
  // Query
  for (const t of spec.query) tokenIds.push(t);
  for (const t of spec.inputOutputSeparator) tokenIds.push(t);

  return {
    tokenIds,
    mode: inContextModeOf(spec.examples.length),
    numExamples: spec.examples.length,
  };
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Throw if any demonstration references a token id outside the vocab.
 * Saves a trip through `gptGenerate` that would otherwise produce a
 * hard-to-debug embedding lookup error deep in the stack.
 */
export function validateInContextPrompt(
  spec: InContextPromptSpec,
  vocabSize: number,
): void {
  const checkSeq = (seq: number[], label: string): void => {
    for (let i = 0; i < seq.length; i++) {
      const id = seq[i];
      if (!Number.isInteger(id) || id < 0 || id >= vocabSize) {
        throw new Error(
          `validateInContextPrompt: ${label}[${i}] = ${id} out of vocab [0, ${vocabSize})`,
        );
      }
    }
  };
  checkSeq(spec.taskDescription, "taskDescription");
  if (spec.taskDescriptionSeparator) checkSeq(spec.taskDescriptionSeparator, "taskDescriptionSeparator");
  checkSeq(spec.inputOutputSeparator, "inputOutputSeparator");
  checkSeq(spec.exampleSeparator, "exampleSeparator");
  spec.examples.forEach((ex, k) => {
    checkSeq(ex.input, `examples[${k}].input`);
    checkSeq(ex.output, `examples[${k}].output`);
  });
  checkSeq(spec.query, "query");
}
