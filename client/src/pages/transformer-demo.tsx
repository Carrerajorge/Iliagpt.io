/**
 * Transformer end-to-end demo — `/transformer-demo` page.
 *
 * Educational surface for the in-house "Attention Is All You Need"
 * implementation. Surfaces every major piece of the paper via the REST
 * API we wired up under `/api/transformer`:
 *
 *   Section 1: Attention heatmap        — POST /api/transformer/attention
 *   Section 2: Auto-regressive greedy   — POST /api/transformer/generate
 *              decoding of the copy     ( + /beam-search for top-k )
 *              task
 *   Section 3: Live training curve      — POST /api/transformer/train-step
 *              on a tiny copy task
 *   Section 4: Noam LR schedule         — POST /api/transformer/schedule
 *              (Equation 3) visualization
 *
 * No backend rendering — it calls the REST endpoints we wired up
 * and displays the JSON responses as interactive visualizations.
 */

import { useCallback, useMemo, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

// Seeded PRNG so demo runs are reproducible across reloads.
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build a small (tokenCount × dim) embedding deterministically from tokens. */
function deterministicEmbedding(tokens: string[], dim: number): number[][] {
  const out: number[][] = [];
  for (const tok of tokens) {
    // Hash the token string into a seed (simple polynomial hash).
    let seed = 5381;
    for (let i = 0; i < tok.length; i++) seed = ((seed << 5) + seed + tok.charCodeAt(i)) | 0;
    const rand = mulberry32(Math.abs(seed) || 1);
    const row: number[] = [];
    for (let i = 0; i < dim; i++) row.push(rand() * 2 - 1);
    out.push(row);
  }
  return out;
}

interface AttentionResponse {
  output: number[][];
  weights: number[][];
  scaledScores: number[][];
  d_k: number;
}

// Turn a weight in [0, 1] into an rgba background for the heatmap cell.
function heatColor(w: number): string {
  const clamped = Math.max(0, Math.min(1, w));
  // Simple blue → teal → amber gradient
  const r = Math.round(20 + clamped * 220);
  const g = Math.round(80 + clamped * 140);
  const b = Math.round(200 - clamped * 160);
  return `rgb(${r}, ${g}, ${b})`;
}

function textColor(w: number): string {
  return w > 0.5 ? "#0b1021" : "#f0f4ff";
}

// ─── Types for the new endpoint responses ────────────────────────────────

interface GenerateResponse {
  tokens: number[];
  hitEOS: boolean;
  steps: number;
  model: { vocabSize: number; seed: number; dModel: number };
  algorithm: string;
}

interface TrainStepResponse {
  trajectory: Array<{
    step: number;
    loss: number;
    learningRate: number;
    gradientNorm: number;
  }>;
  initialLoss: number;
  finalLoss: number;
  improved: boolean;
  batch: { src: number[]; tgtIn: number[]; tgtOut: number[] };
  config: Record<string, number>;
}

interface ScheduleResponse {
  step: number;
  learningRate: number;
  peakLearningRate: number;
  peakAtStep: number;
  dModel: number;
  warmupSteps: number;
  curve?: number[];
  formula: string;
}

/**
 * Render a simple SVG line chart for a numeric series. No external
 * charting dependency — the whole page must stay self-contained.
 */
function LineChart({
  data,
  width = 640,
  height = 160,
  color = "#38bdf8",
  label,
  yFormat = (v: number) => v.toFixed(3),
  xLabel,
  yLabel,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  label?: string;
  yFormat?: (v: number) => string;
  xLabel?: string;
  yLabel?: string;
}) {
  if (data.length === 0) return null;
  const minV = Math.min(...data);
  const maxV = Math.max(...data);
  const span = maxV - minV || 1;
  const padding = { top: 16, right: 16, bottom: 28, left: 52 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const x = (i: number) =>
    padding.left + (data.length <= 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const y = (v: number) => padding.top + plotH - ((v - minV) / span) * plotH;
  const path = data.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="bg-background border border-border rounded-md"
      data-testid="transformer-demo-linechart"
    >
      {/* Y axis ticks */}
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const v = minV + t * span;
        const yy = y(v);
        return (
          <g key={`yt-${t}`}>
            <line x1={padding.left} x2={width - padding.right} y1={yy} y2={yy} stroke="#1e293b" strokeWidth={1} />
            <text x={padding.left - 4} y={yy + 3} fontSize={9} fill="#94a3b8" textAnchor="end">
              {yFormat(v)}
            </text>
          </g>
        );
      })}
      {/* Line */}
      <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      {/* Dots */}
      {data.map((v, i) => (
        <circle key={`dot-${i}`} cx={x(i)} cy={y(v)} r={2.5} fill={color} />
      ))}
      {/* X axis label */}
      {xLabel && (
        <text x={width / 2} y={height - 6} fontSize={10} fill="#94a3b8" textAnchor="middle">
          {xLabel}
        </text>
      )}
      {/* Y axis label */}
      {yLabel && (
        <text
          x={12}
          y={height / 2}
          fontSize={10}
          fill="#94a3b8"
          textAnchor="middle"
          transform={`rotate(-90, 12, ${height / 2})`}
        >
          {yLabel}
        </text>
      )}
      {/* Top-right label */}
      {label && (
        <text x={width - padding.right} y={padding.top - 4} fontSize={10} fill="#94a3b8" textAnchor="end">
          {label}
        </text>
      )}
    </svg>
  );
}

export default function TransformerDemoPage() {
  const [input, setInput] = useState<string>(
    "attention, is, all, you, need",
  );
  const [dim, setDim] = useState<number>(8);
  const [response, setResponse] = useState<AttentionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Auto-regressive generation state ────────────────────────────────
  const [genSrc, setGenSrc] = useState<string>("3, 5, 4");
  const [genMaxLen, setGenMaxLen] = useState<number>(8);
  const [genVocab, setGenVocab] = useState<number>(16);
  const [genSeed, setGenSeed] = useState<number>(42);
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [genResponse, setGenResponse] = useState<GenerateResponse | null>(null);

  // ── Training curve state ────────────────────────────────────────────
  const [trainSteps, setTrainSteps] = useState<number>(3);
  const [trainLoading, setTrainLoading] = useState(false);
  const [trainError, setTrainError] = useState<string | null>(null);
  const [trainResponse, setTrainResponse] = useState<TrainStepResponse | null>(null);

  // ── LR schedule state ───────────────────────────────────────────────
  const [schedSteps, setSchedSteps] = useState<number>(8000);
  const [schedDModel, setSchedDModel] = useState<number>(512);
  const [schedWarmup, setSchedWarmup] = useState<number>(4000);
  const [schedLoading, setSchedLoading] = useState(false);
  const [schedError, setSchedError] = useState<string | null>(null);
  const [schedResponse, setSchedResponse] = useState<ScheduleResponse | null>(null);

  const tokens = useMemo(
    () =>
      input
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    [input],
  );

  const handleRun = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResponse(null);
    try {
      const emb = deterministicEmbedding(tokens, dim);
      const res = await fetch("/api/transformer/attention", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ Q: emb, K: emb, V: emb }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as AttentionResponse;
      setResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [tokens, dim]);

  const maxOutputAbs = useMemo(() => {
    if (!response) return 1;
    let m = 0;
    for (const row of response.output) for (const v of row) m = Math.max(m, Math.abs(v));
    return m || 1;
  }, [response]);

  // ── Generate (greedy auto-regressive copy task) ─────────────────────
  const handleGenerate = useCallback(async () => {
    setGenLoading(true);
    setGenError(null);
    setGenResponse(null);
    try {
      const srcTokens = genSrc
        .split(",")
        .map((t) => Number(t.trim()))
        .filter((n) => Number.isFinite(n));
      if (srcTokens.length === 0) throw new Error("Sin tokens");
      const res = await fetch("/api/transformer/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          srcTokens,
          maxLength: genMaxLen,
          model: { vocabSize: genVocab, seed: genSeed },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as GenerateResponse;
      setGenResponse(data);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenLoading(false);
    }
  }, [genSrc, genMaxLen, genVocab, genSeed]);

  // ── Training step (loss curve on the copy task) ─────────────────────
  const handleTrain = useCallback(async () => {
    setTrainLoading(true);
    setTrainError(null);
    setTrainResponse(null);
    try {
      const res = await fetch("/api/transformer/train-step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ steps: trainSteps }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as TrainStepResponse;
      setTrainResponse(data);
    } catch (err) {
      setTrainError(err instanceof Error ? err.message : String(err));
    } finally {
      setTrainLoading(false);
    }
  }, [trainSteps]);

  // ── Noam LR schedule ────────────────────────────────────────────────
  const handleSchedule = useCallback(async () => {
    setSchedLoading(true);
    setSchedError(null);
    setSchedResponse(null);
    try {
      const res = await fetch("/api/transformer/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          step: schedSteps,
          dModel: schedDModel,
          warmupSteps: schedWarmup,
          curve: true,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as ScheduleResponse;
      setSchedResponse(data);
    } catch (err) {
      setSchedError(err instanceof Error ? err.message : String(err));
    } finally {
      setSchedLoading(false);
    }
  }, [schedSteps, schedDModel, schedWarmup]);

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="transformer-demo-root">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            Attention Is All You Need — in-house demo
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Pure TypeScript implementation of the Transformer's scaled dot-product attention
            (Vaswani et al. 2017, eq. 1). Type tokens below, the frontend builds a deterministic
            embedding per token, calls <code className="font-mono">POST /api/transformer/attention</code>,
            and renders the attention weights as a heatmap. Zero external ML libraries.
          </p>
        </header>

        <section className="border border-border rounded-lg p-4 bg-card mb-6">
          <label className="text-sm font-medium block mb-2">1 · Tokens (comma-separated)</label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-border bg-background p-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
            data-testid="transformer-demo-tokens"
          />

          <label className="text-sm font-medium block mt-4 mb-2">2 · Embedding dimension d_k</label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={2}
              max={64}
              step={2}
              value={dim}
              onChange={(e) => setDim(Number(e.target.value))}
              className="flex-1"
              data-testid="transformer-demo-dim"
            />
            <span className="text-sm font-mono text-muted-foreground w-14 text-right">{dim}</span>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <Button
              onClick={handleRun}
              disabled={loading || tokens.length === 0}
              data-testid="transformer-demo-run"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  Calculando…
                </>
              ) : (
                <>Calcular atención</>
              )}
            </Button>
            <span className="text-xs text-muted-foreground">
              {tokens.length} token{tokens.length !== 1 ? "s" : ""} · d_k = {dim}
            </span>
          </div>

          {error && (
            <div className="mt-3 text-sm text-destructive" data-testid="transformer-demo-error">
              Error: {error}
            </div>
          )}
        </section>

        {response && (
          <>
            <section className="border border-border rounded-lg p-4 bg-card mb-6">
              <h2 className="text-sm font-medium mb-3">
                3 · Attention weights — softmax(Q · Kᵀ / √{dim})
              </h2>
              <p className="text-xs text-muted-foreground mb-3">
                Row = query token (who is attending). Column = key token (what is being attended to).
                Each row sums to 1.
              </p>
              <div
                className="overflow-auto"
                data-testid="transformer-demo-heatmap"
              >
                <table className="border-collapse text-xs">
                  <thead>
                    <tr>
                      <th className="sticky left-0 bg-card p-1 text-muted-foreground font-normal" />
                      {tokens.map((t, i) => (
                        <th
                          key={`h-${i}`}
                          className="p-1 text-muted-foreground font-normal min-w-[54px] text-center"
                          title={`key: ${t}`}
                        >
                          {t}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {response.weights.map((row, i) => (
                      <tr key={`r-${i}`}>
                        <th
                          className="sticky left-0 bg-card p-1 pr-2 text-right text-muted-foreground font-normal"
                          title={`query: ${tokens[i]}`}
                        >
                          {tokens[i]}
                        </th>
                        {row.map((w, j) => (
                          <td
                            key={`c-${i}-${j}`}
                            className="p-1 text-center font-mono border border-border"
                            style={{ backgroundColor: heatColor(w), color: textColor(w) }}
                            data-testid={`heatmap-cell-${i}-${j}`}
                          >
                            {w.toFixed(3)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                d_k = {response.d_k} · scaling factor 1/√d_k = {(1 / Math.sqrt(response.d_k)).toFixed(4)}
              </p>
            </section>

            <section className="border border-border rounded-lg p-4 bg-card">
              <h2 className="text-sm font-medium mb-3">
                4 · Attended output vectors — softmax(QKᵀ/√d_k) · V
              </h2>
              <p className="text-xs text-muted-foreground mb-3">
                Each row is the contextualized representation of the corresponding query token,
                computed as the weighted sum of the value vectors according to the attention
                weights above. Cell color intensity shows the magnitude relative to the max.
              </p>
              <div className="overflow-auto" data-testid="transformer-demo-output">
                <table className="border-collapse text-[10px]">
                  <tbody>
                    {response.output.map((row, i) => (
                      <tr key={`o-${i}`}>
                        <th className="p-1 pr-2 text-right text-muted-foreground font-normal">
                          {tokens[i]}
                        </th>
                        {row.map((v, j) => {
                          const mag = Math.min(1, Math.abs(v) / maxOutputAbs);
                          return (
                            <td
                              key={`ov-${i}-${j}`}
                              className="p-1 text-center font-mono border border-border"
                              style={{ backgroundColor: heatColor(mag), color: textColor(mag) }}
                            >
                              {v.toFixed(2)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {/* ─── Section 5 · Auto-regressive generation ─────────────────── */}
        <section
          className="border border-border rounded-lg p-4 bg-card mt-6"
          data-testid="transformer-demo-generate-section"
        >
          <h2 className="text-sm font-medium mb-2">
            5 · Auto-regressive generation (greedy) · copy task
          </h2>
          <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
            Runs the decoder one token at a time against a tiny deterministic
            Transformer. The server seeds a model, encodes the source, and emits
            tokens via argmax over tied-embedding logits until it hits EOS (id 1) or
            the max length. Corresponds to <code className="font-mono">POST /api/transformer/generate</code>.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <label className="flex flex-col text-xs text-muted-foreground">
              Tokens (comma-separated ids)
              <input
                value={genSrc}
                onChange={(e) => setGenSrc(e.target.value)}
                className="mt-1 rounded-md border border-border bg-background p-1.5 text-sm font-mono text-foreground"
                data-testid="transformer-demo-gen-src"
              />
            </label>
            <label className="flex flex-col text-xs text-muted-foreground">
              maxLength
              <input
                type="number"
                min={1}
                max={64}
                value={genMaxLen}
                onChange={(e) => setGenMaxLen(Number(e.target.value))}
                className="mt-1 rounded-md border border-border bg-background p-1.5 text-sm font-mono text-foreground"
              />
            </label>
            <label className="flex flex-col text-xs text-muted-foreground">
              vocabSize
              <input
                type="number"
                min={3}
                max={256}
                value={genVocab}
                onChange={(e) => setGenVocab(Number(e.target.value))}
                className="mt-1 rounded-md border border-border bg-background p-1.5 text-sm font-mono text-foreground"
              />
            </label>
            <label className="flex flex-col text-xs text-muted-foreground">
              seed
              <input
                type="number"
                value={genSeed}
                onChange={(e) => setGenSeed(Number(e.target.value))}
                className="mt-1 rounded-md border border-border bg-background p-1.5 text-sm font-mono text-foreground"
              />
            </label>
          </div>
          <Button
            onClick={handleGenerate}
            disabled={genLoading}
            data-testid="transformer-demo-gen-run"
          >
            {genLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                Generando…
              </>
            ) : (
              <>Generar tokens</>
            )}
          </Button>

          {genError && (
            <div className="mt-3 text-sm text-destructive" data-testid="transformer-demo-gen-error">
              Error: {genError}
            </div>
          )}

          {genResponse && (
            <div className="mt-4 space-y-2 text-xs" data-testid="transformer-demo-gen-result">
              <div>
                <span className="text-muted-foreground">Tokens generados: </span>
                <span className="font-mono text-foreground">
                  [{genResponse.tokens.join(", ")}]
                </span>
              </div>
              <div className="text-muted-foreground">
                hitEOS = {String(genResponse.hitEOS)} · pasos = {genResponse.steps} ·
                d_model = {genResponse.model.dModel}
              </div>
              <div className="text-muted-foreground italic">{genResponse.algorithm}</div>
            </div>
          )}
        </section>

        {/* ─── Section 6 · Training curve on the copy task ────────────── */}
        <section
          className="border border-border rounded-lg p-4 bg-card mt-6"
          data-testid="transformer-demo-train-section"
        >
          <h2 className="text-sm font-medium mb-2">
            6 · Training curve · finite-difference gradients + Adam
          </h2>
          <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
            Runs <code className="font-mono">N</code> full training steps on a tiny
            copy-reverse task. Each step: forward pass → central-difference
            gradient for up to 40 parameters → Adam update with the Noam schedule.
            The trajectory proves the full paper machinery (attention + FFN + Adam
            + label smoothing + tied projection) reduces the loss end-to-end.
            Uses <code className="font-mono">POST /api/transformer/train-step</code>.
          </p>
          <div className="flex items-center gap-3 mb-3">
            <label className="flex flex-col text-xs text-muted-foreground">
              Steps
              <input
                type="number"
                min={1}
                max={20}
                value={trainSteps}
                onChange={(e) => setTrainSteps(Number(e.target.value))}
                className="mt-1 rounded-md border border-border bg-background p-1.5 text-sm font-mono text-foreground w-28"
              />
            </label>
            <Button
              onClick={handleTrain}
              disabled={trainLoading}
              data-testid="transformer-demo-train-run"
            >
              {trainLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  Entrenando…
                </>
              ) : (
                <>Ejecutar entrenamiento</>
              )}
            </Button>
          </div>

          {trainError && (
            <div className="mt-3 text-sm text-destructive" data-testid="transformer-demo-train-error">
              Error: {trainError}
            </div>
          )}

          {trainResponse && (
            <div className="mt-4 space-y-4" data-testid="transformer-demo-train-result">
              <LineChart
                data={trainResponse.trajectory.map((t) => t.loss)}
                label="cross-entropy loss"
                xLabel="training step"
                yLabel="loss"
                color="#f59e0b"
                yFormat={(v) => v.toFixed(3)}
              />
              <LineChart
                data={trainResponse.trajectory.map((t) => t.learningRate)}
                label="Noam learning rate"
                xLabel="training step"
                yLabel="lr"
                color="#38bdf8"
                yFormat={(v) => v.toExponential(1)}
              />
              <div className="text-xs text-muted-foreground">
                initial={trainResponse.initialLoss.toFixed(4)} · final=
                {trainResponse.finalLoss.toFixed(4)} ·{" "}
                <span
                  className={
                    trainResponse.improved ? "text-emerald-400" : "text-destructive"
                  }
                >
                  {trainResponse.improved ? "loss decreased" : "no improvement"}
                </span>{" "}
                · batch src=[{trainResponse.batch.src.join(",")}] tgtOut=[
                {trainResponse.batch.tgtOut.join(",")}]
              </div>
            </div>
          )}
        </section>

        {/* ─── Section 7 · Noam LR schedule (Equation 3) ──────────────── */}
        <section
          className="border border-border rounded-lg p-4 bg-card mt-6"
          data-testid="transformer-demo-schedule-section"
        >
          <h2 className="text-sm font-medium mb-2">
            7 · Noam learning-rate schedule (Ecuación 3 del paper)
          </h2>
          <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
            <code className="font-mono">lrate = d_model^(-0.5) · min(step^(-0.5), step · warmup^(-1.5))</code>
            . Warm-up lineal hasta <code className="font-mono">step = warmup</code>,
            decaimiento proporcional a <code className="font-mono">1/√step</code> después.
            Base del paper: <code className="font-mono">d_model=512, warmup=4000</code>.
            Usa <code className="font-mono">POST /api/transformer/schedule</code>.
          </p>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <label className="flex flex-col text-xs text-muted-foreground">
              Max step
              <input
                type="number"
                min={1}
                max={1000000}
                value={schedSteps}
                onChange={(e) => setSchedSteps(Number(e.target.value))}
                className="mt-1 rounded-md border border-border bg-background p-1.5 text-sm font-mono text-foreground"
              />
            </label>
            <label className="flex flex-col text-xs text-muted-foreground">
              d_model
              <input
                type="number"
                min={1}
                max={4096}
                value={schedDModel}
                onChange={(e) => setSchedDModel(Number(e.target.value))}
                className="mt-1 rounded-md border border-border bg-background p-1.5 text-sm font-mono text-foreground"
              />
            </label>
            <label className="flex flex-col text-xs text-muted-foreground">
              warmup
              <input
                type="number"
                min={1}
                max={100000}
                value={schedWarmup}
                onChange={(e) => setSchedWarmup(Number(e.target.value))}
                className="mt-1 rounded-md border border-border bg-background p-1.5 text-sm font-mono text-foreground"
              />
            </label>
          </div>
          <Button
            onClick={handleSchedule}
            disabled={schedLoading}
            data-testid="transformer-demo-sched-run"
          >
            {schedLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                Calculando…
              </>
            ) : (
              <>Calcular curva</>
            )}
          </Button>

          {schedError && (
            <div className="mt-3 text-sm text-destructive" data-testid="transformer-demo-sched-error">
              Error: {schedError}
            </div>
          )}

          {schedResponse?.curve && (
            <div className="mt-4 space-y-2" data-testid="transformer-demo-sched-result">
              <LineChart
                data={schedResponse.curve}
                label={`peak=${schedResponse.peakLearningRate.toExponential(2)} @ step ${schedResponse.peakAtStep}`}
                xLabel="step"
                yLabel="lr"
                color="#a78bfa"
                yFormat={(v) => v.toExponential(1)}
              />
              <div className="text-xs text-muted-foreground">
                lr(step={schedResponse.step}) ={" "}
                {schedResponse.learningRate.toExponential(4)} · fórmula:{" "}
                <code className="font-mono">{schedResponse.formula}</code>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
