"use client";

import React from "react";
import { MoltenMetal } from "../ui/MoltenMetal";
import { AsciiStarryNight } from "./AsciiStarryNight";

export function HeroFintechCosmos() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden select-none z-0">
      {/* 1. Ultra-High Performance 60+ FPS ASCII Starry Night Celestial Layer (Deep Space) */}
      <AsciiStarryNight
        opacity={0.25}
        className="opacity-90 [mask-image:radial-gradient(ellipse_90%_75%_at_50%_40%,#000_35%,transparent_90%)]"
      />

      {/* 2. Continuous React Bits <MoltenMetal /> Caustic Fluid Shaders Behind Globe */}
      <div className="absolute inset-0 flex items-center justify-center opacity-85 [mask-image:radial-gradient(ellipse_80%_65%_at_50%_45%,#000_30%,rgba(0,0,0,0.6)_60%,transparent_90%)]">
        <div className="w-full h-full max-w-[1600px] max-h-[900px] relative">
          <MoltenMetal
            color1="#7C3AED"
            color2="#7C3AED"
            color3="#FFFFFF"
            speed={0.35}
            scale={4}
            detail={3}
            glow={1.6}
            coreSize={0.1}
            swirl={1}
            fold={-0.2}
            blackPoint={0.05}
            brightness={1.3}
            colorMode="molten"
            grain={true}
            grainIntensity={0.05}
            mouseInteraction={true}
            mouseStrength={0.3}
            opacity={0.85}
          />
        </div>
      </div>

      {/* 3. Deep Space Ambient Violet Radial Domes (Hardware Accelerated CSS) */}
      <div className="absolute top-[-10%] left-1/2 -translate-x-1/2 w-[1100px] h-[650px] bg-[radial-gradient(ellipse_at_center,rgba(124,58,237,0.25)_0%,rgba(79,70,229,0.12)_45%,transparent_70%)] blur-[60px] pointer-events-none" />

      {/* 4. Soft Bottom Horizon Fade to Ticker */}
      <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-[#05050A] via-[#05050A]/85 to-transparent pointer-events-none" />
    </div>
  );
}
