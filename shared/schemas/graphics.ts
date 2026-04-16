import { z } from "zod";

// Rendering modes
export type RenderMode = 'svg' | 'canvas2d' | 'webgl' | 'auto';

// Capability detection
export interface GraphicsCapabilities {
  webgl: boolean;
  webgl2: boolean;
  offscreenCanvas: boolean;
  svg: boolean;
}

export function detectCapabilities(): GraphicsCapabilities {
  const capabilities: GraphicsCapabilities = {
    webgl: false,
    webgl2: false,
    offscreenCanvas: false,
    svg: false,
  };

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return capabilities;
  }

  // Check SVG support
  capabilities.svg = !!document.createElementNS && 
    !!document.createElementNS('http://www.w3.org/2000/svg', 'svg').createSVGRect;

  // Check OffscreenCanvas support
  capabilities.offscreenCanvas = typeof OffscreenCanvas !== 'undefined';

  // Check WebGL support
  try {
    const canvas = document.createElement('canvas');
    capabilities.webgl = !!(
      canvas.getContext('webgl') || 
      canvas.getContext('experimental-webgl')
    );
    capabilities.webgl2 = !!canvas.getContext('webgl2');
  } catch (e) {
    capabilities.webgl = false;
    capabilities.webgl2 = false;
  }

  return capabilities;
}

// Base configuration
export interface GraphicsSurfaceConfig {
  id: string;
  mode: RenderMode;
  width?: number | string;
  height?: number | string;
  responsive?: boolean;
  background?: string;
  exportable?: boolean;
}

// SVG-specific config
export interface SVGConfig extends GraphicsSurfaceConfig {
  mode: 'svg';
  content?: string;
  viewBox?: string;
  preserveAspectRatio?: string;
  enableZoom?: boolean;
  enablePan?: boolean;
}

// Canvas 2D config
export interface Canvas2DConfig extends GraphicsSurfaceConfig {
  mode: 'canvas2d';
  enablePhysics?: boolean;
  physicsEngine?: 'matter' | 'custom';
  animationLoop?: boolean;
  targetFPS?: number;
}

// WebGL/Three.js config
export interface WebGLConfig extends GraphicsSurfaceConfig {
  mode: 'webgl';
  modelUrl?: string;
  modelFormat?: 'gltf' | 'glb' | 'obj';
  enableOrbitControls?: boolean;
  lighting?: 'ambient' | 'directional' | 'point' | 'custom';
  enableLOD?: boolean;
  fallbackMode?: 'canvas2d' | 'svg' | 'none';
}

// Union type
export type GraphicsConfig = SVGConfig | Canvas2DConfig | WebGLConfig;

// Fallback resolver
export function resolveRenderMode(
  requested: RenderMode,
  capabilities: GraphicsCapabilities,
  fallbackOrder: RenderMode[] = ['canvas2d', 'svg']
): RenderMode {
  if (requested === 'auto') {
    if (capabilities.webgl) return 'webgl';
    if (capabilities.svg) return 'svg';
    return 'canvas2d';
  }

  if (requested === 'webgl' && capabilities.webgl) return 'webgl';
  if (requested === 'svg' && capabilities.svg) return 'svg';
  if (requested === 'canvas2d') return 'canvas2d';

  for (const fallback of fallbackOrder) {
    if (fallback === 'webgl' && capabilities.webgl) return 'webgl';
    if (fallback === 'svg' && capabilities.svg) return 'svg';
    if (fallback === 'canvas2d') return 'canvas2d';
  }

  return 'canvas2d';
}

// Zod Schemas

export const RenderModeSchema = z.enum(['svg', 'canvas2d', 'webgl', 'auto']);

export const GraphicsCapabilitiesSchema = z.object({
  webgl: z.boolean(),
  webgl2: z.boolean(),
  offscreenCanvas: z.boolean(),
  svg: z.boolean(),
});

export const GraphicsSurfaceConfigSchema = z.object({
  id: z.string(),
  mode: RenderModeSchema,
  width: z.union([z.number(), z.string()]).optional(),
  height: z.union([z.number(), z.string()]).optional(),
  responsive: z.boolean().optional(),
  background: z.string().optional(),
  exportable: z.boolean().optional(),
});

export const SVGConfigSchema = GraphicsSurfaceConfigSchema.extend({
  mode: z.literal('svg'),
  content: z.string().optional(),
  viewBox: z.string().optional(),
  preserveAspectRatio: z.string().optional(),
  enableZoom: z.boolean().optional(),
  enablePan: z.boolean().optional(),
});

export const Canvas2DConfigSchema = GraphicsSurfaceConfigSchema.extend({
  mode: z.literal('canvas2d'),
  enablePhysics: z.boolean().optional(),
  physicsEngine: z.enum(['matter', 'custom']).optional(),
  animationLoop: z.boolean().optional(),
  targetFPS: z.number().optional(),
});

export const WebGLConfigSchema = GraphicsSurfaceConfigSchema.extend({
  mode: z.literal('webgl'),
  modelUrl: z.string().optional(),
  modelFormat: z.enum(['gltf', 'glb', 'obj']).optional(),
  enableOrbitControls: z.boolean().optional(),
  lighting: z.enum(['ambient', 'directional', 'point', 'custom']).optional(),
  enableLOD: z.boolean().optional(),
  fallbackMode: z.enum(['canvas2d', 'svg', 'none']).optional(),
});

export const GraphicsConfigSchema = z.discriminatedUnion('mode', [
  SVGConfigSchema,
  Canvas2DConfigSchema,
  WebGLConfigSchema,
]);

// Inferred types from Zod schemas
export type RenderModeZod = z.infer<typeof RenderModeSchema>;
export type GraphicsCapabilitiesZod = z.infer<typeof GraphicsCapabilitiesSchema>;
export type GraphicsSurfaceConfigZod = z.infer<typeof GraphicsSurfaceConfigSchema>;
export type SVGConfigZod = z.infer<typeof SVGConfigSchema>;
export type Canvas2DConfigZod = z.infer<typeof Canvas2DConfigSchema>;
export type WebGLConfigZod = z.infer<typeof WebGLConfigSchema>;
export type GraphicsConfigZod = z.infer<typeof GraphicsConfigSchema>;
