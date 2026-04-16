import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import type { Canvas2DConfig } from '@shared/schemas/graphics';
import { setupHiDPICanvas, clearCanvas, exportCanvasAsPNG, exportCanvasAsJPEG, downloadCanvas } from './canvas-utils';

export interface CanvasEngineRef {
  getCanvas: () => HTMLCanvasElement | null;
  getContext: () => CanvasRenderingContext2D | null;
  exportPNG: () => Promise<Blob>;
  exportJPEG: (quality?: number) => Promise<Blob>;
  download: (filename: string, format?: 'png' | 'jpeg') => void;
  clear: (color?: string) => void;
}

interface CanvasEngineProps {
  config: Canvas2DConfig;
  className?: string;
  onFrame?: (ctx: CanvasRenderingContext2D, deltaTime: number) => void;
  onReady?: (ctx: CanvasRenderingContext2D) => void;
}

export const CanvasEngine = forwardRef<CanvasEngineRef, CanvasEngineProps>(
  function CanvasEngine({ config, className, onFrame, onReady }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const contextRef = useRef<CanvasRenderingContext2D | null>(null);
    const animationFrameRef = useRef<number>(0);
    const lastTimeRef = useRef<number>(0);
    const isRunningRef = useRef<boolean>(false);

    const getNumericDimension = useCallback((value: number | string | undefined, fallback: number): number => {
      if (value === undefined) return fallback;
      if (typeof value === 'number') return value;
      const parsed = parseFloat(value);
      return isNaN(parsed) ? fallback : parsed;
    }, []);

    const width = getNumericDimension(config.width, 800);
    const height = getNumericDimension(config.height, 600);

    useImperativeHandle(ref, () => ({
      getCanvas: () => canvasRef.current,
      getContext: () => contextRef.current,
      exportPNG: () => {
        if (!canvasRef.current) return Promise.reject(new Error('Canvas not available'));
        return exportCanvasAsPNG(canvasRef.current);
      },
      exportJPEG: (quality?: number) => {
        if (!canvasRef.current) return Promise.reject(new Error('Canvas not available'));
        return exportCanvasAsJPEG(canvasRef.current, quality);
      },
      download: (filename: string, format?: 'png' | 'jpeg') => {
        if (!canvasRef.current) return;
        downloadCanvas(canvasRef.current, filename, format);
      },
      clear: (color?: string) => {
        if (!contextRef.current) return;
        clearCanvas(contextRef.current, color);
      },
    }), []);

    const animationLoop = useCallback((timestamp: number) => {
      if (!isRunningRef.current || !contextRef.current) return;

      const deltaTime = lastTimeRef.current ? (timestamp - lastTimeRef.current) / 1000 : 0;
      lastTimeRef.current = timestamp;

      if (config.targetFPS) {
        const targetFrameTime = 1000 / config.targetFPS;
        if (deltaTime * 1000 < targetFrameTime * 0.9) {
          animationFrameRef.current = requestAnimationFrame(animationLoop);
          return;
        }
      }

      if (onFrame) {
        onFrame(contextRef.current, deltaTime);
      }

      animationFrameRef.current = requestAnimationFrame(animationLoop);
    }, [config.targetFPS, onFrame]);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      contextRef.current = ctx;
      setupHiDPICanvas(canvas, ctx, width, height);

      if (config.background) {
        clearCanvas(ctx, config.background);
      }

      if (onReady) {
        onReady(ctx);
      }

      if (config.animationLoop && onFrame) {
        isRunningRef.current = true;
        lastTimeRef.current = 0;
        animationFrameRef.current = requestAnimationFrame(animationLoop);
      }

      return () => {
        isRunningRef.current = false;
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
      };
    }, [width, height, config.background, config.animationLoop, onFrame, onReady, animationLoop]);

    useEffect(() => {
      if (!config.responsive) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width: newWidth, height: newHeight } = entry.contentRect;
          const ctx = contextRef.current;
          if (ctx && newWidth > 0 && newHeight > 0) {
            setupHiDPICanvas(canvas, ctx, newWidth, newHeight);
            if (config.background) {
              clearCanvas(ctx, config.background);
            }
          }
        }
      });

      const parent = canvas.parentElement;
      if (parent) {
        resizeObserver.observe(parent);
      }

      return () => {
        resizeObserver.disconnect();
      };
    }, [config.responsive, config.background]);

    return (
      <canvas
        ref={canvasRef}
        className={className}
        data-testid={`canvas-engine-${config.id}`}
        style={{
          display: 'block',
          width: config.responsive ? '100%' : width,
          height: config.responsive ? '100%' : height,
        }}
      />
    );
  }
);

export default CanvasEngine;
