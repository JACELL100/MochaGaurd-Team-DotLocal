"use client";

import React, { useEffect, useRef } from "react";
import * as THREE from "three";

interface ThreeEarthGlobeProps {
  className?: string;
}

export function ThreeEarthGlobe({ className = "" }: ThreeEarthGlobeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isVisibleRef = useRef(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 1. Scene, Camera, Renderer Setup
    const scene = new THREE.Scene();
    let width = container.clientWidth || 1200;
    let height = container.clientHeight || 1200;

    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
    camera.position.set(0, 1.8, 10.8);
    camera.lookAt(0, -0.5, 0);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    container.appendChild(renderer.domElement);

    // 2. Load Photorealistic NASA Night Lights Texture
    const textureLoader = new THREE.TextureLoader();
    const earthRadius = 4.8;

    const earthGroup = new THREE.Group();
    earthGroup.position.set(0, -3.2, 0);
    earthGroup.rotation.z = 0.14;
    earthGroup.rotation.x = 0.22;
    scene.add(earthGroup);

    const nightTexture = textureLoader.load(
      "/assets/earth_night_map.jpg",
      () => {
        renderer.render(scene, camera);
      }
    );
    nightTexture.colorSpace = THREE.SRGBColorSpace;
    nightTexture.wrapS = THREE.RepeatWrapping;
    nightTexture.wrapT = THREE.ClampToEdgeWrapping;

    // 3. True Photorealistic Earth Mesh (Realistic NASA Colors, Warm Gold City Lights, Deep Blue Oceans)
    const earthGeometry = new THREE.SphereGeometry(earthRadius, 64, 64);
    const earthMaterial = new THREE.MeshStandardMaterial({
      map: nightTexture,
      roughness: 0.45,
      metalness: 0.1,
      emissive: new THREE.Color(0xffeedd),
      emissiveMap: nightTexture,
      emissiveIntensity: 1.15,
    });
    const earthMesh = new THREE.Mesh(earthGeometry, earthMaterial);
    earthGroup.add(earthMesh);

    // 4. Crisp Thin Royal Violet / Cyan Atmospheric Rim Halo (Edge-Only, Never Washing Out Surface)
    const atmosphereVertexShader = `
      varying vec3 vNormal;
      varying vec3 vPosition;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const atmosphereFragmentShader = `
      varying vec3 vNormal;
      varying vec3 vPosition;
      void main() {
        vec3 viewDir = normalize(-vPosition);
        // Ultra-sharp edge fresnel falloff
        float fresnel = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 4.2);
        
        // Crisp Royal Violet & Electric Cyan Horizon Rim
        vec3 violet = vec3(0.55, 0.25, 0.98); // Royal Violet
        vec3 cyan = vec3(0.0, 0.85, 1.0);    // Atmospheric Cyan
        vec3 rimColor = mix(violet, cyan, fresnel * 0.45);
        
        gl_FragColor = vec4(rimColor, fresnel * 0.9);
      }
    `;

    const atmosphereMaterial = new THREE.ShaderMaterial({
      vertexShader: atmosphereVertexShader,
      fragmentShader: atmosphereFragmentShader,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
      transparent: true,
      depthWrite: false,
    });

    const atmosphereMesh = new THREE.Mesh(
      new THREE.SphereGeometry(earthRadius * 1.035, 64, 64),
      atmosphereMaterial
    );
    earthGroup.add(atmosphereMesh);

    // 5. Natural Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.35);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 1.6);
    sunLight.position.set(10, 6, 10);
    scene.add(sunLight);

    const softFill = new THREE.DirectionalLight(0x7c3aed, 0.6);
    softFill.position.set(-10, -5, 5);
    scene.add(softFill);

    // 6. Interactive Drag Controls
    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };
    let targetRotationY = 0;
    let targetRotationX = 0;
    let currentRotationY = 0;
    let currentRotationX = 0;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      isDragging = true;
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
      previousMousePosition = { x: clientX, y: clientY };
    };

    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      if (!isDragging) return;
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;

      const deltaX = clientX - previousMousePosition.x;
      const deltaY = clientY - previousMousePosition.y;

      targetRotationY += deltaX * 0.0035;
      targetRotationX += deltaY * 0.0018;

      previousMousePosition = { x: clientX, y: clientY };
    };

    const handlePointerUp = () => {
      isDragging = false;
    };

    container.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("mouseup", handlePointerUp);

    container.addEventListener("touchstart", handlePointerDown, { passive: true });
    window.addEventListener("touchmove", handlePointerMove, { passive: true });
    window.addEventListener("touchend", handlePointerUp);

    // 7. Resize Handler
    const handleResize = () => {
      if (!container) return;
      width = container.clientWidth;
      height = container.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    window.addEventListener("resize", handleResize, { passive: true });

    // 8. Animation Render Loop (Silky 60 FPS)
    let animId: number = 0;

    const render = () => {
      if (!isVisibleRef.current || document.hidden) {
        animId = requestAnimationFrame(render);
        return;
      }

      // Smooth continuous left-to-right rotation
      if (!isDragging) {
        targetRotationY += 0.0018;
      }

      currentRotationY += (targetRotationY - currentRotationY) * 0.06;
      currentRotationX += (targetRotationX - currentRotationX) * 0.06;

      earthMesh.rotation.y = currentRotationY;

      renderer.render(scene, camera);
      animId = requestAnimationFrame(render);
    };

    render();

    // 9. Intersection Observer to sleep when off-screen
    const observer = new IntersectionObserver(
      (entries) => {
        isVisibleRef.current = entries[0]?.isIntersecting ?? true;
      },
      { threshold: 0.02 }
    );
    observer.observe(container);

    return () => {
      window.removeEventListener("resize", handleResize);
      container.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", handlePointerUp);
      container.removeEventListener("touchstart", handlePointerDown);
      window.removeEventListener("touchmove", handlePointerMove);
      window.removeEventListener("touchend", handlePointerUp);
      observer.disconnect();
      cancelAnimationFrame(animId);

      renderer.dispose();
      earthGeometry.dispose();
      earthMaterial.dispose();
      atmosphereMaterial.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full cursor-grab active:cursor-grabbing select-none ${className}`}
      style={{
        transform: "translate3d(0, 0, 0)",
        contain: "strict",
      }}
    />
  );
}
