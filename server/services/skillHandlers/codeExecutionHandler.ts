/**
 * Code Execution Skill Handler
 *
 * Handles code execution requests for Python and JavaScript.
 * Python runs in a sandboxed environment; JavaScript uses Node.js vm module.
 */

import { safeExecutePython } from '../pythonSandbox';
import { llmGateway } from '../../lib/llmGateway';
import * as vm from 'vm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SkillHandlerResult {
  handled: boolean;
  skillId: string;
  skillName: string;
  category: string;
  artifacts: Array<{
    type: string;
    filename: string;
    buffer: Buffer;
    mimeType: string;
    size: number;
    metadata?: Record<string, unknown>;
  }>;
  textResponse: string;
  suggestions?: string[];
}

interface SkillHandlerRequest {
  message: string;
  userId: string;
  chatId: string;
  locale: string;
  attachments?: Array<{ name?: string; mimeType?: string; storagePath?: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function errorResult(errorMsg: string): SkillHandlerResult {
  return {
    handled: false,
    skillId: 'code-execution',
    skillName: 'Code Execution',
    category: 'code',
    artifacts: [],
    textResponse: `I was unable to execute the code. ${errorMsg}`,
  };
}

/**
 * Extract code from a message. Looks for fenced code blocks first,
 * then falls back to treating the entire message as code.
 */
function extractCode(message: string, language: string): string | null {
  // Try fenced code blocks: ```python ... ``` or ```js ... ```
  const langAliases: Record<string, string[]> = {
    python: ['python', 'py'],
    javascript: ['javascript', 'js', 'node'],
  };

  const aliases = langAliases[language] ?? [language];

  for (const alias of aliases) {
    const regex = new RegExp(`\`\`\`${alias}\\s*\\n([\\s\\S]*?)\`\`\``, 'i');
    const match = message.match(regex);
    if (match?.[1]) return match[1].trim();
  }

  // Try generic fenced block
  const genericMatch = message.match(/```\s*\n([\s\S]*?)```/);
  if (genericMatch?.[1]) return genericMatch[1].trim();

  return null;
}

function detectLanguage(message: string): 'python' | 'javascript' | null {
  const lower = message.toLowerCase();
  if (/\bpython\b|\bpy\b/.test(lower)) return 'python';
  if (/\bjavascript\b|\bjs\b|\bnode\b/.test(lower)) return 'javascript';
  // Heuristics based on syntax
  if (/\bdef\s+\w+|import\s+\w+|print\s*\(/.test(message)) return 'python';
  if (/\bfunction\s+\w+|\bconsole\.log|const\s+\w+\s*=|let\s+\w+\s*=/.test(message)) return 'javascript';
  return null;
}

async function generateCodeWithLLM(
  userMessage: string,
  language: string,
  userId: string,
): Promise<string> {
  const response = await llmGateway.chat(
    [
      {
        role: 'system',
        content: `You are an expert ${language} programmer. Based on the user's request, write ${language} code that accomplishes the task. The code will be executed in a sandboxed environment. For Python, use print() for output. For JavaScript, use console.log() for output. Respond ONLY with the code, no markdown fences, no explanation.`,
      },
      { role: 'user', content: userMessage },
    ],
    { model: 'gpt-4o-mini', userId },
  );
  return response.content.replace(/```[\w]*\n?/g, '').replace(/```/g, '').trim();
}

// ---------------------------------------------------------------------------
// JavaScript sandbox execution
// ---------------------------------------------------------------------------

const JS_EXECUTION_TIMEOUT = 10_000; // 10 seconds

function executeJavaScript(code: string): { output: string; error?: string } {
  const logs: string[] = [];
  const sandbox = {
    console: {
      log: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
      warn: (...args: unknown[]) => logs.push('[warn] ' + args.map(String).join(' ')),
      error: (...args: unknown[]) => logs.push('[error] ' + args.map(String).join(' ')),
    },
    setTimeout: undefined,
    setInterval: undefined,
    setImmediate: undefined,
    process: undefined,
    require: undefined,
    __filename: undefined,
    __dirname: undefined,
    Buffer: Buffer,
    Math,
    Date,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Map,
    Set,
    Promise,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,
  };

  try {
    const context = vm.createContext(sandbox);
    const script = new vm.Script(code, { filename: 'user-code.js' });
    const result = script.runInContext(context, { timeout: JS_EXECUTION_TIMEOUT });

    // If the script returns a value and nothing was logged, capture the return value
    if (logs.length === 0 && result !== undefined) {
      logs.push(typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result));
    }

    return { output: logs.join('\n') || '(no output)' };
  } catch (err: any) {
    return {
      output: logs.join('\n'),
      error: err?.message ?? 'JavaScript execution failed.',
    };
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function handleCodeExecution(
  request: SkillHandlerRequest,
): Promise<SkillHandlerResult> {
  try {
    // Detect the language
    const language = detectLanguage(request.message) ?? 'python';

    // Extract or generate code
    let code = extractCode(request.message, language);
    let codeWasGenerated = false;

    if (!code) {
      // No code block found; ask LLM to generate code from the request
      code = await generateCodeWithLLM(request.message, language, request.userId);
      codeWasGenerated = true;
    }

    // Execute based on language
    let executionOutput: string;
    let executionError: string | undefined;
    const executionStart = Date.now();

    if (language === 'python') {
      const result = await safeExecutePython(code, undefined, 30_000);
      executionOutput = result.output;
      executionError = result.error;
    } else {
      const result = executeJavaScript(code);
      executionOutput = result.output;
      executionError = result.error;
    }

    const executionTimeMs = Date.now() - executionStart;

    // Build artifacts
    const artifacts: SkillHandlerResult['artifacts'] = [];

    // Always include the source code as an artifact
    const codeExt = language === 'python' ? 'py' : 'js';
    const codeMime = language === 'python' ? 'text/x-python' : 'application/javascript';
    const codeBuffer = Buffer.from(code, 'utf-8');

    artifacts.push({
      type: 'code',
      filename: `code_${timestamp()}.${codeExt}`,
      buffer: codeBuffer,
      mimeType: codeMime,
      size: codeBuffer.length,
      metadata: { language, generatedAt: new Date().toISOString() },
    });

    // If there is substantial output, also include it as a text file
    if (executionOutput.length > 200) {
      const outputBuffer = Buffer.from(executionOutput, 'utf-8');
      artifacts.push({
        type: 'output',
        filename: `output_${timestamp()}.txt`,
        buffer: outputBuffer,
        mimeType: 'text/plain',
        size: outputBuffer.length,
        metadata: { generatedAt: new Date().toISOString() },
      });
    }

    // Build response text
    const codeLabel = codeWasGenerated ? 'Generated and executed' : 'Executed';
    const langLabel = language === 'python' ? 'Python' : 'JavaScript';

    let textResponse: string;

    if (executionError) {
      textResponse = [
        `**${codeLabel} ${langLabel} code** (completed in ${executionTimeMs}ms)`,
        '',
        '**Error:**',
        '```',
        executionError,
        '```',
        executionOutput ? '\n**Partial output:**\n```\n' + executionOutput.slice(0, 2000) + '\n```' : '',
      ]
        .filter(Boolean)
        .join('\n');
    } else {
      const outputPreview = executionOutput.length > 2000
        ? executionOutput.slice(0, 2000) + '\n... (truncated, full output in attached file)'
        : executionOutput;

      textResponse = [
        `**${codeLabel} ${langLabel} code** (completed in ${executionTimeMs}ms)`,
        '',
        '**Output:**',
        '```',
        outputPreview,
        '```',
      ].join('\n');
    }

    return {
      handled: true,
      skillId: 'code-execution',
      skillName: `${langLabel} Code Execution`,
      category: 'code',
      artifacts,
      textResponse,
      suggestions: [
        'Modify the code and run again',
        `Explain this ${langLabel} code`,
        'Save the output as a CSV file',
        'Visualize the results',
      ],
    };
  } catch (error: any) {
    console.warn('[SkillHandler:codeExecution]', error);
    return errorResult(error?.message ?? 'An unexpected error occurred.');
  }
}
