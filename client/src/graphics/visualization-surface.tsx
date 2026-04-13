import { useMemo } from 'react';
import { 
  GraphicsConfig, 
  detectCapabilities, 
  resolveRenderMode,
  SVGConfig,
  Canvas2DConfig,
  WebGLConfig,
} from '@shared/schemas/graphics';
import { SVGRenderer } from './svg';
import { CanvasEngine } from './canvas';
import { ThreeEngine } from './three';

interface VisualizationSurfaceProps {
  config: GraphicsConfig;
  className?: string;
  onReady?: (context: any) => void;
  onExport?: (data: Blob | string) => void;
}

export function VisualizationSurface({ config, className, onReady, onExport }: VisualizationSurfaceProps) {
  const capabilities = useMemo(() => detectCapabilities(), []);
  
  const actualMode = useMemo(() => {
    return resolveRenderMode(config.mode as any, capabilities);
  }, [config.mode, capabilities]);
  
  switch (actualMode) {
    case 'svg':
      return (
        <SVGRenderer 
          config={config as SVGConfig} 
          className={className}
          onReady={onReady}
          onExport={onExport as ((svgString: string) => void) | undefined}
        />
      );
    case 'canvas2d':
      return (
        <CanvasEngine 
          config={config as Canvas2DConfig} 
          className={className}
          onReady={onReady}
        />
      );
    case 'webgl':
      return (
        <ThreeEngine 
          config={config as WebGLConfig} 
          className={className}
          onReady={onReady}
        />
      );
    default:
      return (
        <div 
          className={className}
          data-testid="visualization-surface-unsupported"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            backgroundColor: '#f5f5f5',
            color: '#666',
          }}
        >
          Unsupported graphics mode
        </div>
      );
  }
}

export type { VisualizationSurfaceProps };
