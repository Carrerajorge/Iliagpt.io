/**
 * Math Visualizer Demo
 *
 * A demo page showing all math visualization components in action.
 * Users can try different expressions and dimensions interactively.
 *
 * Usage: Import and render this component in your app for a full demo.
 */
import { useState } from "react";
import MathGraph2D from "./MathGraph2D";
import MathGraph3D from "./MathGraph3D";
import MathGraph4D from "./MathGraph4D";
import MathGraphND from "./MathGraphND";
import MathExerciseRenderer from "./MathExerciseRenderer";
import type { MathExercise } from "./MathExerciseRenderer";
import type { NDDataPoint } from "./MathGraphND";

type DemoTab = "2d" | "3d" | "4d" | "nd" | "exercise";

const PRESETS_2D = [
  { label: "Parabola", expr: "x^2", xMin: -5, xMax: 5 },
  { label: "Parabola y=x²-4x+3", expr: "x^2-4*x+3", xMin: -1, xMax: 5 },
  { label: "Cubic", expr: "x^3 - 3*x", xMin: -3, xMax: 3 },
  { label: "Sine", expr: "sin(x)", xMin: -10, xMax: 10 },
  { label: "Cosine", expr: "cos(x)", xMin: -10, xMax: 10 },
  { label: "Exponential", expr: "exp(x)", xMin: -3, xMax: 3 },
  { label: "Log", expr: "ln(x)", xMin: 0.1, xMax: 10 },
  { label: "Rational", expr: "1/x", xMin: -5, xMax: 5 },
];

const PRESETS_3D = [
  { label: "Paraboloid", expr: "x^2+y^2" },
  { label: "Saddle", expr: "x^2-y^2" },
  { label: "Hyperboloid", expr: "sqrt(x^2+y^2+1)" },
  { label: "Wave", expr: "sin(x)*cos(y)" },
  { label: "Sphere Shell", expr: "sqrt(abs(4-x^2-y^2))" },
  { label: "Ripple", expr: "sin(sqrt(x^2+y^2))" },
];

const PRESETS_4D = [
  { label: "4D Paraboloid", expr: "x^2+y^2+z^2" },
  { label: "4D Wave", expr: "sin(x)*cos(y)+z" },
  { label: "4D Sphere", expr: "x^2+y^2+z^2-z" },
];

const SAMPLE_EXERCISE: MathExercise = {
  problem: "Graph and analyze the parabola: y = x² - 4x + 3",
  steps: [
    { description: "Identify standard form: y = ax² + bx + c", result: "a=1, b=-4, c=3" },
    { description: "Find vertex using x = -b/(2a)", result: "x = -(-4)/(2×1) = 2.00" },
    { description: "Substitute back to find y at vertex", result: "y = (2)² - 4(2) + 3 = -1.00" },
    { description: "a=1 > 0, so the parabola opens upward ↑" },
    { description: "Use quadratic formula: x = (-b ± √(b²-4ac)) / (2a)", result: "x₁ = 3.00, x₂ = 1.00" },
  ],
  answer: "Vertex: (2.00, -1.00), opens upward",
  graphType: "2d",
  expression: "x^2-4*x+3",
  xMin: -1,
  xMax: 5,
  title: "y = x² - 4x + 3",
};

function generateNDPoints(dims: number, n = 40): NDDataPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    values: Array.from({ length: dims }, (_, d) =>
      Math.sin(i * 0.3 + d * 1.1) * 3 + Math.cos(i * 0.2 - d * 0.7) * 2
    ),
  }));
}

export default function MathVisualizerDemo() {
  const [tab, setTab] = useState<DemoTab>("2d");
  const [expr2D, setExpr2D] = useState("x^2-4*x+3");
  const [xMin2D, setXMin2D] = useState(-2);
  const [xMax2D, setXMax2D] = useState(6);
  const [expr3D, setExpr3D] = useState("x^2+y^2");
  const [expr4D, setExpr4D] = useState("x^2+y^2+z^2");
  const [ndDims, setNdDims] = useState(5);
  const [ndMode, setNdMode] = useState<"parallel" | "scatter-matrix" | "radar">("parallel");

  const ndPoints = generateNDPoints(ndDims);
  const ndLabels = Array.from({ length: ndDims }, (_, i) => `x${i + 1}`);

  const tabs: Array<{ id: DemoTab; label: string }> = [
    { id: "2d", label: "2D Graph" },
    { id: "3d", label: "3D Surface" },
    { id: "4d", label: "4D Viz" },
    { id: "nd", label: "5D-8D" },
    { id: "exercise", label: "Exercise" },
  ];

  return (
    <div className="flex flex-col gap-4 p-4 max-w-3xl mx-auto">
      <div>
        <h2 className="text-lg font-bold text-foreground">Math Visualization Engine</h2>
        <p className="text-sm text-muted-foreground">
          Interactive visualizations for 2D through 8D mathematical functions
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              tab === t.id
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 2D Tab */}
      {tab === "2d" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Expression (y = ...)</label>
              <input
                className="border border-border rounded px-2 py-1 text-sm bg-background text-foreground font-mono w-48"
                value={expr2D}
                onChange={(e) => setExpr2D(e.target.value)}
                placeholder="x^2"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">x min</label>
              <input
                type="number"
                className="border border-border rounded px-2 py-1 text-sm bg-background text-foreground w-20"
                value={xMin2D}
                onChange={(e) => setXMin2D(Number(e.target.value))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">x max</label>
              <input
                type="number"
                className="border border-border rounded px-2 py-1 text-sm bg-background text-foreground w-20"
                value={xMax2D}
                onChange={(e) => setXMax2D(Number(e.target.value))}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {PRESETS_2D.map((p) => (
              <button
                key={p.label}
                className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                onClick={() => { setExpr2D(p.expr); setXMin2D(p.xMin); setXMax2D(p.xMax); }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <MathGraph2D expression={expr2D} xMin={xMin2D} xMax={xMax2D} title={`y = ${expr2D}`} />
        </div>
      )}

      {/* 3D Tab */}
      {tab === "3d" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Expression (z = f(x,y))</label>
            <input
              className="border border-border rounded px-2 py-1 text-sm bg-background text-foreground font-mono w-64"
              value={expr3D}
              onChange={(e) => setExpr3D(e.target.value)}
              placeholder="x^2+y^2"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {PRESETS_3D.map((p) => (
              <button
                key={p.label}
                className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                onClick={() => setExpr3D(p.expr)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <MathGraph3D expression={expr3D} title={`z = ${expr3D}`} />
        </div>
      )}

      {/* 4D Tab */}
      {tab === "4d" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Expression (w = f(x,y,z))</label>
            <input
              className="border border-border rounded px-2 py-1 text-sm bg-background text-foreground font-mono w-64"
              value={expr4D}
              onChange={(e) => setExpr4D(e.target.value)}
              placeholder="x^2+y^2+z^2"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {PRESETS_4D.map((p) => (
              <button
                key={p.label}
                className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                onClick={() => setExpr4D(p.expr)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <MathGraph4D expression={expr4D} title={`w = ${expr4D}`} />
          <p className="text-xs text-muted-foreground">
            The 4th dimension (w) is shown as a color gradient (blue=low, red=high).
            The animation sweeps through z-slices of the 4D space.
          </p>
        </div>
      )}

      {/* ND Tab */}
      {tab === "nd" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Dimensions (5–8)</label>
              <select
                className="border border-border rounded px-2 py-1 text-sm bg-background text-foreground"
                value={ndDims}
                onChange={(e) => setNdDims(Number(e.target.value))}
              >
                {[5, 6, 7, 8].map((d) => (
                  <option key={d} value={d}>{d}D</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Visualization mode</label>
              <select
                className="border border-border rounded px-2 py-1 text-sm bg-background text-foreground"
                value={ndMode}
                onChange={(e) => setNdMode(e.target.value as typeof ndMode)}
              >
                <option value="parallel">Parallel Coordinates</option>
                <option value="scatter-matrix">Scatter Matrix</option>
                <option value="radar">Radar Chart</option>
              </select>
            </div>
          </div>
          <MathGraphND
            points={ndPoints}
            dimensionLabels={ndLabels}
            title={`${ndDims}D Mathematical Data`}
            mode={ndMode}
          />
          <p className="text-xs text-muted-foreground">
            Sample {ndDims}-dimensional data generated via sin/cos combinations.
            Each line/polygon represents one data point across all {ndDims} axes.
          </p>
        </div>
      )}

      {/* Exercise Tab */}
      {tab === "exercise" && (
        <MathExerciseRenderer exercise={SAMPLE_EXERCISE} />
      )}
    </div>
  );
}
