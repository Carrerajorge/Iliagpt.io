export { captureLoop, CaptureLoop } from './captureLoop';
export { elementDetector, ElementDetector, FrameAnalysis } from './elementDetector';
export { accessibilityFusion, AccessibilityFusion, UnifiedUIState } from './accessibilityFusion';
export { stateTracker, DesktopStateTracker, DesktopState } from './stateTracker';
export { frameDiffer, FrameDiffer } from './frameDiffer';
export { actionPredictor, ActionPredictor } from './actionPredictor';

import { captureLoop } from './captureLoop';

// Función para iniciar todo el pipeline si es necesario
export async function initializeVisionPipeline() {
    console.log("[Vision Pipeline] Inicializando...");
    await captureLoop.start();
}

export async function shutdownVisionPipeline() {
    console.log("[Vision Pipeline] Apagando...");
    captureLoop.stop();
}
