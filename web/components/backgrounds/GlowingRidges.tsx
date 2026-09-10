"use client";

import React, { useEffect, useRef } from "react";

interface GlowingRidgesProps {
  className?: string;
  ridgeCount?: number;
  speed?: number;
  interactive?: boolean;
}

export function GlowingRidges({
  className = "",
  ridgeCount = 14,
  speed = 0.007,
  interactive = true,
}: GlowingRidgesProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mouseRef = useRef({ x: 0.5, y: 0.5, targetX: 0.5, targetY: 0.5 });
  const isVisibleRef = useRef(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let animId: number = 0;
    let width = 0;
    let height = 0;
    let isRunning = false;

    const updateDimensions = () => {
      if (!canvas || !canvas.parentElement) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      width = canvas.parentElement.clientWidth;
      height = canvas.parentElement.clientHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    updateDimensions();
    window.addEventListener("resize", updateDimensions, { passive: true });

    const handleMouseMove = (e: MouseEvent) => {
      if (!interactive || !width || !height) return;
      const rect = canvas.getBoundingClientRect();
      mouseRef.current.targetX = (e.clientX - rect.left) / width;
      mouseRef.current.targetY = (e.clientY - rect.top) / height;
    };
    window.addEventListener("mousemove", handleMouseMove, { passive: true });

    let t = 0;
    const segments = 28; // Optimal smoothness-to-performance ratio

    const render = () => {
      if (!isVisibleRef.current || document.hidden || width === 0) {
        isRunning = false;
        return;
      }
      isRunning = true;

      t += speed;
      mouseRef.current.x += (mouseRef.current.targetX - mouseRef.current.x) * 0.04;
      mouseRef.current.y += (mouseRef.current.targetY - mouseRef.current.y) * 0.04;

      ctx.clearRect(0, 0, width, height);

      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      const startY = height * 0.25;
      const stepY = (height * 0.75) / ridgeCount;
      const stepX = width / segments;

      for (let i = 0; i < ridgeCount; i++) {
        const progress = i / ridgeCount;
        const baseY = startY + i * stepY;
        const amplitude = (14 + progress * 36) * (0.88 + Math.sin(t * 1.4 + i * 0.3) * 0.12);
        const freq = 0.003 + (1 - progress) * 0.003;

        ctx.beginPath();
        for (let j = 0; j <= segments; j++) {
          const x = j * stepX;
          const wave = Math.sin(x * freq + t * 2 + i * 0.35) * amplitude;
          const dx = (x / width) - mx;
          const dy = (baseY / height) - my;
          const distSq = dx * dx + dy * dy;
          const mouseElev = distSq < 0.08 ? (1 - distSq / 0.08) * 22 : 0;
          const y = baseY + wave - mouseElev;

          if (j === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }

        const alpha = Math.min(1, Math.max(0.18, Math.sin(progress * Math.PI) * 0.85));
        const lightness = 65 + Math.sin(t + i * 0.2) * 8;

        // GPU-accelerated single-stroke gradient line
        ctx.strokeStyle = `hsla(${265 + progress * 16}, 85%, ${lightness}%, ${alpha * 0.75})`;
        ctx.lineWidth = 1.2 + progress * 1.2;
        ctx.stroke();

        // Subtle gradient fill under curve
        ctx.lineTo(width, height);
        ctx.lineTo(0, height);
        ctx.closePath();
        const fillGrad = ctx.createLinearGradient(0, baseY, 0, baseY + stepY * 1.5);
        fillGrad.addColorStop(0, `hsla(268, 80%, 25%, ${alpha * 0.05})`);
        fillGrad.addColorStop(1, "transparent");
        ctx.fillStyle = fillGrad;
        ctx.fill();
      }

      animId = requestAnimationFrame(render);
    };

    const startLoop = () => {
      if (!isRunning) {
        animId = requestAnimationFrame(render);
      }
    };

    // IntersectionObserver to sleep the loop when scrolled away
    const observer = new IntersectionObserver(
      (entries) => {
        isVisibleRef.current = entries[0]?.isIntersecting ?? true;
        if (isVisibleRef.current) {
          startLoop();
        }
      },
      { threshold: 0.02 }
    );
    observer.observe(canvas);

    startLoop();

    return () => {
      window.removeEventListener("resize", updateDimensions);
      window.removeEventListener("mousemove", handleMouseMove);
      observer.disconnect();
      cancelAnimationFrame(animId);
      isRunning = false;
    };
  }, [ridgeCount, speed, interactive]);

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 w-full h-full pointer-events-none ${className}`}
      style={{
        transform: "translate3d(0, 0, 0)",
        willChange: "transform",
        contain: "strict",
      }}
    />
  );
}

