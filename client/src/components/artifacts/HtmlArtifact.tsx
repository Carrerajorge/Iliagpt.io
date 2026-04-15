import { useState, useCallback, useRef, useEffect } from "react";
import { Eye, Code, Copy, Check, Layers, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface HtmlArtifactProps {
  content: string;
}

// Detect if html-in-canvas API is available (Chrome Canary / Brave 147+)
function detectHtmlInCanvas(): boolean {
  try {
    const testCanvas = document.createElement("canvas");
    testCanvas.setAttribute("layoutsubtree", "");
    const ctx = testCanvas.getContext("2d");
    return !!(ctx && typeof (ctx as any).drawElementImage === "function");
  } catch {
    return false;
  }
}

// Cascade particle effect for canvas overlay
function createCascadeEffect(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};

  const particles: Array<{
    x: number; y: number; vy: number; vx: number;
    size: number; opacity: number; life: number; maxLife: number;
  }> = [];
  let animFrame = 0;
  let tick = 0;

  function animate() {
    tick++;
    ctx!.clearRect(0, 0, canvas.width, canvas.height);

    if (tick % 4 === 0 && particles.length < 40) {
      particles.push({
        x: Math.random() * canvas.width,
        y: -5,
        vx: (Math.random() - 0.5) * 0.4,
        vy: 0.3 + Math.random() * 0.6,
        size: 0.5 + Math.random() * 1.5,
        opacity: 0.08 + Math.random() * 0.15,
        life: 0,
        maxLife: 250 + Math.random() * 200,
      });
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life++;
      const fade = Math.max(0, 1 - p.life / p.maxLife);
      ctx!.globalAlpha = p.opacity * fade;
      ctx!.fillStyle = document.documentElement.classList.contains("dark") ? "#fff" : "#000";
      ctx!.beginPath();
      ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx!.fill();
      if (p.life > p.maxLife || p.y > canvas.height + 10) {
        particles.splice(i, 1);
      }
    }
    ctx!.globalAlpha = 1;
    animFrame = requestAnimationFrame(animate);
  }

  animate();
  return () => cancelAnimationFrame(animFrame);
}

export function HtmlArtifact({ content }: HtmlArtifactProps) {
  const [view, setView] = useState<"preview" | "canvas3d" | "source">("preview");
  const [copied, setCopied] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const hasHtmlInCanvas = useRef(false);

  useEffect(() => {
    hasHtmlInCanvas.current = detectHtmlInCanvas();
  }, []);

  // Initialize canvas 3D view with html-in-canvas or cascade fallback
  useEffect(() => {
    if (view !== "canvas3d" || !canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    canvas.width = container.offsetWidth;
    canvas.height = container.offsetHeight;

    if (hasHtmlInCanvas.current) {
      // Native html-in-canvas: set layoutsubtree and render iframe content
      canvas.setAttribute("layoutsubtree", "");
      const ctx = canvas.getContext("2d");
      if (ctx && iframeRef.current) {
        const drawFrame = () => {
          try {
            (ctx as any).drawElementImage(iframeRef.current!, 0, 0);
          } catch { /* element not ready yet */ }
        };
        const interval = setInterval(drawFrame, 100);
        cleanupRef.current = () => clearInterval(interval);
      }
    }

    // Always add cascade particle overlay
    const stopCascade = createCascadeEffect(canvas);

    return () => {
      stopCascade();
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [view]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, [content]);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!fullscreen) {
      containerRef.current.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
    setFullscreen(!fullscreen);
  }, [fullscreen]);

  return (
    <div ref={containerRef} className={cn("flex flex-col h-full", fullscreen && "fixed inset-0 z-50 bg-white dark:bg-black")}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-black">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-7 gap-1.5 text-xs rounded-lg",
              view === "preview"
                ? "bg-black text-white dark:bg-white dark:text-black"
                : "text-neutral-500 hover:text-black dark:hover:text-white"
            )}
            onClick={() => setView("preview")}
          >
            <Eye className="h-3.5 w-3.5" />
            Preview
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-7 gap-1.5 text-xs rounded-lg",
              view === "canvas3d"
                ? "bg-black text-white dark:bg-white dark:text-black"
                : "text-neutral-500 hover:text-black dark:hover:text-white"
            )}
            onClick={() => setView("canvas3d")}
          >
            <Layers className="h-3.5 w-3.5" />
            Canvas 3D
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-7 gap-1.5 text-xs rounded-lg",
              view === "source"
                ? "bg-black text-white dark:bg-white dark:text-black"
                : "text-neutral-500 hover:text-black dark:hover:text-white"
            )}
            onClick={() => setView("source")}
          >
            <Code className="h-3.5 w-3.5" />
            Source
          </Button>
        </div>
        <div className="flex items-center gap-1">
          {view === "canvas3d" && (
            <span className="text-[10px] text-neutral-400 mr-2">
              {hasHtmlInCanvas.current ? "html-in-canvas nativo" : "cascade mode"}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs text-neutral-500 hover:text-black dark:hover:text-white"
            onClick={toggleFullscreen}
          >
            {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs text-neutral-500 hover:text-black dark:hover:text-white"
            onClick={handleCopy}
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-black dark:text-white" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                Copy
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto relative">
        {view === "preview" && (
          <iframe
            ref={iframeRef}
            srcDoc={content}
            sandbox="allow-scripts"
            className="w-full h-full border-0 bg-white"
            title="HTML Preview"
          />
        )}
        {view === "canvas3d" && (
          <div className="relative w-full h-full bg-white dark:bg-black">
            {/* Hidden iframe for html-in-canvas source */}
            <iframe
              ref={iframeRef}
              srcDoc={content}
              sandbox="allow-scripts"
              className={cn(
                "w-full h-full border-0",
                hasHtmlInCanvas.current ? "absolute inset-0 z-10" : "absolute inset-0 z-10"
              )}
              title="Canvas Source"
            />
            {/* Canvas overlay with cascade particles + html-in-canvas rendering */}
            <canvas
              ref={canvasRef}
              className="absolute inset-0 z-20 pointer-events-none"
            />
          </div>
        )}
        {view === "source" && (
          <pre className="p-4 text-sm font-mono bg-neutral-950 text-neutral-200 whitespace-pre-wrap h-full overflow-auto">
            {content}
          </pre>
        )}
      </div>
    </div>
  );
}
