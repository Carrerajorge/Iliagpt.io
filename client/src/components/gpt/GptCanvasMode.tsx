import { useEffect, useRef, useState } from "react";
import { Code2, Zap, Layers, Box } from "lucide-react";
import { supportsHtmlInCanvas } from "@/lib/gpt-category";

/**
 * Canvas de programación para GPTs con categoría "coding".
 * Permite renderizar HTML/1D/2D/3D dentro de un <canvas> usando la API
 * experimental html-in-canvas (layoutsubtree + drawElementImage) cuando está
 * disponible (Chrome con flag enable-experimental-web-platform-features).
 * Fallback: lienzo 2D clásico con iframe sandbox para HTML.
 */
interface GptCanvasModeProps {
  initialCode?: string;
  dimension?: "1d" | "2d" | "3d" | "html";
}

const SAMPLE_HTML = `<div style="padding:24px;font-family:ui-sans-serif;background:linear-gradient(135deg,#6366f1,#a855f7);color:white;border-radius:16px">
  <h2 style="margin:0 0 8px">Hola desde html-in-canvas</h2>
  <p style="margin:0;opacity:.85">Este DOM se está rasterizando dentro de un &lt;canvas&gt;.</p>
</div>`;

export function GptCanvasMode({ initialCode = SAMPLE_HTML, dimension = "html" }: GptCanvasModeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const domRef = useRef<HTMLDivElement>(null);
  const [supported, setSupported] = useState(false);
  const [code, setCode] = useState(initialCode);
  const [activeDim, setActiveDim] = useState<GptCanvasModeProps["dimension"]>(dimension);

  useEffect(() => {
    setSupported(supportsHtmlInCanvas());
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (supported) {
      canvas.setAttribute("layoutsubtree", "");
    }

    let raf = 0;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    let t = 0;
    const render = () => {
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.clearRect(0, 0, w, h);

      if (activeDim === "1d") {
        // Waveform 1D
        ctx.strokeStyle = "rgba(16,185,129,0.85)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let x = 0; x < w; x++) {
          const y = h / 2 + Math.sin(x * 0.03 + t * 0.05) * 40;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      } else if (activeDim === "2d") {
        // Rotating polygon
        ctx.save();
        ctx.translate(w / 2, h / 2);
        ctx.rotate(t * 0.01);
        ctx.strokeStyle = "rgba(14,165,233,0.85)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i <= 6; i++) {
          const a = (i * Math.PI * 2) / 6;
          const r = 80 + Math.sin(t * 0.03 + i) * 20;
          const px = Math.cos(a) * r;
          const py = Math.sin(a) * r;
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.restore();
      } else if (activeDim === "3d") {
        // Pseudo-3D cube wireframe
        const cx = w / 2;
        const cy = h / 2;
        const size = 70;
        const angle = t * 0.015;
        const verts = [
          [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
          [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
        ].map(([x, y, z]) => {
          const rx = x * Math.cos(angle) - z * Math.sin(angle);
          const rz = x * Math.sin(angle) + z * Math.cos(angle);
          const ry = y * Math.cos(angle * 0.7) - rz * Math.sin(angle * 0.7);
          const rz2 = y * Math.sin(angle * 0.7) + rz * Math.cos(angle * 0.7);
          const scale = 300 / (300 + rz2 * size);
          return [cx + rx * size * scale, cy + ry * size * scale];
        });
        const edges = [
          [0, 1], [1, 2], [2, 3], [3, 0],
          [4, 5], [5, 6], [6, 7], [7, 4],
          [0, 4], [1, 5], [2, 6], [3, 7],
        ];
        ctx.strokeStyle = "rgba(168,85,247,0.9)";
        ctx.lineWidth = 1.5;
        for (const [a, b] of edges) {
          ctx.beginPath();
          ctx.moveTo(verts[a][0], verts[a][1]);
          ctx.lineTo(verts[b][0], verts[b][1]);
          ctx.stroke();
        }
      } else if (activeDim === "html" && supported && domRef.current) {
        // html-in-canvas native path
        try {
          (ctx as any).drawElementImage(domRef.current, 0, 0);
        } catch {
          // ignore — fallback shown via iframe below
        }
      }

      t += 1;
      raf = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [activeDim, supported, code]);

  return (
    <div className="flex flex-col h-full bg-background">
      <header className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <Code2 className="h-4 w-4 text-emerald-500" />
          <span className="font-semibold text-sm">Canvas de programación</span>
          <span
            className={
              "text-[10px] px-2 py-0.5 rounded-full " +
              (supported
                ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/30"
                : "bg-amber-500/10 text-amber-600 border border-amber-500/30")
            }
            title={
              supported
                ? "html-in-canvas activo (Chrome flag enable-experimental-web-platform-features)"
                : "Activa chrome://flags/#enable-experimental-web-platform-features para render HTML nativo en canvas"
            }
          >
            {supported ? "html-in-canvas ON" : "fallback 2D"}
          </span>
        </div>
        <div className="flex items-center gap-1 text-xs">
          {(["1d", "2d", "3d", "html"] as const).map((d) => (
            <button
              key={d}
              onClick={() => setActiveDim(d)}
              className={
                "px-2.5 py-1 rounded-md border transition-colors " +
                (activeDim === d
                  ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-600"
                  : "border-border hover:bg-muted")
              }
              data-testid={`canvas-dim-${d}`}
            >
              {d === "1d" && <Zap className="inline h-3 w-3 mr-1" />}
              {d === "2d" && <Layers className="inline h-3 w-3 mr-1" />}
              {d === "3d" && <Box className="inline h-3 w-3 mr-1" />}
              {d === "html" && <Code2 className="inline h-3 w-3 mr-1" />}
              {d.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 grid grid-cols-2 gap-0 overflow-hidden">
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="font-mono text-xs p-4 bg-neutral-950 text-emerald-300 outline-none resize-none border-r"
          spellCheck={false}
          data-testid="canvas-code-input"
        />
        <div className="relative bg-neutral-900 overflow-hidden">
          {/* Hidden DOM source that the canvas will rasterize via drawElementImage */}
          <div
            ref={domRef}
            className="absolute -left-[9999px] top-0 w-[600px]"
            dangerouslySetInnerHTML={{ __html: code }}
          />
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" data-testid="canvas-render-target" />
          {activeDim === "html" && !supported && (
            <iframe
              title="HTML preview fallback"
              sandbox="allow-scripts"
              srcDoc={code}
              className="absolute inset-0 w-full h-full bg-white"
            />
          )}
        </div>
      </div>
    </div>
  );
}
