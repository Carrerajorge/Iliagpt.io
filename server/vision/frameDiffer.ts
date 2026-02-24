// server/vision/frameDiffer.ts
import { nativeDesktop } from '../native';

export class FrameDiffer {
    /**
     * Calcula la diferencia porcentual entre dos imágenes crudas (Buffers).
     * En el futuro, esto despachará a la función `diff_frames` del nativo Rust (SIMD).
     * Por ahora utilizamos una aproximación estocástica de sampleo en Node.js
     * si el NativeBridge no ha exportado `diff_frames`.
     */
    async calculateDiff(frameA: Buffer, frameB: Buffer | null): Promise<number> {
        if (!frameB) return 1.0; // 100% change if no previous frame

        // As of Phase 1, we try to use the native function if available in DesktopController
        // Currently, nativeDesktop doesn't expose diff, so we simulate a fast pixel sample

        if (frameA.length !== frameB.length) {
            return 1.0; // Dimensions changed
        }

        // Fast Stochastic Sampling (1000 pixels)
        const samples = 1000;
        let diffCount = 0;
        const step = Math.floor(frameA.length / samples);

        for (let i = 0; i < frameA.length; i += step) {
            if (frameA[i] !== frameB[i]) {
                diffCount++;
            }
        }

        return diffCount / samples;
    }
}

export const frameDiffer = new FrameDiffer();
