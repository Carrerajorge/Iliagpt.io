import { useEffect, useRef, useState, useCallback } from "react";

interface MathGraph4DProps {
  expression: string; // w = f(x, y, z) — visualized as animated 3D slices
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
  zMin?: number;
  zMax?: number;
  title?: string;
  resolution?: number;
}

function evaluate4D(expr: string, x: number, y: number, z: number): number {
  try {
    const cleaned = expr
      .replace(/\^/g, "**")
      .replace(/\bx\b/g, `(${x})`)
      .replace(/\by\b/g, `(${y})`)
      .replace(/\bz\b/g, `(${z})`)
      .replace(/π/g, String(Math.PI))
      .replace(/pi/gi, String(Math.PI))
      .replace(/sin\(/g, "Math.sin(")
      .replace(/cos\(/g, "Math.cos(")
      .replace(/tan\(/g, "Math.tan(")
      .replace(/sqrt\(/g, "Math.sqrt(")
      .replace(/abs\(/g, "Math.abs(")
      .replace(/exp\(/g, "Math.exp(");
    // eslint-disable-next-line no-new-func
    const fn = new Function("Math", `return ${cleaned}`);
    const result = fn(Math);
    return typeof result === "number" && isFinite(result) ? result : NaN;
  } catch {
    return NaN;
  }
}

function colorFromValue(t: number): string {
  // t in [0,1], map to a vivid color gradient
  const h = (1 - t) * 240; // blue to red via HSL
  return `hsl(${h}, 80%, 55%)`;
}

export default function MathGraph4D({
  expression,
  xMin = -3,
  xMax = 3,
  yMin = -3,
  yMax = 3,
  zMin = -3,
  zMax = 3,
  title,
  resolution = 20,
}: MathGraph4DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [zSlice, setZSlice] = useState(0);
  const [rotation, setRotation] = useState({ x: 0.5, y: 0.3 });
  const [isDragging, setIsDragging] = useState(false);
  const [lastMouse, setLastMouse] = useState({ x: 0, y: 0 });
  const frameRef = useRef(0);

  const drawSlice = useCallback((zVal: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2;
    const cy = H / 2;
    const N = resolution;

    // Compute grid for this z slice
    const grid: number[][] = [];
    let wMin = Infinity, wMax = -Infinity;
    for (let i = 0; i <= N; i++) {
      grid[i] = [];
      for (let j = 0; j <= N; j++) {
        const x = xMin + (i / N) * (xMax - xMin);
        const y = yMin + (j / N) * (yMax - yMin);
        const w = evaluate4D(expression, x, y, zVal);
        grid[i][j] = isNaN(w) ? 0 : w;
        if (!isNaN(w)) { wMin = Math.min(wMin, w); wMax = Math.max(wMax, w); }
      }
    }
    if (!isFinite(wMin)) wMin = -1;
    if (!isFinite(wMax)) wMax = 1;
    const wRange = wMax - wMin || 1;

    const cosX = Math.cos(rotation.x);
    const sinX = Math.sin(rotation.x);
    const cosY = Math.cos(rotation.y);
    const sinY = Math.sin(rotation.y);

    const xRange = xMax - xMin;
    const scale = (Math.min(W, H) * 0.9) / (3 * xRange);

    function project(ix: number, jy: number): [number, number] {
      const nx = (ix / N - 0.5) * xRange;
      const ny = (jy / N - 0.5) * xRange;
      const nz = 0;

      const rx = nx * cosY - nz * sinY;
      const rz = nx * sinY + nz * cosY;
      const ry1 = ny * cosX - rz * sinX;
      const rz2 = ny * sinX + rz * cosX;

      const perspective = 4 / (4 + rz2);
      return [cx + rx * scale * perspective, cy - ry1 * scale * perspective];
    }

    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, W, H);

    // Draw colored cells (2D projection of the z-slice, colored by w value)
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const wVal = (grid[i][j] - wMin) / wRange;
        const [p00x, p00y] = project(i, j);
        const [p10x, p10y] = project(i + 1, j);
        const [p11x, p11y] = project(i + 1, j + 1);
        const [p01x, p01y] = project(i, j + 1);

        ctx.fillStyle = colorFromValue(wVal);
        ctx.beginPath();
        ctx.moveTo(p00x, p00y);
        ctx.lineTo(p10x, p10y);
        ctx.lineTo(p11x, p11y);
        ctx.lineTo(p01x, p01y);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.15)";
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }

    // Info overlay
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "center";
    if (title) ctx.fillText(title, W / 2, 20);

    ctx.fillStyle = "#94a3b8";
    ctx.font = "11px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`w = ${expression}`, 10, H - 28);
    ctx.fillText(`z-slice: ${zVal.toFixed(2)}`, 10, H - 12);

    // Color legend
    const lgW = 80, lgH = 10, lgX = W - lgW - 10, lgY = H - 25;
    const lgGrad = ctx.createLinearGradient(lgX, 0, lgX + lgW, 0);
    lgGrad.addColorStop(0, "hsl(240,80%,55%)");
    lgGrad.addColorStop(0.5, "hsl(120,80%,55%)");
    lgGrad.addColorStop(1, "hsl(0,80%,55%)");
    ctx.fillStyle = lgGrad;
    ctx.fillRect(lgX, lgY, lgW, lgH);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "9px monospace";
    ctx.textAlign = "left";
    ctx.fillText(wMin.toFixed(1), lgX, lgY + lgH + 10);
    ctx.textAlign = "right";
    ctx.fillText(wMax.toFixed(1), lgX + lgW, lgY + lgH + 10);
    ctx.textAlign = "center";
    ctx.fillText("w", lgX + lgW / 2, lgY - 3);
  }, [expression, xMin, xMax, yMin, yMax, rotation, resolution, title]);

  useEffect(() => {
    if (!isPlaying) {
      drawSlice(zMin + (zSlice / 100) * (zMax - zMin));
      return;
    }

    let t = frameRef.current;
    const animate = () => {
      t += 0.005;
      frameRef.current = t;
      const z = zMin + ((Math.sin(t) + 1) / 2) * (zMax - zMin);
      setZSlice(Math.round(((z - zMin) / (zMax - zMin)) * 100));
      drawSlice(z);
      animRef.current = requestAnimationFrame(animate);
    };
    animRef.current = requestAnimationFrame(animate);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [isPlaying, drawSlice, zMin, zMax, zSlice]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setLastMouse({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = (e.clientX - lastMouse.x) * 0.01;
    const dy = (e.clientY - lastMouse.y) * 0.01;
    setRotation((r) => ({ x: r.x + dy, y: r.y + dx }));
    setLastMouse({ x: e.clientX, y: e.clientY });
  };

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvasRef}
        width={600}
        height={420}
        style={{ width: "100%", height: "auto", cursor: isDragging ? "grabbing" : "grab", borderRadius: 8 }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={() => setIsDragging(false)}
        onMouseLeave={() => setIsDragging(false)}
      />
      <div className="flex items-center justify-between px-2 flex-wrap gap-2">
        <p className="text-xs text-muted-foreground">
          4D via animated z-slices · Color = w value · Drag to rotate
        </p>
        <div className="flex gap-2 items-center">
          <button
            className={`text-xs px-2 py-1 rounded border ${isPlaying ? "bg-primary text-primary-foreground" : "border-border text-muted-foreground"}`}
            onClick={() => setIsPlaying((p) => !p)}
          >
            {isPlaying ? "⏸ Pause" : "▶ Play"}
          </button>
          {!isPlaying && (
            <input
              type="range"
              min={0}
              max={100}
              value={zSlice}
              onChange={(e) => setZSlice(Number(e.target.value))}
              className="w-24"
            />
          )}
          <button
            className="text-xs text-muted-foreground hover:text-foreground underline"
            onClick={() => setRotation({ x: 0.5, y: 0.3 })}
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}
