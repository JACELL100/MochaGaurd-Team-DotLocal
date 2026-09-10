"use client";

import React, { useEffect, useRef } from "react";
import createGlobe, { Globe } from "cobe";

interface Globe3DProps {
  className?: string;
}

export function Globe3D({ className = "" }: Globe3DProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerInteracting = useRef<number | null>(null);
  const pointerInteractionMovement = useRef(0);
  const isVisibleRef = useRef(true);

  useEffect(() => {
    let phi = 0;
    let width = 0;
    let animId: number = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onResize = () => {
      if (canvas && canvas.parentElement) {
        width = canvas.parentElement.clientWidth;
      }
    };
    window.addEventListener("resize", onResize, { passive: true });
    onResize();

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const renderSize = Math.max((width || 1200), 800) * dpr;

    let globe: Globe | null = null;

    try {
      globe = createGlobe(canvas, {
        devicePixelRatio: dpr,
        width: renderSize,
        height: renderSize,
        phi: 0,
        theta: 0.25,
        dark: 1,
        diffuse: 1.6,
        mapSamples: 24000,
        mapBrightness: 6,
        baseColor: [0.05, 0.04, 0.12],
        markerColor: [0.65, 0.45, 0.98],
        glowColor: [0.48, 0.22, 0.93],
        // Major Global Financial Exchanges (Live Trade Surveillance)
        markers: [
          { location: [40.7128, -74.006], size: 0.08 }, // New York
          { location: [51.5074, -0.1278], size: 0.07 }, // London
          { location: [35.6762, 139.6503], size: 0.07 }, // Tokyo
          { location: [1.3521, 103.8198], size: 0.06 }, // Singapore
          { location: [50.1109, 8.6821], size: 0.06 }, // Frankfurt
          { location: [25.2048, 55.2708], size: 0.05 }, // Dubai
          { location: [22.3193, 114.1694], size: 0.06 }, // Hong Kong
          { location: [-33.8688, 151.2093], size: 0.05 }, // Sydney
        ],
        // On-Chain Settlement 3D Arcs
        arcs: [
          { from: [40.7128, -74.006], to: [51.5074, -0.1278], color: [0.65, 0.45, 0.98] }, // NY -> London
          { from: [51.5074, -0.1278], to: [50.1109, 8.6821], color: [0.78, 0.55, 1.0] }, // London -> Frankfurt
          { from: [51.5074, -0.1278], to: [25.2048, 55.2708], color: [0.48, 0.22, 0.93] }, // London -> Dubai
          { from: [25.2048, 55.2708], to: [1.3521, 103.8198], color: [0.65, 0.45, 0.98] }, // Dubai -> Singapore
          { from: [1.3521, 103.8198], to: [35.6762, 139.6503], color: [0.78, 0.55, 1.0] }, // Singapore -> Tokyo
          { from: [35.6762, 139.6503], to: [40.7128, -74.006], color: [0.48, 0.22, 0.93] }, // Tokyo -> NY
        ],
        arcColor: [0.65, 0.45, 0.98],
        arcWidth: 1.5,
        arcHeight: 0.35,
      });

      // Continuous 60fps rotation loop
      const animate = () => {
        if (globe && isVisibleRef.current && !document.hidden) {
          if (pointerInteracting.current === null) {
            phi += 0.003;
          }
          const currentPhi = phi + pointerInteractionMovement.current;
          globe.update({ phi: currentPhi });
        }
        animId = requestAnimationFrame(animate);
      };

      animate();
    } catch (err) {
      console.error("Globe WebGL initialization error:", err);
    }

    // Sleep RAF when off-screen
    const observer = new IntersectionObserver(
      (entries) => {
        isVisibleRef.current = entries[0]?.isIntersecting ?? true;
      },
      { threshold: 0.05 }
    );
    observer.observe(canvas);

    return () => {
      window.removeEventListener("resize", onResize);
      observer.disconnect();
      cancelAnimationFrame(animId);
      if (globe) {
        globe.destroy();
      }
    };
  }, []);

  return (
    <div
      className={`relative flex items-center justify-center select-none pointer-events-auto ${className}`}
      onPointerDown={(e) => {
        pointerInteracting.current = e.clientX - pointerInteractionMovement.current;
        if (canvasRef.current) canvasRef.current.style.cursor = "grabbing";
      }}
      onPointerUp={() => {
        pointerInteracting.current = null;
        if (canvasRef.current) canvasRef.current.style.cursor = "grab";
      }}
      onPointerOut={() => {
        pointerInteracting.current = null;
        if (canvasRef.current) canvasRef.current.style.cursor = "grab";
      }}
      onMouseMove={(e) => {
        if (pointerInteracting.current !== null) {
          const delta = e.clientX - pointerInteracting.current;
          pointerInteractionMovement.current = delta * 0.005;
        }
      }}
      onTouchMove={(e) => {
        if (pointerInteracting.current !== null && e.touches[0]) {
          const delta = e.touches[0].clientX - pointerInteracting.current;
          pointerInteractionMovement.current = delta * 0.005;
        }
      }}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-grab opacity-100 transition-opacity duration-1000"
        style={{
          width: "100%",
          height: "100%",
          contain: "strict",
          transform: "translate3d(0, 0, 0)",
        }}
      />
    </div>
  );
}
