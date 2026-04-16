/**
 * Contradiction Detector
 * 
 * Uses LLM to detect conflicting or contradictory instructions in user prompts.
 */

// Lazy import of OpenAI to avoid initialization errors in test environments
let _openai: any = null;
let _MODELS: any = null;

function getOpenAI() {
    if (!_openai) {
        try {
            const lib = require("../../lib/openai");
            _openai = lib.openai;
            _MODELS = lib.MODELS;
        } catch (e) {
            return null;
        }
    }
    return _openai;
}

function getMODELS() {
    getOpenAI();
    return _MODELS || { TEXT: "grok-3-fast" };
}

const CONTRADICTION_PROMPT = `Analyze the following user request for contradictions or conflicting instructions.

A contradiction exists when:
- Two instructions directly oppose each other (e.g., "make it short" vs "include all details")
- An instruction is given then negated later (e.g., "add X... actually don't add X")
- Impossible requirements are requested (e.g., "make it free but also premium")
- Format conflicts exist (e.g., "output as JSON and also as plain text")

Return a JSON object:
{
  "hasContradictions": boolean,
  "contradictions": [
    {
      "statement1": "first conflicting statement",
      "statement2": "second conflicting statement",
      "description": "explanation of the conflict",
      "severity": "low" | "medium" | "high"
    }
  ],
  "overrides": [
    {
      "original": "original instruction",
      "override": "overriding instruction",
      "description": "explanation"
    }
  ]
}

If no contradictions found, return: {"hasContradictions": false, "contradictions": [], "overrides": []}

User request:
`;

export interface Contradiction {
    statement1: string;
    statement2: string;
    description: string;
    severity: "low" | "medium" | "high";
}

export interface Override {
    original: string;
    override: string;
    description: string;
}

export interface ContradictionResult {
    hasContradictions: boolean;
    contradictions: Contradiction[];
    overrides: Override[];
    error?: string;
}

export class ContradictionDetector {
    async detect(text: string): Promise<ContradictionResult> {
        const openai = getOpenAI();
        const MODELS = getMODELS();

        if (!openai) {
            // Fall back to heuristic if OpenAI not available
            return this.detectHeuristic(text);
        }

        try {
            const response = await openai.chat.completions.create({
                model: MODELS.TEXT,
                messages: [
                    { role: "system", content: CONTRADICTION_PROMPT },
                    { role: "user", content: text }
                ],
                temperature: 0.1,
                max_tokens: 1000,
                response_format: { type: "json_object" }
            });

            const content = response.choices[0]?.message?.content;
            if (!content) {
                return { hasContradictions: false, contradictions: [], overrides: [] };
            }

            const parsed = JSON.parse(content);
            return {
                hasContradictions: parsed.hasContradictions ?? false,
                contradictions: parsed.contradictions || [],
                overrides: parsed.overrides || []
            };

        } catch (error) {
            console.error("[ContradictionDetector] Error:", error);
            return {
                hasContradictions: false,
                contradictions: [],
                overrides: [],
                error: (error as Error).message
            };
        }
    }

    /**
     * Fast heuristic detection (no LLM call)
     */
    detectHeuristic(text: string): ContradictionResult {
        const contradictions: Contradiction[] = [];
        const overrides: Override[] = [];
        const lowerText = text.toLowerCase();

        // Detect override patterns
        const overridePatterns = [
            /actually,?\s*(don't|do not|no)/i,
            /forget (that|what I said|it)/i,
            /ignore (the|my|that|this)/i,
            /instead,?\s/i,
            /on second thought/i,
            /wait,?\s*(no|don't)/i,
            /nevermind/i,
            /scratch that/i,
            /cancel (that|this)/i
        ];

        for (const pattern of overridePatterns) {
            if (pattern.test(text)) {
                overrides.push({
                    original: "Previous instruction",
                    override: text.match(pattern)?.[0] || "Override detected",
                    description: "User changed their mind mid-prompt"
                });
            }
        }

        // Detect direct contradictions
        const contradictionPairs = [
            [/\bshort\b/i, /\b(long|detailed|all|everything|comprehensive)\b/i],
            [/\bsimple\b/i, /\bcomplex\b/i],
            [/\bdon't include\b/i, /\bmust include\b/i],
            [/\bno\s+\w+\b/i, /\badd\s+\w+\b/i],
            [/\bbrief\b/i, /\b(complete|thorough|exhaustive)\b/i],
            [/\bminimal\b/i, /\b(maximum|full|detailed)\b/i]
        ];

        for (const [pattern1, pattern2] of contradictionPairs) {
            const match1 = text.match(pattern1);
            const match2 = text.match(pattern2);
            if (match1 && match2) {
                contradictions.push({
                    statement1: match1[0],
                    statement2: match2[0],
                    description: "Potentially conflicting requirements",
                    severity: "medium"
                });
            }
        }

        return {
            hasContradictions: contradictions.length > 0,
            contradictions,
            overrides
        };
    }
}
