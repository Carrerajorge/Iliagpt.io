import React, { useEffect, useRef } from 'react';
import { Sparkles } from 'lucide-react';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  life: number;
}

const LIGHT_COLORS = [
  "#0A0A0A",
  "#18181B",
  "#27272A",
  "#3F3F46",
];

const DARK_COLORS = [
  "#FAFAFA",
  "#E4E4E7",
  "#A1A1AA",
  "#71717A",
];

export function WelcomeAnimation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animationRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const palette = document.documentElement.classList.contains("dark") ? DARK_COLORS : LIGHT_COLORS;

    const resizeCanvas = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const createParticle = (): Particle => {
      const canvasWidth = canvas.offsetWidth;
      return {
        x: Math.random() * canvasWidth,
        y: -10,
        vx: (Math.random() - 0.5) * 2,
        vy: Math.random() * 3 + 1,
        size: Math.random() * 4 + 2,
        color: palette[Math.floor(Math.random() * palette.length)],
        alpha: Math.random() * 0.6 + 0.4,
        life: 1,
      };
    };

    // Initialize particles
    for (let i = 0; i < 50; i++) {
      const particle = createParticle();
      particle.y = Math.random() * canvas.offsetHeight;
      particlesRef.current.push(particle);
    }

    const animate = () => {
      const canvasWidth = canvas.offsetWidth;
      const canvasHeight = canvas.offsetHeight;

      ctx.clearRect(0, 0, canvasWidth, canvasHeight);

      // Add new particles occasionally
      if (Math.random() < 0.15) {
        particlesRef.current.push(createParticle());
      }

      // Update and draw particles
      particlesRef.current = particlesRef.current.filter(particle => {
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.life -= 0.003;
        particle.alpha = particle.life * 0.8;

        if (particle.life <= 0 || particle.y > canvasHeight + 20) {
          return false;
        }

        // Draw glow effect
        const gradient = ctx.createRadialGradient(
          particle.x, particle.y, 0,
          particle.x, particle.y, particle.size * 3
        );
        gradient.addColorStop(0, particle.color + Math.floor(particle.alpha * 255).toString(16).padStart(2, '0'));
        gradient.addColorStop(1, particle.color + '00');

        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size * 3, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();

        // Draw core
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        ctx.fillStyle = particle.color + Math.floor(particle.alpha * 255).toString(16).padStart(2, '0');
        ctx.fill();

        return true;
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center overflow-hidden">
      {/* Particle Canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ opacity: 0.7 }}
      />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center justify-center text-center space-y-6 px-4">
        {/* Animated Logo/Icon */}
        <div className="relative">
          <div className="relative w-24 h-24 rounded-2xl border border-border bg-card flex items-center justify-center shadow-sm">
            <div className="w-14 h-14 rounded-xl bg-foreground text-background flex items-center justify-center">
              <Sparkles className="w-7 h-7" />
            </div>
          </div>
        </div>

        {/* Welcome Text */}
        <div className="space-y-3">
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-foreground">
            ¡Bienvenido a{" "}
            <span className="inline-flex items-baseline rounded-lg bg-muted px-2 py-0.5 font-bold">
              iliagpt
            </span>
            !
          </h1>
          <p className="text-muted-foreground text-lg max-w-md mx-auto">
            Tu asistente de IA más inteligente está listo para ayudarte
          </p>
        </div>

        {/* Feature Pills */}
        <div className="flex flex-wrap gap-3 justify-center max-w-lg">
          {['Crear imágenes', 'Investigar', 'Programar', 'Analizar datos', 'Escribir documentos'].map((feature, idx) => (
            <span
              key={feature}
              className="px-4 py-2 rounded-full text-sm font-medium bg-muted/30 border border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors duration-200"
              style={{ animationDelay: `${idx * 100}ms` }}
            >
              {feature}
            </span>
          ))}
        </div>

        {/* Call to Action */}
        <p className="text-muted-foreground/80 text-sm mt-4">Escribe tu primera pregunta para comenzar.</p>
      </div>
    </div>
  );
}
