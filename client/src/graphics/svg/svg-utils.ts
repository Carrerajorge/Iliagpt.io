import DOMPurify from 'dompurify';

export function sanitizeSVG(content: string): string {
  return DOMPurify.sanitize(content, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['use', 'defs', 'clipPath', 'mask', 'pattern', 'linearGradient', 'radialGradient', 'stop', 'filter', 'feGaussianBlur', 'feOffset', 'feMerge', 'feMergeNode', 'feBlend', 'feColorMatrix', 'feComposite', 'feFlood', 'feMorphology', 'feTurbulence', 'feDisplacementMap'],
    ADD_ATTR: ['xmlns', 'xmlns:xlink', 'xlink:href', 'viewBox', 'preserveAspectRatio', 'transform', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline', 'clip-path', 'mask', 'filter', 'marker-start', 'marker-mid', 'marker-end'],
  });
}

export function exportSVGAsString(svgElement: SVGSVGElement): string {
  const clone = svgElement.cloneNode(true) as SVGSVGElement;
  
  if (!clone.hasAttribute('xmlns')) {
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }
  if (!clone.hasAttribute('xmlns:xlink')) {
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  }
  
  const styles = getComputedStyles(svgElement);
  if (styles) {
    const styleElement = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    styleElement.textContent = styles;
    clone.insertBefore(styleElement, clone.firstChild);
  }
  
  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(clone);
  
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + svgString;
}

function getComputedStyles(svgElement: SVGSVGElement): string | null {
  const styleSheets = document.styleSheets;
  let cssRules = '';
  
  try {
    for (let i = 0; i < styleSheets.length; i++) {
      const sheet = styleSheets[i];
      if (sheet.cssRules) {
        for (let j = 0; j < sheet.cssRules.length; j++) {
          const rule = sheet.cssRules[j];
          if (rule instanceof CSSStyleRule) {
            try {
              if (svgElement.querySelector(rule.selectorText)) {
                cssRules += rule.cssText + '\n';
              }
            } catch {
              continue;
            }
          }
        }
      }
    }
  } catch {
    return null;
  }
  
  return cssRules || null;
}

export async function exportSVGAsPNG(
  svgElement: SVGSVGElement,
  scale: number = 2
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const svgString = exportSVGAsString(svgElement);
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    
    const img = new Image();
    img.onload = () => {
      const bbox = svgElement.getBBox();
      const width = (svgElement.width.baseVal.value || bbox.width || 300) * scale;
      const height = (svgElement.height.baseVal.value || bbox.height || 150) * scale;
      
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to get canvas context'));
        return;
      }
      
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to create PNG blob'));
        }
      }, 'image/png');
    };
    
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load SVG for PNG conversion'));
    };
    
    img.src = url;
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadSVG(svgElement: SVGSVGElement, filename: string = 'export.svg'): void {
  const svgString = exportSVGAsString(svgElement);
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  downloadBlob(blob, filename);
}

export async function downloadPNG(
  svgElement: SVGSVGElement,
  filename: string = 'export.png',
  scale: number = 2
): Promise<void> {
  const blob = await exportSVGAsPNG(svgElement, scale);
  downloadBlob(blob, filename);
}
