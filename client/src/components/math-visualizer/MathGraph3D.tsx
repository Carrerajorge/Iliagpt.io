import { useEffect, useRef, useState } from "react";

interface MathGraph3DProps {
  expression: string; // z = f(x, y)
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
  title?: string;
  colorScheme?: "viridis" | "plasma" | "cool" | "warm";
  wireframe?: boolean;
  resolution?: number;
}

function evaluateXY(expr: string, x: number, y: number): number {
  try {
    const cleaned = expr
      .replace(/\^/g, "**")
      .replace(/\bx\b/g, `(${x})`)
      .replace(/\by\b/g, `(${y})`)
      .replace(/π/g, String(Math.PI))
      .replace(/pi/gi, String(Math.PI))
      .replace(/sin\(/g, "Math.sin(")
      .replace(/cos\(/g, "Math.cos(")
      .replace(/tan\(/g, "Math.tan(")
      .replace(/sqrt\(/g, "Math.sqrt(")
      .replace(/abs\(/g, "Math.abs(")
      .replace(/log\(/g, "Math.log10(")
      .replace(/ln\(/g, "Math.log(")
      .replace(/exp\(/g, "Math.exp(")
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

function colorFromHeight(t: number, scheme: string): [number, number, number] {
  // t in [0, 1]
  switch (scheme) {
    case "plasma": {
      const r = Math.round(255 * Math.min(1, Math.max(0, 0.05 + 2.0 * t)));
      const g = Math.round(255 * Math.min(1, Math.max(0, 0.3 * t * (1 - t) * 4)));
      const b = Math.round(255 * Math.min(1, Math.max(0, 0.7 - t)));
      return [r, g, b];
    }
    case "cool": {
      const r = Math.round(255 * t);
      const g = Math.round(255 * (1 - t));
      const b = 255;
      return [r, g, b];
    }
    case "warm": {
      const r = 255;
      const g = Math.round(255 * (1 - t));
      const b = Math.round(100 * (1 - t));
      return [r, g, b];
    }
    default: { // viridis-ish
      const r = Math.round(255 * Math.min(1, Math.max(0, -0.5 + 2.5 * t)));
      const g = Math.round(255 * Math.min(1, Math.max(0, 0.8 * Math.sin(Math.PI * t))));
      const b = Math.round(255 * Math.min(1, Math.max(0, 0.9 - t)));
      return [r, g, b];
    }
  }
}

export default function MathGraph3D({
  expression,
  xMin = -5,
  xMax = 5,
  yMin = -5,
  yMax = 5,
  title,
  colorScheme = "viridis",
  wireframe: initialWireframe = false,
  resolution = 40,
}: MathGraph3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [wireframe, setWireframe] = useState(initialWireframe);
  const [scheme, setScheme] = useState(colorScheme);
  const [rotation, setRotation] = useState({ x: 0.5, y: 0.3 });
  const [isDragging, setIsDragging] = useState(false);
  const [lastMouse, setLastMouse] = useState({ x: 0, y: 0 });
  const [zoom3d, setZoom3d] = useState(1);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2;
    const cy = H / 2;

    // Generate grid
    const N = resolution;
    const grid: number[][] = [];
    let zMin = Infinity, zMax = -Infinity;

    for (let i = 0; i <= N; i++) {
      grid[i] = [];
      for (let j = 0; j <= N; j++) {
        const x = xMin + (i / N) * (xMax - xMin);
        const y = yMin + (j / N) * (yMax - yMin);
        const z = evaluateXY(expression, x, y);
        grid[i][j] = isNaN(z) ? 0 : z;
        if (!isNaN(z)) {
          zMin = Math.min(zMin, z);
          zMax = Math.max(zMax, z);
        }
      }
    }

    if (zMin === Infinity) zMin = -1;
    if (zMax === -Infinity) zMax = 1;
    const zRange = zMax - zMin || 1;

    // 3D projection with rotation
    const cosX = Math.cos(rotation.x);
    const sinX = Math.sin(rotation.x);
    const cosY = Math.cos(rotation.y);
    const sinY = Math.sin(rotation.y);

    const scale = (zoom3d * Math.min(W, H)) / (3.5 * (xMax - xMin));

    function project(ix: number, jy: number): [number, number, number] {
      const xRange = xMax - xMin;
      const yRange = yMax - yMin;
      const nx = (ix / N - 0.5) * xRange;
      const ny = (jy / N - 0.5) * yRange;
      const nz = ((grid[ix][jy] - zMin) / zRange - 0.5) * xRange;

      // Rotate around Y axis then X axis
      const rx = nx * cosY - nz * sinY;
      const rz = nx * sinY + nz * cosY;
      const ry1 = ny * cosX - rz * sinX;
      const rz2 = ny * sinX + rz * cosX;

      const perspective = 4 / (4 + rz2);
      const px = cx + rx * scale * perspective;
      const py = cy - ry1 * scale * perspective;
      return [px, py, grid[ix][jy]];
    }

    // Clear
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, W, H);

    // Sort faces by depth for painter's algorithm
    type Face = {
      pts: [number, number][];
      avgZ: number;
      zVal: number;
    };
    const faces: Face[] = [];

    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const [p00x, p00y, z00] = project(i, j);
        const [p10x, p10y, z10] = project(i + 1, j);
        const [p11x, p11y, z11] = project(i + 1, j + 1);
        const [p01x, p01y, z01] = project(i, j + 1);

        const avgZ = (z00 + z10 + z11 + z01) / 4;
        faces.push({
          pts: [[p00x, p00y], [p10x, p10y], [p11x, p11y], [p01x, p01y]],
          avgZ,
          zVal: (avgZ - zMin) / zRange,
        });
      }
    }

    // Sort back to front
    faces.sort((a, b) => a.avgZ - b.avgZ);

    // Draw faces
    for (const face of faces) {
      const [r, g, b] = colorFromHeight(face.zVal, scheme);
      ctx.beginPath();
      ctx.moveTo(face.pts[0][0], face.pts[0][1]);
      for (let k = 1; k < face.pts.length; k++) {
        ctx.lineTo(face.pts[k][0], face.pts[k][1]);
      }
      ctx.closePath();

      if (!wireframe) {
        ctx.fillStyle = `rgba(${r},${g},${b},0.85)`;
        ctx.fill();
      }
      ctx.strokeStyle = wireframe
        ? `rgba(${r},${g},${b},0.9)`
        : `rgba(${Math.max(0, r - 40)},${Math.max(0, g - 40)},${Math.max(0, b - 40)},0.3)`;
      ctx.lineWidth = wireframe ? 1 : 0.5;
      ctx.stroke();
    }

    // Title
    if (title) {
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(title, W / 2, 20);
    }

    // Expression label
    ctx.fillStyle = "#94a3b8";
    ctx.font = "11px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`z = ${expression}`, 10, H - 10);
  }, [expression, xMin, xMax, yMin, yMax, rotation, wireframe, scheme, zoom3d, resolution, title]);

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

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom3d((z) => Math.min(Math.max(z * (e.deltaY > 0 ? 0.9 : 1.1), 0.2), 5));
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
        onWheel={handleWheel}
      />
      <div className="flex items-center justify-between px-2 flex-wrap gap-2">
        <p className="text-xs text-muted-foreground">Drag to rotate · Scroll to zoom</p>
        <div className="flex gap-2">
          <button
            className={`text-xs px-2 py-1 rounded border ${wireframe ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"}`}
            onClick={() => setWireframe((w) => !w)}
          >
            Wireframe
          </button>
          <select
            className="text-xs border border-border rounded px-2 py-1 bg-background text-foreground"
            value={scheme}
            onChange={(e) => setScheme(e.target.value as typeof colorScheme)}
          >
            <option value="viridis">Viridis</option>
            <option value="plasma">Plasma</option>
            <option value="cool">Cool</option>
            <option value="warm">Warm</option>
          </select>
          <button
            className="text-xs text-muted-foreground hover:text-foreground underline"
            onClick={() => { setRotation({ x: 0.5, y: 0.3 }); setZoom3d(1); }}
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}
