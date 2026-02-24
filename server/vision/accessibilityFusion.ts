import { BoundingBox } from './groundingDino';
import { UIElement } from '../native/hal';

export class AccessibilityFusion {
    /**
     * Fusiona las cajas delimitadoras de Visión (Pixeles) con el árbol de SO Nativo 
     * usando Euclidian Distance matching para anclar inferencias visuales a nodos reales.
     */
    fuse(visionBoxes: BoundingBox[], a11yTree: UIElement[]): UIElement[] {
        const fused: UIElement[] = [];
        const threshold = 20; // Tolerancia geométrica

        for (const el of a11yTree) {
            // Calculate center of a11y element
            const cx1 = el.position.x + el.size.width / 2;
            const cy1 = el.position.y + el.size.height / 2;

            let matchedVisionLabel = null;
            let minDistance = Infinity;

            for (const box of visionBoxes) {
                const cx2 = (box.x0 + box.x1) / 2;
                const cy2 = (box.y0 + box.y1) / 2;

                const dist = Math.sqrt(Math.pow(cx1 - cx2, 2) + Math.pow(cy1 - cy2, 2));
                if (dist < minDistance && dist < threshold) {
                    minDistance = dist;
                    matchedVisionLabel = box.label;
                }
            }

            // Si hallamos matcheo, infundimos el tag semántico del DINO/OCR al nodo DOM
            if (matchedVisionLabel) {
                if (!el.attributes) el.attributes = {};
                el.attributes['vision_label'] = matchedVisionLabel;
            }
            fused.push(el);
        }

        return fused;
    }
}

export const accessibilityFusion = new AccessibilityFusion();
