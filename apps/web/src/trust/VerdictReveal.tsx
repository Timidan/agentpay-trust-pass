import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { isWebglAvailable, prefersReducedMotion } from "./capabilities";
import "./verdict-reveal.css";

export { isWebglAvailable, prefersReducedMotion };

/**
 * VerdictReveal — a "one scalar drives everything" trust-verdict reveal.
 *
 * The technique blends three things the research surfaced:
 *  - akella (Yuri Artiukh): a real image/asset lives on a WebGL plane and a
 *    fragment shader resolves it from pixelated/dithered chaos to clarity.
 *  - Thibault Guignand: a SINGLE tweened uniform (uProgress 0->1) drives the
 *    shader (pixelation + noise displacement + chromatic aberration) AND the
 *    DOM (glow, scanning copy, verdict panel) so they can never desync.
 *  - Family (Benji Taylor): the verdict panel rises/settles as a continuity
 *    move; DANGER gets the strongest motion, CLEAR stays quiet.
 *
 * The residual disorder at the END of the reveal is a function of the verdict:
 * CLEAR resolves clean, CAUTION keeps a faint dither, DANGER keeps a red
 * glitch — so motion intensity literally encodes risk. Honesty guardrails:
 * under prefers-reduced-motion or without WebGL it ships the final, readable
 * state immediately (matching the rest of the app).
 */

export type Aspect = "CLEAR" | "CAUTION" | "DANGER";

export type VerdictRevealProps = {
  aspect: Aspect;
  /** The "real asset": token chart, logo, or screenshot. Data URLs or same-origin avoid WebGL texture taint; remote URLs need CORS. */
  imageSrc: string;
  label?: string;
  rationale?: string;
  flags?: { code: string; message: string }[];
  /** Bump to replay the reveal with the same/!new aspect. */
  runId?: number;
  durationMs?: number;
  onComplete?: () => void;
  /** Drop the card border/shadow/background so the reveal blends into a scene (e.g. the hero). */
  chromeless?: boolean;
  className?: string;
};

type Uniforms = {
  uTex: { value: THREE.Texture | null };
  uProgress: { value: number };
  uVerdict: { value: number };
  uTint: { value: THREE.Color };
  uTime: { value: number };
  uCover: { value: THREE.Vector2 };
};

const ASPECT: Record<Aspect, { v: number; hsl: [number, number, number]; css: string }> = {
  CLEAR: { v: 1.0, hsl: [150, 70, 52], css: "hsl(150 70% 52%)" },
  CAUTION: { v: 0.5, hsl: [36, 96, 57], css: "hsl(36 96% 57%)" },
  DANGER: { v: 0.0, hsl: [353, 86, 60], css: "hsl(353 86% 60%)" }
};

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  precision highp float;
  uniform sampler2D uTex;
  uniform float uProgress;
  uniform float uVerdict;
  uniform vec3 uTint;
  uniform float uTime;
  uniform vec2 uCover;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  void main() {
    vec2 uv = (vUv - 0.5) * uCover + 0.5;
    float p = clamp(uProgress, 0.0, 1.0);

    // disorder that survives to p=1 depends on the verdict: DANGER keeps the most.
    float residual = mix(0.32, 0.0, smoothstep(0.0, 1.0, uVerdict));
    float disorder = mix(1.0, residual, smoothstep(0.0, 1.0, p));

    // akella: pixel blocks "resolve" as progress climbs
    float blocks = mix(7.0, 1200.0, smoothstep(0.0, 0.85, p));
    vec2 puv = floor(uv * blocks) / blocks;

    // Guignand: noise displacement warp
    float n = noise(puv * 8.0 + uTime * 0.15);
    vec2 disp = (vec2(n, noise(puv * 8.0 - uTime * 0.12)) - 0.5) * 0.12 * disorder;
    vec2 suv = puv + disp;

    // chromatic aberration peaks mid-reveal, plus DANGER residual
    float aberr = (sin(p * 3.14159) * 0.5 + disorder * 0.5) * 0.018;
    float r = texture2D(uTex, suv + vec2(aberr, 0.0)).r;
    float g = texture2D(uTex, suv).g;
    float b = texture2D(uTex, suv - vec2(aberr, 0.0)).b;
    vec3 col = vec3(r, g, b);

    // dither + desaturation while "scanning"
    float dither = (hash(floor(uv * blocks) + floor(uTime * 8.0)) - 0.5) * 0.22 * disorder;
    col += dither;
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(lum), col, smoothstep(0.0, 1.0, p));

    // scanning sweep band, fades out as it resolves
    float sweep = fract(uTime * 0.5);
    float band = smoothstep(0.05, 0.0, abs(uv.y - sweep)) * (1.0 - p);
    col += uTint * band * 0.55;

    // verdict colour grade (stronger for DANGER)
    float gradeAmt = mix(0.10, 0.20, 1.0 - smoothstep(0.0, 1.0, uVerdict));
    col = mix(col, col * (0.6 + uTint), gradeAmt * (0.5 + 0.5 * p));

    // vignette so the asset sits inside the card
    float vig = smoothstep(1.15, 0.32, length(vUv - 0.5));
    col *= vig;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function VerdictReveal({
  aspect,
  imageSrc,
  label,
  rationale,
  flags = [],
  runId = 0,
  durationMs = 2200,
  onComplete,
  chromeless = false,
  className = ""
}: VerdictRevealProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [supported] = useState(() => typeof window !== "undefined" && isWebglAvailable());

  // Uniforms are created during render so the GSAP reveal can always read them,
  // regardless of effect ordering.
  const uniformsRef = useRef<Uniforms | undefined>(undefined);
  if (!uniformsRef.current) {
    uniformsRef.current = {
      uTex: { value: null },
      uProgress: { value: 0 },
      uVerdict: { value: ASPECT[aspect].v },
      uTint: { value: new THREE.Color().setRGB(...hslToRgb(...ASPECT[aspect].hsl)) },
      uTime: { value: 0 },
      uCover: { value: new THREE.Vector2(1, 1) }
    };
  }

  // --- Three.js renderer lifecycle (rebuilds when the asset changes) ---
  useEffect(() => {
    if (!supported) {
      return;
    }
    const canvas = canvasRef.current;
    const root = rootRef.current;
    const uniforms = uniformsRef.current;
    if (!canvas || !root || !uniforms) {
      return;
    }

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = new THREE.ShaderMaterial({
      uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT
    });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    let imageAspect = 1;
    const applySize = () => {
      const w = root.clientWidth || 1;
      const h = root.clientHeight || 1;
      renderer.setSize(w, h, false);
      const planeAspect = w / h;
      if (planeAspect > imageAspect) {
        uniforms.uCover.value.set(1, imageAspect / planeAspect);
      } else {
        uniforms.uCover.value.set(planeAspect / imageAspect, 1);
      }
    };

    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(imageSrc, (texture) => {
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      imageAspect = (texture.image?.width || 1) / (texture.image?.height || 1);
      uniforms.uTex.value = texture;
      applySize();
    });

    applySize();
    const resizeObserver =
      typeof ResizeObserver === "function" ? new ResizeObserver(applySize) : null;
    resizeObserver?.observe(root);

    const clock = new THREE.Clock();
    let raf = 0;
    const tick = () => {
      uniforms.uTime.value = clock.getElapsedTime();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver?.disconnect();
      uniforms.uTex.value?.dispose();
      uniforms.uTex.value = null;
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, [imageSrc, supported]);

  // --- The reveal: one timeline, re-armed whenever aspect/runId change ---
  useGSAP(
    () => {
      const uniforms = uniformsRef.current;
      const root = rootRef.current;
      if (!uniforms || !root) {
        return;
      }

      const config = ASPECT[aspect];
      uniforms.uVerdict.value = config.v;
      uniforms.uTint.value.setRGB(...hslToRgb(...config.hsl));
      root.style.setProperty("--vr-tint", config.css);

      const finalState = () => {
        uniforms.uProgress.value = 1;
        root.style.setProperty("--rp", "1");
        gsap.set(".vr-panel", { autoAlpha: 1, y: 0, scale: 1 });
        onComplete?.();
      };

      if (prefersReducedMotion() || !supported) {
        finalState();
        return;
      }

      uniforms.uProgress.value = 0;
      root.style.setProperty("--rp", "0");
      gsap.set(".vr-panel", { autoAlpha: 0, y: aspect === "DANGER" ? 36 : 22, scale: 0.96 });

      const duration = durationMs / 1000;
      const tl = gsap.timeline({ onComplete });
      tl.to(uniforms.uProgress, {
        value: 1,
        duration,
        ease: "power2.inOut",
        onUpdate() {
          root.style.setProperty("--rp", String(uniforms.uProgress.value));
        }
      });
      // Family-style continuity: the panel settles in as the asset resolves.
      tl.to(
        ".vr-panel",
        { autoAlpha: 1, y: 0, scale: 1, duration: 0.55, ease: "power3.out" },
        duration * 0.55
      );
      // Reserve the strongest motion for DANGER.
      if (aspect === "DANGER") {
        tl.to(
          ".vr-word",
          { keyframes: { x: [0, -6, 5, -3, 0] }, duration: 0.34, ease: "power1.inOut" },
          ">-0.12"
        );
      }
    },
    { scope: rootRef, dependencies: [aspect, runId, supported], revertOnUpdate: true }
  );

  const aspectClass = aspect.toLowerCase();

  return (
    <div
      ref={rootRef}
      className={`vr-root vr-root--${aspectClass}${chromeless ? " vr-root--chromeless" : ""}${className ? ` ${className}` : ""}`}
      style={{ "--vr-tint": ASPECT[aspect].css } as React.CSSProperties}
      data-supported={supported ? "webgl" : "fallback"}
      aria-label={`Verdict reveal: ${aspect}`}
    >
      {supported ? (
        <canvas ref={canvasRef} className="vr-canvas" aria-hidden="true" />
      ) : (
        <img className={`vr-fallback vr-fallback--${aspectClass}`} src={imageSrc} alt="" aria-hidden="true" />
      )}

      {/* Ambient glow driven by the same progress var (Active Theory idea) */}
      <div className="vr-glow" aria-hidden="true" />

      {/* "Scanning" copy fades out as the asset resolves */}
      <div className="vr-scanning" aria-hidden="true">Scanning on-chain evidence</div>

      {/* The verdict panel — the shared-element-style settle target */}
      <div className="vr-panel">
        {label ? <p className="vr-kicker mono-label">{label}</p> : null}
        <div className="vr-word" style={{ color: "var(--vr-tint)" }}>
          {aspect}
        </div>
        {rationale ? <p className="vr-rationale">{rationale}</p> : null}
        {flags.length > 0 ? (
          <ul className="vr-flags">
            {flags.map((flag) => (
              <li key={flag.code} className="vr-flag">
                <code>{flag.code}</code>
                <span>{flag.message}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

export default VerdictReveal;
