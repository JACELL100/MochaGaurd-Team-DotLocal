"use client";

import React, { useEffect, useRef } from "react";

interface AsciiStarryNightProps {
  className?: string;
  opacity?: number;
}

export function AsciiStarryNight({ className = "", opacity = 0.28 }: AsciiStarryNightProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let animId: number = 0;
    let isVisible = true;
    let width = (canvas.width = canvas.parentElement?.clientWidth || window.innerWidth);
    let height = (canvas.height = canvas.parentElement?.clientHeight || window.innerHeight);

    // Optimized Monospace grid spacing (high frame throughput)
    const cellWidth = 20;
    const cellHeight = 22;
    let cols = Math.floor(width / cellWidth);
    let rows = Math.floor(height / cellHeight);

    // Curated ASCII cosmic characters by brightness density
    const glyphs = ["·", ".", "+", "°", "✧", "✦", "*", "•", "x"];
    const colors = [
      "#7C3AED", // Royal Violet
      "#A78BFA", // Light Violet
      "#C4B5FD", // Lavender
      "#38BDF8", // Cyan Starlight
      "#F8FAFC", // Crisp White
    ];

    // Pre-render glyph sprites onto an offscreen canvas for instantaneous blitting (10x faster than ctx.fillText)
    const spriteSize = 24;
    const offscreen = document.createElement("canvas");
    offscreen.width = spriteSize * glyphs.length;
    offscreen.height = spriteSize * colors.length;
    const offCtx = offscreen.getContext("2d");

    if (offCtx) {
      offCtx.font = "bold 13px monospace";
      offCtx.textAlign = "center";
      offCtx.textBaseline = "middle";

      colors.forEach((col, colorIdx) => {
        offCtx.fillStyle = col;
        glyphs.forEach((char, glyphIdx) => {
          offCtx.fillText(
            char,
            glyphIdx * spriteSize + spriteSize / 2,
            colorIdx * spriteSize + spriteSize / 2
          );
        });
      });
    }

    // Micro foreground stardust drifting particles (integrated to avoid second canvas)
    const stardust = Array.from({ length: 40 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      size: Math.random() * 1.5 + 0.5,
      speedY: -(Math.random() * 0.25 + 0.08),
      alpha: Math.random() * 0.6 + 0.2,
      color: Math.random() > 0.5 ? "#C4B5FD" : "#38BDF8",
    }));

    const handleResize = () => {
      if (!canvas || !canvas.parentElement) return;
      width = canvas.width = canvas.parentElement.clientWidth;
      height = canvas.height = canvas.parentElement.clientHeight;
      cols = Math.floor(width / cellWidth);
      rows = Math.floor(height / cellHeight);
    };

    window.addEventListener("resize", handleResize, { passive: true });

    let time = 0;

    const render = () => {
      if (!isVisible || document.hidden) {
        animId = requestAnimationFrame(render);
        return;
      }

      time += 0.005;
      ctx.clearRect(0, 0, width, height);

      // 1. Draw Starry Night ASCII Swirls via cached sprites
      for (let r = 0; r < rows; r++) {
        const y = r * cellHeight;
        const vRatio = r / rows;
        const vMask = Math.sin(vRatio * Math.PI); // Smooth vignette at screen edges

        for (let c = 0; c < cols; c++) {
          const x = c * cellWidth;

          // Mathematical fluid celestial wind equation
          const angle = Math.sin(c * 0.06 + time) * 1.8 + Math.cos(r * 0.07 - time) * 1.8;
          const swirl = Math.sin(c * 0.04 + r * 0.04 + angle + time * 0.7);
          const noise = Math.sin(c * 0.1 + time * 0.4) * Math.cos(r * 0.1 - time * 0.3);
          const rawDensity = (swirl * 0.65 + noise * 0.35 + 1) * 0.5;

          if (rawDensity < 0.42) continue; // Keep sparse celestial void

          const glyphIdx = Math.min(
            glyphs.length - 1,
            Math.floor(((rawDensity - 0.42) / 0.58) * glyphs.length)
          );
          const colorIdx = (c + r + Math.floor(time * 8)) % colors.length;
          const alpha = Math.max(0, (rawDensity - 0.42) * 1.8 * vMask * opacity);

          ctx.globalAlpha = alpha;
          ctx.drawImage(
            offscreen,
            glyphIdx * spriteSize,
            colorIdx * spriteSize,
            spriteSize,
            spriteSize,
            x,
            y,
            cellWidth,
            cellHeight
          );
        }
      }

      // 2. Draw micro stardust particles in single pass
      stardust.forEach((p) => {
        p.y += p.speedY;
        if (p.y < 0) {
          p.y = height;
          p.x = Math.random() * width;
        }

        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.alpha * opacity * 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.globalAlpha = 1.0;
      animId = requestAnimationFrame(render);
    };

    render();

    // Pause rendering when scrolled out of viewport
    const io = new IntersectionObserver(
      ([entry]) => {
        isVisible = entry.isIntersecting;
      },
      { threshold: 0.05 }
    );
    io.observe(canvas);

    return () => {
      window.removeEventListener("resize", handleResize);
      io.disconnect();
      cancelAnimationFrame(animId);
    };
  }, [opacity]);

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 w-full h-full pointer-events-none select-none ${className}`}
      style={{
        mixBlendMode: "screen",
        transform: "translate3d(0, 0, 0)",
        contain: "strict",
      }}
    />
  );
}
