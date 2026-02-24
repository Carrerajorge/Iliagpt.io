/**
 * PromptAnalysisPanel — Expandable panel for prompt analysis results
 *
 * Shown when SSE `spec_extracted` notice arrives.
 * Displays: goal, tasks, constraints, confidence, clarification questions.
 * Clarification questions are clickable → inserts question text as reply.
 * Auto-collapses after 10 seconds unless user interacts.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { ChevronDown, ChevronUp, Sparkles, AlertTriangle, X } from "lucide-react";

export interface PromptAnalysisData {
  type: "spec_extracted" | "clarification_needed" | "analysis_started";
  requestId?: string;
  spec?: {
    goal: string;
    tasks: Array<{ description?: string; name?: string }>;
    constraints: Array<{ description?: string; type?: string }>;
    confidence: number;
  };
  questions?: string[];
}

interface PromptAnalysisPanelProps {
  analysis: PromptAnalysisData | null;
  onQuestionClick?: (question: string) => void;
  onDismiss?: () => void;
}

export function PromptAnalysisPanel({
  analysis,
  onQuestionClick,
  onDismiss,
}: PromptAnalysisPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [visible, setVisible] = useState(false);
  const interactedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!analysis) {
      setVisible(false);
      return;
    }

    setVisible(true);
    setExpanded(true);
    interactedRef.current = false;

    // Auto-collapse after 10s unless user interacted
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (!interactedRef.current) {
        setExpanded(false);
      }
    }, 10_000);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [analysis]);

  const handleInteraction = useCallback(() => {
    interactedRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  if (!visible || !analysis) return null;

  const isLoading = analysis.type === "analysis_started";
  const spec = analysis.spec;
  const questions = analysis.questions || [];
  const confidence = spec?.confidence ?? 0;

  const confidenceColor =
    confidence >= 0.7
      ? "text-emerald-400"
      : confidence >= 0.4
        ? "text-amber-400"
        : "text-red-400";

  return (
    <div
      className="mx-2 mb-2 rounded-lg border border-zinc-700/60 bg-zinc-900/80 backdrop-blur-sm overflow-hidden transition-all duration-300"
      onClick={handleInteraction}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-zinc-800/50 transition-colors"
        onClick={() => { handleInteraction(); setExpanded(!expanded); }}
      >
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Sparkles className="w-3.5 h-3.5 text-violet-400" />
          <span className="font-medium">
            {isLoading ? "Analizando prompt..." : "Prompt Analysis"}
          </span>
          {spec && (
            <span className={`${confidenceColor} font-mono`}>
              {(confidence * 100).toFixed(0)}%
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {expanded ? (
            <ChevronUp className="w-3.5 h-3.5 text-zinc-500" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDismiss?.(); setVisible(false); }}
            className="p-0.5 hover:bg-zinc-700 rounded transition-colors"
          >
            <X className="w-3 h-3 text-zinc-500" />
          </button>
        </div>
      </div>

      {/* Body */}
      {expanded && !isLoading && spec && (
        <div className="px-3 pb-3 space-y-2 text-xs text-zinc-300">
          {/* Goal */}
          {spec.goal && (
            <div>
              <span className="text-zinc-500 font-medium">Goal: </span>
              <span>{spec.goal}</span>
            </div>
          )}

          {/* Tasks */}
          {spec.tasks.length > 0 && (
            <div>
              <span className="text-zinc-500 font-medium">Tasks: </span>
              <ul className="mt-0.5 ml-3 space-y-0.5">
                {spec.tasks.slice(0, 5).map((task, i) => (
                  <li key={i} className="list-disc text-zinc-400">
                    {task.description || task.name || String(task)}
                  </li>
                ))}
                {spec.tasks.length > 5 && (
                  <li className="text-zinc-500">+{spec.tasks.length - 5} more...</li>
                )}
              </ul>
            </div>
          )}

          {/* Constraints */}
          {spec.constraints.length > 0 && (
            <div>
              <span className="text-zinc-500 font-medium">Constraints: </span>
              <ul className="mt-0.5 ml-3 space-y-0.5">
                {spec.constraints.slice(0, 3).map((c, i) => (
                  <li key={i} className="list-disc text-zinc-400">
                    {c.description || c.type || String(c)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Clarification Questions */}
          {questions.length > 0 && (
            <div className="mt-2 pt-2 border-t border-zinc-800">
              <div className="flex items-center gap-1.5 text-amber-400 mb-1.5">
                <AlertTriangle className="w-3 h-3" />
                <span className="font-medium">Clarification needed:</span>
              </div>
              <div className="space-y-1">
                {questions.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => onQuestionClick?.(q)}
                    className="block w-full text-left px-2 py-1 rounded bg-zinc-800/60 hover:bg-zinc-700/60 text-zinc-300 hover:text-zinc-100 transition-colors text-[11px]"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Loading state */}
      {expanded && isLoading && (
        <div className="px-3 pb-3">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <div className="w-3 h-3 border-2 border-violet-400/30 border-t-violet-400 rounded-full animate-spin" />
            <span>Deep analysis in progress...</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default PromptAnalysisPanel;
