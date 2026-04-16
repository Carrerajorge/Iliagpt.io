import { useState } from "react";
import MathGraph2D from "./MathGraph2D";
import MathGraph3D from "./MathGraph3D";
import MathGraph4D from "./MathGraph4D";

export interface MathStep {
  description: string;
  result?: string;
  latex?: string;
}

export interface MathExercise {
  problem: string;
  steps: MathStep[];
  answer: string;
  graphType: "2d" | "3d" | "4d" | "none";
  expression?: string;
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
  title?: string;
}

interface MathExerciseRendererProps {
  exercise: MathExercise;
}

// Lightweight LaTeX-to-text renderer (real KaTeX would be better but requires CDN)
function renderLatex(text: string): string {
  return text
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, "($1)/($2)")
    .replace(/\\sqrt\{([^}]+)\}/g, "√($1)")
    .replace(/\\pm/g, "±")
    .replace(/\\cdot/g, "·")
    .replace(/\^2/g, "²")
    .replace(/\^3/g, "³")
    .replace(/\^(\d)/g, "^$1")
    .replace(/\\[a-z]+/g, "");
}

export default function MathExerciseRenderer({ exercise }: MathExerciseRendererProps) {
  const [showSteps, setShowSteps] = useState(false);
  const [showGraph, setShowGraph] = useState(true);

  return (
    <div className="flex flex-col gap-4 p-4 rounded-lg border border-border bg-card">
      {/* Problem Statement */}
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">?</span>
          Problem
        </h3>
        <p className="text-sm text-foreground leading-relaxed pl-8">
          {renderLatex(exercise.problem)}
        </p>
      </div>

      {/* Graph */}
      {exercise.graphType !== "none" && exercise.expression && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Graph</h3>
            <button
              className="text-xs text-muted-foreground hover:text-foreground underline"
              onClick={() => setShowGraph((s) => !s)}
            >
              {showGraph ? "Hide" : "Show"}
            </button>
          </div>
          {showGraph && (
            <div className="rounded-md overflow-hidden">
              {exercise.graphType === "2d" && (
                <MathGraph2D
                  expression={exercise.expression}
                  xMin={exercise.xMin ?? -10}
                  xMax={exercise.xMax ?? 10}
                  yMin={exercise.yMin}
                  yMax={exercise.yMax}
                  title={exercise.title}
                />
              )}
              {exercise.graphType === "3d" && (
                <MathGraph3D
                  expression={exercise.expression}
                  xMin={exercise.xMin ?? -5}
                  xMax={exercise.xMax ?? 5}
                  title={exercise.title}
                />
              )}
              {exercise.graphType === "4d" && (
                <MathGraph4D
                  expression={exercise.expression}
                  title={exercise.title}
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* Step-by-step solution */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Solution</h3>
          <button
            className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            onClick={() => setShowSteps((s) => !s)}
          >
            {showSteps ? "Hide steps" : "Show steps"}
          </button>
        </div>

        {showSteps && (
          <ol className="space-y-3 pl-2">
            {exercise.steps.map((step, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-muted text-muted-foreground text-xs font-bold">
                  {i + 1}
                </span>
                <div className="flex flex-col gap-1">
                  <span className="text-foreground">{renderLatex(step.description)}</span>
                  {step.result && (
                    <code className="text-xs bg-muted rounded px-2 py-0.5 text-green-400 font-mono">
                      = {renderLatex(step.result)}
                    </code>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}

        <div className="flex items-center gap-2 mt-2">
          <span className="text-xs text-muted-foreground font-medium">Answer:</span>
          <code className="text-sm bg-muted rounded px-2 py-1 text-green-400 font-mono">
            {renderLatex(exercise.answer)}
          </code>
        </div>
      </div>
    </div>
  );
}
