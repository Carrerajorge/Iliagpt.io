export function exportCanvasAsPNG(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Failed to export canvas as PNG'));
      }
    }, 'image/png');
  });
}

export function exportCanvasAsJPEG(canvas: HTMLCanvasElement, quality: number = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Failed to export canvas as JPEG'));
      }
    }, 'image/jpeg', quality);
  });
}

export function downloadCanvas(
  canvas: HTMLCanvasElement, 
  filename: string, 
  format: 'png' | 'jpeg' = 'png'
): void {
  const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const extension = format === 'jpeg' ? '.jpg' : '.png';
  
  canvas.toBlob((blob) => {
    if (!blob) return;
    
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename.endsWith(extension) ? filename : `${filename}${extension}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, mimeType, format === 'jpeg' ? 0.92 : undefined);
}

export function clearCanvas(ctx: CanvasRenderingContext2D, color?: string): void {
  const canvas = ctx.canvas;
  
  if (color) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

export function setupHiDPICanvas(
  canvas: HTMLCanvasElement, 
  ctx: CanvasRenderingContext2D, 
  width: number, 
  height: number
): void {
  const dpr = window.devicePixelRatio || 1;
  
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  
  ctx.scale(dpr, dpr);
}

export function getDevicePixelRatio(): number {
  return window.devicePixelRatio || 1;
}

export function createOffscreenCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
