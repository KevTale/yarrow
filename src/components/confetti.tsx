import { useEffect, useRef } from "react";

const COLORS = ["#f2b544", "#f5f0e3", "#5ccb95", "#9db4ff", "#ee7b6e", "#c7a6ff"];

/**
 * One burst of confetti from the top of the screen, in the brand colors.
 * Skipped when the visitor asked for reduced motion.
 */
export function Confetti() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ratio = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    element.width = width * ratio;
    element.height = height * ratio;
    context.scale(ratio, ratio);

    const pieces = Array.from({ length: 160 }, (_, i) => {
      const fromLeft = i % 2 === 0;
      return {
        x: fromLeft ? width * 0.2 : width * 0.8,
        y: height * 0.3,
        vx: (fromLeft ? 1 : -1) * (2 + Math.random() * 7) + (Math.random() - 0.5) * 4,
        vy: -(8 + Math.random() * 9),
        size: 5 + Math.random() * 6,
        spin: Math.random() * Math.PI,
        spinSpeed: (Math.random() - 0.5) * 0.3,
        color: COLORS[i % COLORS.length]!,
        round: Math.random() < 0.3,
      };
    });
    const start = performance.now();
    let frame = 0;
    const draw = (now: number) => {
      const elapsed = now - start;
      context.clearRect(0, 0, width, height);
      context.globalAlpha = Math.max(0, 1 - Math.max(0, elapsed - 2200) / 900);
      for (const piece of pieces) {
        piece.vy += 0.32;
        piece.vx *= 0.985;
        piece.x += piece.vx;
        piece.y += piece.vy;
        piece.spin += piece.spinSpeed;
        context.save();
        context.translate(piece.x, piece.y);
        context.rotate(piece.spin);
        context.fillStyle = piece.color;
        if (piece.round) {
          context.beginPath();
          context.arc(0, 0, piece.size / 2.4, 0, Math.PI * 2);
          context.fill();
        } else {
          context.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
        }
        context.restore();
      }
      if (elapsed < 3100) frame = requestAnimationFrame(draw);
      else context.clearRect(0, 0, width, height);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return <canvas ref={canvas} className="confetti" aria-hidden="true" />;
}
