import { useRef, useEffect, useCallback } from "react";

interface AudioWaveformProps {
  stream: MediaStream | null;
  isRecording: boolean;
  width?: number;
  height?: number;
  className?: string;
}

export function AudioWaveform({ stream, isRecording, width = 600, height = 120, className }: AudioWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const rafRef = useRef<number>(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.lineWidth = 2;
    ctx.strokeStyle = isRecording ? "#22c55e" : "#3b82f6";
    ctx.beginPath();

    const sliceWidth = canvas.width / bufferLength;
    let x = 0;
    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * canvas.height) / 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += sliceWidth;
    }
    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();

    // VU meter bar on the right
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      const v = (dataArray[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / bufferLength);
    const barHeight = Math.min(rms * 4, 1) * canvas.height;
    const barX = canvas.width - 12;
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(barX, 0, 8, canvas.height);
    ctx.fillStyle = isRecording ? "#22c55e" : "#3b82f6";
    ctx.fillRect(barX, canvas.height - barHeight, 8, barHeight);

    rafRef.current = requestAnimationFrame(draw);
  }, [isRecording]);

  useEffect(() => {
    if (!stream) {
      // Draw idle line
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.fillStyle = "#0f172a";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.strokeStyle = "#334155";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, canvas.height / 2);
          ctx.lineTo(canvas.width, canvas.height / 2);
          ctx.stroke();
        }
      }
      return;
    }

    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);

    ctxRef.current = audioCtx;
    analyserRef.current = analyser;
    sourceRef.current = source;

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      source.disconnect();
      audioCtx.close().catch(() => {});
      ctxRef.current = null;
      analyserRef.current = null;
      sourceRef.current = null;
    };
  }, [stream, draw]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={className}
      style={{ width: "100%", height: `${height}px`, borderRadius: 12, display: "block" }}
    />
  );
}
