import { useRef, useEffect, memo } from "react";

interface AudioAttachmentPreviewProps {
  width?: number;
  height?: number;
  isUploading?: boolean;
  className?: string;
}

/**
 * Animated audio waveform preview rendered on canvas.
 * Shows a stylized 3D-like waveform with gradient and glow effects.
 * Used as thumbnail when an audio file is attached in the composer.
 */
export const AudioAttachmentPreview = memo(function AudioAttachmentPreview({
  width = 132,
  height = 84,
  isUploading = false,
  className,
}: AudioAttachmentPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const timeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const draw = () => {
      timeRef.current += 0.03;
      const t = timeRef.current;

      // Background gradient (dark with subtle blue tint)
      const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
      bgGrad.addColorStop(0, "#0c0a1a");
      bgGrad.addColorStop(0.5, "#110e24");
      bgGrad.addColorStop(1, "#0c0a1a");
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      // Draw animated waveform bars
      const barCount = 28;
      const barWidth = width / (barCount * 2);
      const gap = barWidth;
      const centerY = height / 2;

      for (let i = 0; i < barCount; i++) {
        const x = i * (barWidth + gap) + gap;

        // Create organic wave pattern using multiple sine waves
        const wave1 = Math.sin(t * 1.5 + i * 0.3) * 0.4;
        const wave2 = Math.sin(t * 2.3 + i * 0.5) * 0.25;
        const wave3 = Math.sin(t * 0.8 + i * 0.15) * 0.35;
        const envelope = Math.sin((i / barCount) * Math.PI); // fade edges

        let amplitude = (wave1 + wave2 + wave3) * envelope;
        if (isUploading) {
          // Pulsing effect when uploading
          amplitude *= 0.5 + Math.sin(t * 3) * 0.5;
        }

        const barHeight = Math.max(3, Math.abs(amplitude) * (height * 0.4));

        // Bar gradient: violet to fuchsia with glow
        const barGrad = ctx.createLinearGradient(x, centerY - barHeight, x, centerY + barHeight);
        barGrad.addColorStop(0, "#a855f7");    // violet-500
        barGrad.addColorStop(0.3, "#c084fc");  // violet-400
        barGrad.addColorStop(0.5, "#e879f9");  // fuchsia-400
        barGrad.addColorStop(0.7, "#c084fc");
        barGrad.addColorStop(1, "#7c3aed");    // violet-600

        // Glow effect
        ctx.shadowColor = "#a855f7";
        ctx.shadowBlur = 6;

        // Draw rounded bar
        const radius = Math.min(barWidth / 2, 3);
        ctx.beginPath();
        ctx.roundRect(x, centerY - barHeight, barWidth, barHeight * 2, radius);
        ctx.fillStyle = barGrad;
        ctx.fill();

        // Reflection (subtle)
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 0.15;
        ctx.beginPath();
        ctx.roundRect(x, centerY + barHeight + 2, barWidth, barHeight * 0.4, radius);
        ctx.fillStyle = "#a855f7";
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Center line glow
      ctx.shadowColor = "#8b5cf6";
      ctx.shadowBlur = 8;
      ctx.strokeStyle = "rgba(139, 92, 246, 0.3)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(width, centerY);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Audio icon in center
      ctx.font = "bold 14px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
      ctx.shadowColor = "#a855f7";
      ctx.shadowBlur = 12;
      ctx.fillText("🎵", width / 2, height / 2);
      ctx.shadowBlur = 0;

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [width, height, isUploading]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        borderRadius: 10,
        display: "block",
      }}
    />
  );
});
