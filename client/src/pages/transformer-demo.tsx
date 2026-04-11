/**
 * Transformer attention visualization — `/transformer-demo` page.
 *
 * Educational surface for the in-house "Attention Is All You Need"
 * implementation. Given a list of tokens (provided by the user as a
 * comma-separated input), it:
 *
 *   1. Produces a random but deterministic embedding for each token
 *   2. Runs scaled dot-product attention via `/api/transformer/attention`
 *   3. Renders the attention weights as a colored heatmap (query rows ×
 *      key columns)
 *   4. Shows the final attended output vectors below
 *
 * No backend rendering — it calls the REST endpoint we just wired up
 * and displays the JSON response as an interactive visualization.
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

export default function TransformerDemoPage() {
  const [input, setInput] = useState<string>(
    "attention, is, all, you, need",
  );
  const [dim, setDim] = useState<number>(8);
  const [response, setResponse] = useState<AttentionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      </div>
    </div>
  );
}
