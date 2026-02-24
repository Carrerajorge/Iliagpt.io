import React, { Suspense, lazy, useMemo } from 'react';
import { detectCapabilities, type WebGLConfig, type Canvas2DConfig } from '@shared/schemas/graphics';
import { CanvasEngine, type CanvasEngineRef } from '../canvas';
import type { ThreeEngineRef } from './three-engine-impl';
import { ThreeJSErrorBoundary } from '@/components/error-boundaries';

const ThreeEngineImpl = lazy(() => import('./three-engine-impl'));

interface ThreeEngineProps {
  config: WebGLConfig;
  className?: string;
  onReady?: (scene: any, camera: any, renderer: any) => void;
  onFrame?: (scene: any, camera: any, deltaTime: number) => void;
  ref?: React.Ref<ThreeEngineRef | CanvasEngineRef>;
}

function LoadingState({ width, height }: { width: number | string; height: number | string }) {
  const w = typeof width === 'number' ? `${width}px` : width;
  const h = typeof height === 'number' ? `${height}px` : height;

  return (
    <div
      data-testid="three-engine-loading"
      style={{
        width: w,
        height: h,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#1a1a2e',
        color: '#ffffff',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            width: '40px',
            height: '40px',
            border: '3px solid rgba(255,255,255,0.3)',
            borderTop: '3px solid #ffffff',
            borderRadius: '50%',
            margin: '0 auto 12px',
            animation: 'spin 1s linear infinite',
          }}
        />
        <style>
          {`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}
        </style>
        <span>Loading 3D Engine...</span>
      </div>
    </div>
  );
}

function WebGLNotSupported({ width, height }: { width: number | string; height: number | string }) {
  const w = typeof width === 'number' ? `${width}px` : width;
  const h = typeof height === 'number' ? `${height}px` : height;

  return (
    <div
      data-testid="three-engine-unsupported"
      style={{
        width: w,
        height: h,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#2d2d2d',
        color: '#ffffff',
        padding: '20px',
        textAlign: 'center',
      }}
    >
      <div>
        <p style={{ marginBottom: '8px', fontWeight: 'bold' }}>WebGL Not Supported</p>
        <p style={{ fontSize: '14px', opacity: 0.8 }}>
          Your browser or device does not support WebGL rendering.
        </p>
      </div>
    </div>
  );
}

export const ThreeEngine = React.forwardRef<ThreeEngineRef | CanvasEngineRef, ThreeEngineProps>(
  function ThreeEngine({ config, className, onReady, onFrame }, ref) {
    const capabilities = useMemo(() => detectCapabilities(), []);

    const width = config.width ?? 800;
    const height = config.height ?? 600;

    if (!capabilities.webgl) {
      if (config.fallbackMode === 'canvas2d') {
        const canvas2DConfig: Canvas2DConfig = {
          id: config.id,
          mode: 'canvas2d',
          width: config.width,
          height: config.height,
          responsive: config.responsive,
          background: config.background,
          exportable: config.exportable,
          animationLoop: true,
        };
        return (
          <CanvasEngine
            ref={ref as React.Ref<CanvasEngineRef>}
            config={canvas2DConfig}
            className={className}
          />
        );
      }

      if (config.fallbackMode === 'none') {
        return <WebGLNotSupported width={width} height={height} />;
      }

      return <WebGLNotSupported width={width} height={height} />;
    }

    return (
      <ThreeJSErrorBoundary>
        <Suspense fallback={<LoadingState width={width} height={height} />}>
          <ThreeEngineImpl
            ref={ref as React.Ref<ThreeEngineRef>}
            config={config}
            className={className}
            onReady={onReady}
            onFrame={onFrame}
          />
        </Suspense>
      </ThreeJSErrorBoundary>
    );
  }
);

export default ThreeEngine;
