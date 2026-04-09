import { useEffect, useRef } from "react";

export interface NDDataPoint {
  values: number[]; // one value per dimension
  label?: string;
}

interface MathGraphNDProps {
  points: NDDataPoint[];
  dimensionLabels?: string[];
  title?: string;
  mode?: "parallel" | "scatter-matrix" | "radar";
  colorBy?: number; // which dimension index to use for color
}

function normalizeValues(points: NDDataPoint[]): NDDataPoint[] {
  if (points.length === 0) return points;
  const dims = points[0].values.length;
  const mins: number[] = Array(dims).fill(Infinity);
  const maxs: number[] = Array(dims).fill(-Infinity);

  for (const pt of points) {
    for (let d = 0; d < dims; d++) {
      mins[d] = Math.min(mins[d], pt.values[d]);
      maxs[d] = Math.max(maxs[d], pt.values[d]);
    }
  }

  return points.map((pt) => ({
    ...pt,
    values: pt.values.map((v, d) => {
      const range = maxs[d] - mins[d];
      return range < 1e-10 ? 0.5 : (v - mins[d]) / range;
    }),
  }));
}

function colorFromIndex(i: number, total: number): string {
  const hue = (i / Math.max(total - 1, 1)) * 280;
  return `hsl(${hue}, 80%, 60%)`;
}

function colorFromValue(t: number): string {
  const hue = (1 - Math.min(1, Math.max(0, t))) * 240;
  return `hsl(${hue}, 80%, 60%)`;
}

function drawParallelCoords(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  points: NDDataPoint[],
  normalized: NDDataPoint[],
  labels: string[],
  colorBy: number
) {
  const dims = labels.length;
  const padding = { top: 40, bottom: 30, left: 40, right: 40 };
  const axisSpacing = (W - padding.left - padding.right) / (dims - 1);

  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, W, H);

  // Draw lines
  for (let pi = 0; pi < normalized.length; pi++) {
    const pt = normalized[pi];
    const color = colorBy >= 0 && colorBy < dims
      ? colorFromValue(pt.values[colorBy])
      : colorFromIndex(pi, normalized.length);

    ctx.strokeStyle = color.replace("60%", "60%").replace("hsl", "hsla").replace(")", ",0.6)");
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let d = 0; d < dims; d++) {
      const ax = padding.left + d * axisSpacing;
      const ay = padding.top + (1 - pt.values[d]) * (H - padding.top - padding.bottom);
      if (d === 0) ctx.moveTo(ax, ay);
      else ctx.lineTo(ax, ay);
    }
    ctx.stroke();
  }

  // Draw axes
  for (let d = 0; d < dims; d++) {
    const ax = padding.left + d * axisSpacing;
    ctx.strokeStyle = "#475569";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ax, padding.top);
    ctx.lineTo(ax, H - padding.bottom);
    ctx.stroke();

    // Axis label
    ctx.fillStyle = "#94a3b8";
    ctx.font = "11px monospace";
    ctx.textAlign = "center";
    ctx.fillText(labels[d] ?? `D${d + 1}`, ax, padding.top - 8);

    // Min/max ticks
    ctx.fillStyle = "#64748b";
    ctx.font = "9px monospace";
    const rawPts = points.map((p) => p.values[d]);
    const mn = Math.min(...rawPts);
    const mx = Math.max(...rawPts);
    ctx.fillText(mn.toFixed(1), ax, H - padding.bottom + 12);
    ctx.fillText(mx.toFixed(1), ax, padding.top + 3);
  }
}

function drawScatterMatrix(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  points: NDDataPoint[],
  normalized: NDDataPoint[],
  labels: string[]
) {
  const dims = Math.min(labels.length, 5); // cap at 5x5 to keep it readable
  const padding = 30;
  const cellW = (W - padding) / dims;
  const cellH = (H - padding) / dims;

  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, W, H);

  for (let row = 0; row < dims; row++) {
    for (let col = 0; col < dims; col++) {
      const x0 = padding + col * cellW;
      const y0 = padding + row * cellH;

      // Cell background
      ctx.fillStyle = "#0d1929";
      ctx.fillRect(x0 + 1, y0 + 1, cellW - 2, cellH - 2);

      if (row === col) {
        // Diagonal: dimension label
        ctx.fillStyle = "#64748b";
        ctx.font = "bold 11px monospace";
        ctx.textAlign = "center";
        ctx.fillText(labels[col] ?? `D${col + 1}`, x0 + cellW / 2, y0 + cellH / 2 + 4);
      } else {
        // Scatter plot
        for (let pi = 0; pi < normalized.length; pi++) {
          const pt = normalized[pi];
          const px = x0 + 4 + pt.values[col] * (cellW - 8);
          const py = y0 + cellH - 4 - pt.values[row] * (cellH - 8);
          ctx.fillStyle = colorFromIndex(pi, normalized.length).replace("hsl", "hsla").replace(")", ",0.7)");
          ctx.beginPath();
          ctx.arc(px, py, 2, 0, 2 * Math.PI);
          ctx.fill();
        }
      }

      // Cell border
      ctx.strokeStyle = "#1e293b";
      ctx.lineWidth = 1;
      ctx.strokeRect(x0, y0, cellW, cellH);
    }
  }

  // Axes labels at the top and left
  ctx.fillStyle = "#475569";
  ctx.font = "10px monospace";
  for (let d = 0; d < dims; d++) {
    ctx.textAlign = "center";
    ctx.fillText(labels[d] ?? `D${d + 1}`, padding + d * cellW + cellW / 2, 18);
  }
}

function drawRadar(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  points: NDDataPoint[],
  normalized: NDDataPoint[],
  labels: string[]
) {
  const dims = labels.length;
  const cx = W / 2, cy = H / 2;
  const R = Math.min(W, H) * 0.38;

  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, W, H);

  // Draw grid rings
  for (let ring = 1; ring <= 5; ring++) {
    const r = (ring / 5) * R;
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let d = 0; d < dims; d++) {
      const angle = (d / dims) * 2 * Math.PI - Math.PI / 2;
      const px = cx + r * Math.cos(angle);
      const py = cy + r * Math.sin(angle);
      if (d === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // Draw spokes
  for (let d = 0; d < dims; d++) {
    const angle = (d / dims) * 2 * Math.PI - Math.PI / 2;
    ctx.strokeStyle = "#475569";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + R * Math.cos(angle), cy + R * Math.sin(angle));
    ctx.stroke();

    // Labels
    const lx = cx + (R + 18) * Math.cos(angle);
    const ly = cy + (R + 18) * Math.sin(angle);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "10px monospace";
    ctx.textAlign = Math.abs(Math.cos(angle)) < 0.1 ? "center" : Math.cos(angle) > 0 ? "left" : "right";
    ctx.fillText(labels[d] ?? `D${d + 1}`, lx, ly + 4);
  }

  // Draw data polygons
  for (let pi = 0; pi < normalized.length; pi++) {
    const pt = normalized[pi];
    const color = colorFromIndex(pi, normalized.length);

    ctx.strokeStyle = color;
    ctx.fillStyle = color.replace("hsl", "hsla").replace(")", ",0.15)");
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    for (let d = 0; d < dims; d++) {
      const angle = (d / dims) * 2 * Math.PI - Math.PI / 2;
      const r = pt.values[d] * R;
      const px = cx + r * Math.cos(angle);
      const py = cy + r * Math.sin(angle);
      if (d === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

export default function MathGraphND({
  points,
  dimensionLabels,
  title,
  mode = "parallel",
  colorBy = 0,
}: MathGraphNDProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const dims = points[0]?.values.length ?? 0;
  const labels = dimensionLabels ?? Array.from({ length: dims }, (_, i) => `x${i + 1}`);
  const normalized = normalizeValues(points);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx || points.length === 0) return;

    const W = canvas.width;
    const H = canvas.height;

    if (mode === "parallel") {
      drawParallelCoords(ctx, W, H, points, normalized, labels, colorBy);
    } else if (mode === "scatter-matrix") {
      drawScatterMatrix(ctx, W, H, points, normalized, labels);
    } else if (mode === "radar") {
      drawRadar(ctx, W, H, points, normalized, labels);
    }

    // Title
    if (title) {
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(title, W / 2, 18);
    }

    // Dimension info
    ctx.fillStyle = "#64748b";
    ctx.font = "10px monospace";
    ctx.textAlign = "right";
    ctx.fillText(`${dims}D · ${points.length} pts`, W - 10, H - 6);
  }, [points, normalized, labels, mode, colorBy, title, dims]);

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvasRef}
        width={600}
        height={400}
        style={{ width: "100%", height: "auto", borderRadius: 8 }}
      />
      <p className="text-xs text-muted-foreground px-2">
        {dims}D visualization via {mode === "parallel" ? "parallel coordinates" : mode === "scatter-matrix" ? "scatter matrix" : "radar chart"}
      </p>
    </div>
  );
}
