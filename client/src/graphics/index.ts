export { VisualizationSurface, type VisualizationSurfaceProps } from './visualization-surface';

export { SVGRenderer, type SVGRendererProps } from './svg';
export { sanitizeSVG, exportSVGAsString, exportSVGAsPNG, downloadBlob, downloadSVG, downloadPNG } from './svg';

export { CanvasEngine, type CanvasEngineRef } from './canvas';
export { exportCanvasAsPNG, exportCanvasAsJPEG, downloadCanvas, clearCanvas, setupHiDPICanvas, getDevicePixelRatio, createOffscreenCanvas } from './canvas';

export { ThreeEngine } from './three';
export type { ThreeEngineRef } from './three';

export type {
  RenderMode,
  GraphicsCapabilities,
  GraphicsSurfaceConfig,
  SVGConfig,
  Canvas2DConfig,
  WebGLConfig,
  GraphicsConfig,
} from '@shared/schemas/graphics';

export {
  detectCapabilities,
  resolveRenderMode,
  RenderModeSchema,
  GraphicsCapabilitiesSchema,
  GraphicsSurfaceConfigSchema,
  SVGConfigSchema,
  Canvas2DConfigSchema,
  WebGLConfigSchema,
  GraphicsConfigSchema,
} from '@shared/schemas/graphics';
