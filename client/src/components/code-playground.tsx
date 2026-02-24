/**
 * Code Playground Component - ILIAGPT PRO 3.0
 * 
 * Interactive code editor with live execution.
 * Supports multiple languages and real-time output.
 */

import React, { useState, useCallback, useRef, useEffect } from "react";
import { usePlatformSettings } from "@/contexts/PlatformSettingsContext";
import { formatZonedTime, normalizeTimeZone } from "@/lib/platformDateTime";

// ============== Types ==============

export interface PlaygroundConfig {
    language?: Language;
    theme?: "light" | "dark";
    initialCode?: string;
    autoRun?: boolean;
    onCodeChange?: (code: string) => void;
    onRunComplete?: (result: ExecutionResult) => void;
}

export type Language =
    | "javascript"
    | "typescript"
    | "python"
    | "html"
    | "css"
    | "json"
    | "sql";

export interface ExecutionResult {
    success: boolean;
    output: string[];
    errors: string[];
    executionTime: number;
    returnValue?: any;
}

interface PlaygroundState {
    code: string;
    language: Language;
    output: string[];
    errors: string[];
    isRunning: boolean;
    lastRun: Date | null;
}

// ============== Language Config ==============

const LANGUAGE_CONFIG: Record<Language, {
    name: string;
    icon: string;
    runnable: boolean;
    template: string;
}> = {
    javascript: {
        name: "JavaScript",
        icon: "🟨",
        runnable: true,
        template: `// JavaScript Playground
function greet(name) {
  return \`Hello, \${name}!\`;
}

console.log(greet("ILIAGPT"));`,
    },
    typescript: {
        name: "TypeScript",
        icon: "🔷",
        runnable: true,
        template: `// TypeScript Playground
interface User {
  name: string;
  age: number;
}

const user: User = {
  name: "ILIAGPT",
  age: 1
};

console.log(\`User: \${user.name}\`);`,
    },
    python: {
        name: "Python",
        icon: "🐍",
        runnable: false,
        template: `# Python Playground
def greet(name):
    return f"Hello, {name}!"

print(greet("ILIAGPT"))`,
    },
    html: {
        name: "HTML",
        icon: "🌐",
        runnable: true,
        template: `<!DOCTYPE html>
<html>
<head>
  <style>
    body { 
      font-family: system-ui; 
      padding: 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    h1 { margin-bottom: 10px; }
  </style>
</head>
<body>
  <h1>ILIAGPT Playground</h1>
  <p>Edit this HTML and see the preview!</p>
</body>
</html>`,
    },
    css: {
        name: "CSS",
        icon: "🎨",
        runnable: false,
        template: `/* CSS Playground */
.container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.card {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
}`,
    },
    json: {
        name: "JSON",
        icon: "📋",
        runnable: true,
        template: `{
  "name": "ILIAGPT",
  "version": "3.0.0",
  "features": [
    "Multi-model AI",
    "Code Playground",
    "Canvas Mode"
  ]
}`,
    },
    sql: {
        name: "SQL",
        icon: "🗃️",
        runnable: false,
        template: `-- SQL Playground
SELECT 
  users.name,
  COUNT(messages.id) as message_count
FROM users
LEFT JOIN messages ON users.id = messages.user_id
WHERE users.created_at > '2024-01-01'
GROUP BY users.id
ORDER BY message_count DESC
LIMIT 10;`,
    },
};

// ============== Component ==============

export function CodePlayground({
    language: initialLanguage = "javascript",
    theme = "dark",
    initialCode,
    autoRun = false,
    onCodeChange,
    onRunComplete,
}: PlaygroundConfig) {
    const { settings: platformSettings } = usePlatformSettings();
    const platformTimeZone = normalizeTimeZone(platformSettings.timezone_default);

    const [state, setState] = useState<PlaygroundState>({
        code: initialCode || LANGUAGE_CONFIG[initialLanguage].template,
        language: initialLanguage,
        output: [],
        errors: [],
        isRunning: false,
        lastRun: null,
    });

    const iframeRef = useRef<HTMLIFrameElement | null>(null);
    const runTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // ======== Code Execution ========

    const runCode = useCallback(async () => {
        const config = LANGUAGE_CONFIG[state.language];

        if (!config.runnable) {
            setState(s => ({
                ...s,
                errors: [`${config.name} execution is not supported in the browser.`],
            }));
            return;
        }

        setState(s => ({ ...s, isRunning: true, output: [], errors: [] }));
        const startTime = Date.now();

        try {
            let result: ExecutionResult;

            switch (state.language) {
                case "javascript":
                case "typescript":
                    result = await executeJS(state.code);
                    break;
                case "html":
                    result = executeHTML(state.code, iframeRef);
                    break;
                case "json":
                    result = validateJSON(state.code);
                    break;
                default:
                    result = {
                        success: false,
                        output: [],
                        errors: [`${config.name} execution not implemented`],
                        executionTime: 0,
                    };
            }

            result.executionTime = Date.now() - startTime;

            setState(s => ({
                ...s,
                isRunning: false,
                output: result.output,
                errors: result.errors,
                lastRun: new Date(),
            }));

            onRunComplete?.(result);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            setState(s => ({
                ...s,
                isRunning: false,
                errors: [errorMessage],
            }));
        }
    }, [state.code, state.language, onRunComplete]);

    // ======== Auto Run ========

    useEffect(() => {
        if (autoRun && state.language === "html") {
            if (runTimeoutRef.current) {
                clearTimeout(runTimeoutRef.current);
            }
            runTimeoutRef.current = setTimeout(runCode, 500);
        }
        return () => {
            if (runTimeoutRef.current) {
                clearTimeout(runTimeoutRef.current);
            }
        };
    }, [autoRun, state.code, state.language, runCode]);

    // ======== Handlers ========

    const handleCodeChange = (code: string) => {
        setState(s => ({ ...s, code }));
        onCodeChange?.(code);
    };

    const handleLanguageChange = (language: Language) => {
        const template = LANGUAGE_CONFIG[language].template;
        setState(s => ({
            ...s,
            language,
            code: template,
            output: [],
            errors: [],
        }));
    };

    const handleClear = () => {
        setState(s => ({ ...s, output: [], errors: [] }));
    };

    const handleReset = () => {
        const template = LANGUAGE_CONFIG[state.language].template;
        setState(s => ({
            ...s,
            code: template,
            output: [],
            errors: [],
        }));
    };

    // ======== Render ========

    const isDark = theme === "dark";
    const config = LANGUAGE_CONFIG[state.language];

    return (
        <div className={`flex flex-col h-full rounded-lg overflow-hidden ${isDark ? "bg-gray-900 text-white" : "bg-white text-gray-900"
            }`}>
            {/* Toolbar */}
            <div className={`flex items-center justify-between p-2 border-b ${isDark ? "bg-gray-800 border-gray-700" : "bg-gray-100 border-gray-200"
                }`}>
                <div className="flex items-center gap-2">
                    {/* Language Selector */}
                    <select
                        value={state.language}
                        onChange={(e) => handleLanguageChange(e.target.value as Language)}
                        className={`px-3 py-1 rounded text-sm ${isDark ? "bg-gray-700 text-white" : "bg-white text-gray-900"
                            }`}
                    >
                        {Object.entries(LANGUAGE_CONFIG).map(([key, cfg]) => (
                            <option key={key} value={key}>
                                {cfg.icon} {cfg.name}
                            </option>
                        ))}
                    </select>

                    <span className="text-xs text-gray-500">
                        {config.runnable ? "✓ Runnable" : "Preview only"}
                    </span>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={handleClear}
                        className={`px-3 py-1 text-sm rounded ${isDark ? "hover:bg-gray-700" : "hover:bg-gray-200"
                            }`}
                    >
                        Clear Output
                    </button>
                    <button
                        onClick={handleReset}
                        className={`px-3 py-1 text-sm rounded ${isDark ? "hover:bg-gray-700" : "hover:bg-gray-200"
                            }`}
                    >
                        Reset
                    </button>
                    <button
                        onClick={runCode}
                        disabled={state.isRunning || !config.runnable}
                        className={`px-4 py-1 text-sm rounded font-medium ${config.runnable
                                ? "bg-green-600 hover:bg-green-700 text-white"
                                : "bg-gray-500 text-gray-300 cursor-not-allowed"
                            }`}
                    >
                        {state.isRunning ? "Running..." : "▶ Run"}
                    </button>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex flex-1 overflow-hidden">
                {/* Editor */}
                <div className="flex-1 flex flex-col">
                    <textarea
                        value={state.code}
                        onChange={(e) => handleCodeChange(e.target.value)}
                        className={`flex-1 p-4 font-mono text-sm resize-none outline-none ${isDark ? "bg-gray-900 text-green-400" : "bg-white text-gray-900"
                            }`}
                        spellCheck={false}
                        style={{ tabSize: 2 }}
                    />
                </div>

                {/* Output / Preview */}
                <div className={`w-1/2 flex flex-col border-l ${isDark ? "bg-gray-800 border-gray-700" : "bg-gray-50 border-gray-200"
                    }`}>
                    {/* Output Header */}
                    <div className={`px-3 py-2 text-xs font-medium border-b ${isDark ? "border-gray-700" : "border-gray-200"
                        }`}>
                        {state.language === "html" ? "Preview" : "Output"}
                        {state.lastRun && (
                            <span className="ml-2 text-gray-500">
                                Last run: {formatZonedTime(state.lastRun, { timeZone: platformTimeZone, includeSeconds: true })}
                            </span>
                        )}
                    </div>

                    {/* Output Content */}
                    <div className="flex-1 overflow-auto p-3">
                        {state.language === "html" ? (
                            <iframe
                                ref={iframeRef}
                                title="Preview"
                                className="w-full h-full bg-white rounded"
                                sandbox="allow-scripts"
                            />
                        ) : (
                            <>
                                {/* Console Output */}
                                {state.output.map((line, i) => (
                                    <div key={i} className="font-mono text-sm py-1">
                                        <span className="text-gray-500 mr-2">{">"}</span>
                                        {line}
                                    </div>
                                ))}

                                {/* Errors */}
                                {state.errors.map((error, i) => (
                                    <div key={i} className="font-mono text-sm py-1 text-red-500">
                                        <span className="mr-2">✕</span>
                                        {error}
                                    </div>
                                ))}

                                {/* Empty state */}
                                {state.output.length === 0 && state.errors.length === 0 && (
                                    <div className="text-gray-500 text-sm">
                                        Click "Run" to execute the code
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ============== Executors ==============

async function executeJS(code: string): Promise<ExecutionResult> {
    const output: string[] = [];
    const errors: string[] = [];

    // FRONTEND FIX #21: Block potentially dangerous code patterns
    const dangerousPatterns = [
        /eval\s*\(/i,
        /Function\s*\(/i,
        /document\s*\.\s*(cookie|write)/i,
        /localStorage/i,
        /sessionStorage/i,
        /XMLHttpRequest/i,
        /fetch\s*\(/i,
        /import\s*\(/i,
        /require\s*\(/i,
        /window\s*\.\s*open/i,
        /\.innerHTML\s*=/i,
    ];

    for (const pattern of dangerousPatterns) {
        if (pattern.test(code)) {
            return {
                success: false,
                output: [],
                errors: [`Blocked: Code contains potentially unsafe pattern: ${pattern.source}`],
                executionTime: 0
            };
        }
    }

    // FRONTEND FIX #22: Limit code length to prevent DoS
    if (code.length > 50000) {
        return {
            success: false,
            output: [],
            errors: ['Code exceeds maximum length of 50,000 characters'],
            executionTime: 0
        };
    }

    // Create isolated console
    const customConsole = {
        log: (...args: any[]) => output.push(args.map(String).join(" ")),
        error: (...args: any[]) => errors.push(args.map(String).join(" ")),
        warn: (...args: any[]) => output.push(`⚠️ ${args.map(String).join(" ")}`),
        info: (...args: any[]) => output.push(`ℹ️ ${args.map(String).join(" ")}`),
    };

    try {
        // Execute in isolated context
        const fn = new Function("console", code);
        const result = fn(customConsole);

        if (result !== undefined) {
            output.push(`← ${JSON.stringify(result)}`);
        }

        return { success: true, output, errors, executionTime: 0, returnValue: result };
    } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
        return { success: false, output, errors, executionTime: 0 };
    }
}

function executeHTML(
    code: string,
    iframeRef: React.RefObject<HTMLIFrameElement | null>
): ExecutionResult {
    if (iframeRef.current) {
        iframeRef.current.srcdoc = code;
    }
    return { success: true, output: ["Preview updated"], errors: [], executionTime: 0 };
}

function validateJSON(code: string): ExecutionResult {
    try {
        const parsed = JSON.parse(code);
        const formatted = JSON.stringify(parsed, null, 2);
        return {
            success: true,
            output: [
                "✓ Valid JSON",
                `Keys: ${Object.keys(parsed).join(", ")}`,
                formatted,
            ],
            errors: [],
            executionTime: 0,
            returnValue: parsed,
        };
    } catch (error) {
        return {
            success: false,
            output: [],
            errors: [error instanceof Error ? error.message : "Invalid JSON"],
            executionTime: 0,
        };
    }
}

export default CodePlayground;
