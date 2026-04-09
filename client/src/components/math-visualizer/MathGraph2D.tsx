import { useState, useEffect, useRef, useCallback } from "react";

interface MathGraph2DProps {
  expression: string;
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
  title?: string;
  color?: string;
  additionalExpressions?: Array<{ expr: string; color: string; label?: string }>;
  isPolar?: boolean;
  isParametric?: boolean;
  paramExprX?: string;
  paramExprY?: string;
  tMin?: number;
  tMax?: number;
}

function evaluateExpression(expr: string, varName: string, value: number): number {
  try {
    // Replace common math notation
    const cleaned = expr
      .replace(/\^/g, "**")
      .replace(new RegExp(`\\b${varName}\\b`, "g"), `(${value})`)
      .replace(/π/g, String(Math.PI))
      .replace(/pi/gi, String(Math.PI))
      .replace(/e\b/g, String(Math.E))
      .replace(/sin\(/g, "Math.sin(")
      .replace(/cos\(/g, "Math.cos(")
      .replace(/tan\(/g, "Math.tan(")
      .replace(/sqrt\(/g, "Math.sqrt(")
      .replace(/abs\(/g, "Math.abs(")
      .replace(/log\(/g, "Math.log10(")
      .replace(/ln\(/g, "Math.log(")
      .replace(/exp\(/g, "Math.exp(")
      .replace(/floor\(/g, "Math.floor(")
      .replace(/ceil\(/g, "Math.ceil(")
      .replace(/pow\(/g, "Math.pow(");
    // eslint-disable-next-line no-new-func
    const fn = new Function("Math", `return ${cleaned}`);
    const result = fn(Math);
    if (typeof result !== "number" || !isFinite(result)) return NaN;
    return result;
  } catch {
    return NaN;
  }
}

function generatePoints(
  expr: string,
  xMin: number,
  xMax: number,
  steps = 400
): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  const step = (xMax - xMin) / steps;
  for (let i = 0; i <= steps; i++) {
    const x = xMin + i * step;
    const y = evaluateExpression(expr, "x", x);
    if (!isNaN(y)) {
      points.push({ x, y });
    }
  }
  return points;
}

function generatePolarPoints(
  expr: string,
  tMin: number,
  tMax: number,
  steps = 400
): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  const step = (tMax - tMin) / steps;
  for (let i = 0; i <= steps; i++) {
    const t = tMin + i * step;
    const r = evaluateExpression(expr, "t", t);
    if (!isNaN(r)) {
      points.push({ x: r * Math.cos(t), y: r * Math.sin(t) });
    }
  }
  return points;
}

function generateParametricPoints(
  exprX: string,
  exprY: string,
  tMin: number,
  tMax: number,
  steps = 400
): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  const step = (tMax - tMin) / steps;
  for (let i = 0; i <= steps; i++) {
    const t = tMin + i * step;
    const x = evaluateExpression(exprX, "t", t);
    const y = evaluateExpression(exprY, "t", t);
    if (!isNaN(x) && !isNaN(y)) {
      points.push({ x, y });
    }
  }
  return points;
}

export default function MathGraph2D({
  expression,
  xMin = -10,
  xMax = 10,
  yMin,
  yMax,
  title,
  color = "#4f46e5",
  additionalExpressions = [],
  isPolar = false,
  isParametric = false,
  paramExprX,
  paramExprY,
  tMin = 0,
  tMax = 2 * Math.PI,
}: MathGraph2DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [lastMouse, setLastMouse] = useState({ x: 0, y: 0 });
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null);

  const effectiveXMin = xMin / zoom + pan.x;
  const effectiveXMax = xMax / zoom + pan.x;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const padding = 40;

    // Compute data range
    let allPoints: Array<Array<{ x: number; y: number }>> = [];

    if (isPolar) {
      allPoints = [generatePolarPoints(expression, tMin, tMax)];
    } else if (isParametric && paramExprX && paramExprY) {
      allPoints = [generateParametricPoints(paramExprX, paramExprY, tMin, tMax)];
    } else {
      allPoints = [generatePoints(expression, effectiveXMin, effectiveXMax)];
      additionalExpressions.forEach((ae) => {
        allPoints.push(generatePoints(ae.expr, effectiveXMin, effectiveXMax));
      });
    }

    const allY = allPoints.flat().map((p) => p.y).filter((y) => !isNaN(y) && isFinite(y));
    const allX = allPoints.flat().map((p) => p.x).filter((x) => !isNaN(x) && isFinite(x));

    const dataXMin = isPolar || isParametric ? Math.min(...allX) : effectiveXMin;
    const dataXMax = isPolar || isParametric ? Math.max(...allX) : effectiveXMax;
    let dataYMin = yMin !== undefined ? yMin : Math.min(...allY);
    let dataYMax = yMax !== undefined ? yMax : Math.max(...allY);

    // Protect from collapsed range
    if (dataYMax - dataYMin < 0.001) {
      dataYMin -= 1;
      dataYMax += 1;
    }
    if (dataXMax - dataXMin < 0.001) {
      // skip
    }

    const toPixel = (x: number, y: number): [number, number] => {
      const px = padding + ((x - dataXMin) / (dataXMax - dataXMin)) * (W - 2 * padding);
      const py = H - padding - ((y - dataYMin) / (dataYMax - dataYMin)) * (H - 2 * padding);
      return [px, py];
    };

    // Clear
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 1;
    const xTicks = 10;
    const yTicks = 8;
    for (let i = 0; i <= xTicks; i++) {
      const x = dataXMin + (i / xTicks) * (dataXMax - dataXMin);
      const [px] = toPixel(x, 0);
      ctx.beginPath();
      ctx.moveTo(px, padding);
      ctx.lineTo(px, H - padding);
      ctx.stroke();
    }
    for (let i = 0; i <= yTicks; i++) {
      const y = dataYMin + (i / yTicks) * (dataYMax - dataYMin);
      const [, py] = toPixel(0, y);
      ctx.beginPath();
      ctx.moveTo(padding, py);
      ctx.lineTo(W - padding, py);
      ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = "#475569";
    ctx.lineWidth = 1.5;
    if (dataYMin <= 0 && dataYMax >= 0) {
      const [, py0] = toPixel(0, 0);
      ctx.beginPath();
      ctx.moveTo(padding, py0);
      ctx.lineTo(W - padding, py0);
      ctx.stroke();
    }
    if (dataXMin <= 0 && dataXMax >= 0) {
      const [px0] = toPixel(0, 0);
      ctx.beginPath();
      ctx.moveTo(px0, padding);
      ctx.lineTo(px0, H - padding);
      ctx.stroke();
    }

    // Axis labels
    ctx.fillStyle = "#94a3b8";
    ctx.font = "11px monospace";
    ctx.textAlign = "center";
    for (let i = 0; i <= xTicks; i++) {
      const x = dataXMin + (i / xTicks) * (dataXMax - dataXMin);
      const [px] = toPixel(x, dataYMin);
      ctx.fillText(x.toFixed(1), px, H - padding + 14);
    }
    ctx.textAlign = "right";
    for (let i = 0; i <= yTicks; i++) {
      const y = dataYMin + (i / yTicks) * (dataYMax - dataYMin);
      const [, py] = toPixel(dataXMin, y);
      ctx.fillText(y.toFixed(1), padding - 4, py + 4);
    }

    // Draw curves
    const colors = [color, ...additionalExpressions.map((ae) => ae.color)];
    allPoints.forEach((pts, idx) => {
      ctx.strokeStyle = colors[idx] ?? "#4f46e5";
      ctx.lineWidth = 2.5;
      ctx.lineJoin = "round";
      ctx.beginPath();
      let started = false;
      for (const pt of pts) {
        const [px, py] = toPixel(pt.x, pt.y);
        if (!started) {
          ctx.moveTo(px, py);
          started = true;
        } else {
          ctx.lineTo(px, py);
        }
      }
      ctx.stroke();
    });

    // Hover crosshair
    if (hoverPoint) {
      const [hpx, hpy] = toPixel(hoverPoint.x, hoverPoint.y);
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(hpx, padding);
      ctx.lineTo(hpx, H - padding);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(padding, hpy);
      ctx.lineTo(W - padding, hpy);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(hpx, hpy, 5, 0, 2 * Math.PI);
      ctx.fill();

      ctx.fillStyle = "#fff";
      ctx.font = "12px monospace";
      ctx.textAlign = "left";
      ctx.fillText(`(${hoverPoint.x.toFixed(2)}, ${hoverPoint.y.toFixed(2)})`, hpx + 8, hpy - 6);
    }

    // Title
    if (title) {
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(title, W / 2, 20);
    }
  }, [
    expression, effectiveXMin, effectiveXMax, yMin, yMax, color,
    additionalExpressions, isPolar, isParametric, paramExprX, paramExprY,
    tMin, tMax, hoverPoint, title, zoom, pan,
  ]);

  useEffect(() => {
    draw();
  }, [draw]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => Math.min(Math.max(z * delta, 0.1), 50));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setLastMouse({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const W = canvas.width;
    const H = canvas.height;
    const padding = 40;

    // Compute data range for cursor position
    const dataXMin = effectiveXMin;
    const dataXMax = effectiveXMax;

    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const dataX = dataXMin + ((mx - padding) / (W - 2 * padding)) * (dataXMax - dataXMin);
    const dataY = evaluateExpression(expression, "x", dataX);
    if (!isNaN(dataY)) {
      setHoverPoint({ x: dataX, y: dataY });
    }

    if (isDragging) {
      const dx = (e.clientX - lastMouse.x) / canvas.width * (xMax - xMin) / zoom;
      const dy = (e.clientY - lastMouse.y) / canvas.height * (xMax - xMin) / zoom;
      setPan((p) => ({ x: p.x - dx, y: p.y + dy }));
      setLastMouse({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseUp = () => setIsDragging(false);
  const handleMouseLeave = () => {
    setIsDragging(false);
    setHoverPoint(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvasRef}
        width={600}
        height={400}
        style={{ width: "100%", height: "auto", cursor: isDragging ? "grabbing" : "crosshair", borderRadius: 8 }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      />
      <div className="flex items-center justify-between px-2">
        <p className="text-xs text-muted-foreground">
          Scroll to zoom · Drag to pan
        </p>
        <button
          className="text-xs text-muted-foreground hover:text-foreground underline"
          onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
        >
          Reset view
        </button>
      </div>
    </div>
  );
}
