import { useState, useCallback } from "react";
import { executeInSandbox, type SandboxRunResult } from "@/lib/sandboxApi";

export interface UseSandboxExecutionReturn {
  execute: (code: string, language: string, stdin?: string, args?: string[]) => Promise<void>;
  isRunning: boolean;
  result: SandboxRunResult | null;
  error: string | null;
  errorLines: number[];
  reset: () => void;
}

export function useSandboxExecution(): UseSandboxExecutionReturn {
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<SandboxRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async (
    code: string,
    language: string,
    stdin?: string,
    args?: string[]
  ): Promise<void> => {
    setIsRunning(true);
    setError(null);
    setResult(null);

    try {
      const execResult = await executeInSandbox(code, language, stdin, args);
      setResult(execResult);
    } catch (err: any) {
      const errorMessage = err?.message || "Execution failed";
      setError(errorMessage);
      setResult({
        run: {
          stdout: "",
          stderr: errorMessage,
          code: 1,
          signal: null,
          output: errorMessage,
        },
        errorLines: [],
        language,
        version: "unknown",
        usedFallback: false,
        artifacts: [],
      });
    } finally {
      setIsRunning(false);
    }
  }, []);

  const reset = useCallback(() => {
    setIsRunning(false);
    setResult(null);
    setError(null);
  }, []);

  const errorLines = result?.errorLines?.map(e => e.line) || [];

  return {
    execute,
    isRunning,
    result,
    error,
    errorLines,
    reset,
  };
}

export type { SandboxRunResult } from "@/lib/sandboxApi";
