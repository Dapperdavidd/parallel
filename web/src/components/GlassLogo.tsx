"use client";

import { useEffect, useRef } from "react";

/**
 * The hero mark as a real glass object.
 *
 * A PNG cannot bend what is behind it. This renders the same two bars as
 * extruded, heavily bevelled solids in WebGL with a transmissive material, and
 * feeds the hero's own video in as the thing they refract — so the laundromat
 * behind the mark visibly warps through the glass and shifts as it floats.
 *
 * It is strictly an upgrade on the PNG, never a requirement:
 *
 *   - three.js is imported only after first paint, so it is off the critical
 *     path and out of the initial bundle;
 *   - the PNG stays on screen until the first WebGL frame is actually drawn,
 *     then cross-fades out, so a failure at any point leaves the PNG in place;
 *   - no WebGL, reduced motion, a small screen or a thin connection and this
 *     never starts at all.
 *
 * Alignment: rather than duplicate the CSS, the mesh is positioned from the
 * PNG element's own measured rectangle, so the two agree at every breakpoint.
 */

/* The mark, in the 48x48 viewBox the SVG uses: two slanted bars with
   straight-cut ends that never touch. Y is flipped and the pair centred, so
   the shapes arrive in the usual y-up space. */
const BAR_LONG = [
  [7, 44],
  [14, 44],
  [26, 4],
  [19, 4],
] as const;
const BAR_SHORT = [
  [28, 24],
  [35, 24],
  [41, 4],
  [34, 4],
] as const;

/** Half the design box, for centring: the pair spans 34 x 40 units. */
const DESIGN_H = 40;

/* Proportions, as fractions of a bar's perpendicular width (6.70 units). */
const BAR_W = 6.7;
const BEVEL = 0.41 * BAR_W;
const DEPTH = 0.36 * BAR_W;
const BEVEL_T = 0.22 * BAR_W;

type Pt = [number, number];

/**
 * Shrink a convex polygon by `d` on every edge.
 *
 * ExtrudeGeometry's bevel grows the outline outward by bevelSize. Insetting
 * the source polygon by the same amount first means the finished solid's
 * silhouette is the mark as drawn — without this the two bars fatten into each
 * other and the gap closes.
 */
function inset(poly: readonly (readonly [number, number])[], d: number): Pt[] {
  const n = poly.length;
  const cx = poly.reduce((a, p) => a + p[0], 0) / n;
  const cy = poly.reduce((a, p) => a + p[1], 0) / n;

  // Each edge, pushed toward the centroid along its own normal.
  const lines = poly.map((p, i) => {
    const q = poly[(i + 1) % n]!;
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    let nx = -uy;
    let ny = ux;
    if (nx * (cx - p[0]) + ny * (cy - p[1]) < 0) {
      nx = -nx;
      ny = -ny;
    }
    return { px: p[0] + nx * d, py: p[1] + ny * d, ux, uy };
  });

  // A vertex is where its two adjacent offset edges now cross.
  return lines.map((l, i) => {
    const m = lines[(i + n - 1) % n]!;
    const denom = m.ux * l.uy - m.uy * l.ux;
    if (Math.abs(denom) < 1e-6) return [l.px, l.py] as Pt;
    const t = ((l.px - m.px) * l.uy - (l.py - m.py) * l.ux) / denom;
    return [m.px + m.ux * t, m.py + m.uy * t] as Pt;
  });
}

/** Viewbox coords (y down, origin top-left) to centred, y-up shape space. */
const toShape = (p: readonly (readonly [number, number])[]): Pt[] =>
  p.map(([x, y]) => [x - 24, 24 - y] as Pt);

function parseObjectPosition(value: string): [number, number] {
  const parts = value.trim().split(/\s+/);
  const pct = (s: string | undefined, fallback: number): number => {
    if (!s) return fallback;
    if (s.endsWith("%")) return parseFloat(s) / 100;
    if (s === "left" || s === "top") return 0;
    if (s === "right" || s === "bottom") return 1;
    if (s === "center") return 0.5;
    return fallback;
  };
  return [pct(parts[0], 0.5), pct(parts[1], 0.5)];
}

export function GlassLogo({
  videoRef,
  anchorRef,
  onLive,
}: {
  /** The hero video. Its frames are what the glass refracts. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** The PNG element whose box the mesh matches. */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Called once the first WebGL frame is on screen, to retire the PNG. */
  onLive: (live: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    const anchor = anchorRef.current;
    if (!canvas || !video || !anchor) return;

    // ---- Should this run at all? -----------------------------------------
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (window.innerWidth <= 820) return; // phones keep the PNG

    type Conn = { saveData?: boolean; effectiveType?: string };
    const conn = (navigator as Navigator & { connection?: Conn }).connection;
    if (conn?.saveData === true) return;
    if (conn?.effectiveType && /2g|3g/.test(conn.effectiveType)) return;

    // A WebGL2 context is cheap to probe and tells us the real answer.
    try {
      const probe = document.createElement("canvas").getContext("webgl2");
      if (!probe) return;
    } catch {
      return;
    }

    let disposed = false;
    let stop: (() => void) | undefined;

    const start = async (): Promise<void> => {
      let THREE: typeof import("three");
      let RoomEnvironment: typeof import("three/examples/jsm/environments/RoomEnvironment.js")["RoomEnvironment"];
      try {
        [THREE, { RoomEnvironment }] = await Promise.all([
          import("three"),
          import("three/examples/jsm/environments/RoomEnvironment.js"),
        ]);
      } catch {
        return; // PNG stays
      }
      if (disposed) return;

      let renderer: import("three").WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({
          canvas,
          alpha: true,
          antialias: true,
          powerPreference: "high-performance",
        });
      } catch {
        return;
      }
      renderer.setClearAlpha(0);
      // No tone mapping: the refraction plane is a raw shader that writes the
      // video's own values, so tone-mapping the glass on top of it would make
      // the mark read darker than everything around it.
      renderer.toneMapping = THREE.NoToneMapping;

      const scene = new THREE.Scene();

      // 1 world unit == 1 CSS pixel at the glass's depth, so the mesh can be
      // placed straight from the PNG's measured rectangle.
      const FOV = 30;
      const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 6000);

      // ---- environment: the rims and the long highlights -----------------
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
      scene.environment = envRT.texture;

      const key = new THREE.DirectionalLight(0xffffff, 2.6);
      key.position.set(-1.1, 1.5, 1.2);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xbfd2ff, 0.5);
      fill.position.set(1.4, -0.6, 0.8);
      scene.add(fill);

      // ---- the glass ------------------------------------------------------
      const makeBar = (poly: readonly (readonly [number, number])[]) => {
        const pts = inset(toShape(poly), BEVEL);
        const shape = new THREE.Shape();
        shape.moveTo(pts[0]![0], pts[0]![1]);
        for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i]![0], pts[i]![1]);
        shape.closePath();
        return new THREE.ExtrudeGeometry(shape, {
          depth: DEPTH,
          bevelEnabled: true,
          bevelSegments: 10,
          bevelSize: BEVEL,
          bevelThickness: BEVEL_T,
          curveSegments: 1,
        });
      };

      const material = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0,
        roughness: 0.04,
        transmission: 1,
        ior: 1.5,
        clearcoat: 1,
        clearcoatRoughness: 0.03,
        reflectivity: 0.6,
        attenuationColor: new THREE.Color(0x8d93a3),
        // Set from the object's scale below — both are world-space lengths,
        // so they have to track how large the mark is actually drawn.
        thickness: 1,
        attenuationDistance: 1,
      });

      const logo = new THREE.Group();
      const barLong = new THREE.Mesh(makeBar(BAR_LONG), material);
      const barShort = new THREE.Mesh(makeBar(BAR_SHORT), material);
      // Centre the pair on its own depth so it turns about its middle.
      barLong.position.z = -(DEPTH + BEVEL_T * 2) / 2;
      barShort.position.z = barLong.position.z;
      logo.add(barLong, barShort);
      scene.add(logo);

      // ---- what it refracts ----------------------------------------------
      // A patch of the hero video, aligned to the real one underneath and
      // faded out well before its own edges, so the full-quality DOM video
      // shows everywhere except the small region the glass actually bends.
      const tex = new THREE.VideoTexture(video);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;

      const planeMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          map: { value: tex },
          uvScale: { value: new THREE.Vector2(1, 1) },
          uvOffset: { value: new THREE.Vector2(0, 0) },
        },
        vertexShader: `
          varying vec2 vUv;
          void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
        `,
        fragmentShader: `
          uniform sampler2D map;
          uniform vec2 uvScale;
          uniform vec2 uvOffset;
          varying vec2 vUv;
          void main(){
            gl_FragColor = vec4(texture2D(map, vUv * uvScale + uvOffset).rgb, 1.0);
          }
        `,
      });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), planeMat);
      plane.renderOrder = -1;
      scene.add(plane);

      // ---- layout ---------------------------------------------------------
      const PLANE_DEPTH = 260; // behind the glass, so the bend has somewhere to go
      let w = 0;
      let h = 0;

      const layout = (): void => {
        const box = canvas.getBoundingClientRect();
        w = Math.max(1, Math.round(box.width));
        h = Math.max(1, Math.round(box.height));

        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        renderer.setSize(w, h, false);

        const camZ = h / 2 / Math.tan((FOV / 2) * (Math.PI / 180));
        camera.position.set(0, 0, camZ);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();

        // The mesh takes the PNG's box exactly.
        const a = anchor.getBoundingClientRect();
        const cx = a.left + a.width / 2 - (box.left + w / 2);
        const cy = box.top + h / 2 - (a.top + a.height / 2);
        const scale = a.height / DESIGN_H;
        logo.position.set(cx, cy, 0);
        logo.scale.setScalar(scale);
        // A bar is ~5.6 design units deep. Attenuation over roughly half
        // again that distance gives smoke you can still see through; at the
        // literal 0.9 the bars come out solid black.
        material.thickness = 4.5 * scale;
        material.attenuationDistance = 26 * scale;

        // The plane is the hero's own frame, redrawn. It covers the whole
        // canvas and the DOM video is hidden behind it, so there is exactly
        // one copy of the video on screen and no seam to misalign.
        const pw = w;
        const ph = h;
        const x0 = 0;
        const y0 = 0;

        // Where CSS draws the video in this box: object-fit cover, with the
        // page's own object-position — read from the element, not duplicated,
        // so the breakpoints cannot drift apart.
        const vw = video.videoWidth || 16;
        const vh = video.videoHeight || 9;
        const cover = Math.max(w / vw, h / vh);
        const dw = vw * cover;
        const dh = vh * cover;
        const [px, py] = parseObjectPosition(getComputedStyle(video).objectPosition);
        const dx = (w - dw) * px;
        const dy = (h - dh) * py;

        planeMat.uniforms.uvScale!.value.set(pw / dw, ph / dh);
        planeMat.uniforms.uvOffset!.value.set(
          (x0 - dx) / dw,
          1 - (y0 - dy + ph) / dh,
        );

        // Push it back, and grow it so it still covers the same screen area.
        const k = (camZ + PLANE_DEPTH) / camZ;
        plane.scale.set(pw * k, ph * k, 1);
        plane.position.set(
          (x0 + pw / 2 - w / 2) * k,
          (h / 2 - (y0 + ph / 2)) * k,
          -PLANE_DEPTH,
        );
      };

      layout();

      // ---- run only when it is worth running -------------------------------
      let onScreen = true;
      let raf = 0;
      let first = true;
      const t0 = performance.now();

      const frame = (): void => {
        raf = requestAnimationFrame(frame);
        const t = (performance.now() - t0) / 1000;

        // The same 8s cycle the CSS float uses, plus a slow turn so the
        // highlights slide along the bars.
        const phase = (t / 8) * Math.PI * 2;
        const a = anchor.getBoundingClientRect();
        logo.position.y =
          (canvas.getBoundingClientRect().top + h / 2 - (a.top + a.height / 2)) +
          Math.sin(phase) * a.height * 0.027;
        logo.rotation.z = -Math.sin(phase) * 0.0131; // ~1.5deg at the peak
        logo.rotation.y = Math.sin((t / 19) * Math.PI * 2) * 0.07; // ~4deg

        renderer.render(scene, camera);

        if (first) {
          first = false;
          onLive(true);
        }
      };

      const run = (): void => {
        if (!raf && onScreen && !document.hidden) raf = requestAnimationFrame(frame);
      };
      const halt = (): void => {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
      };

      const io = new IntersectionObserver(
        ([e]) => {
          onScreen = !!e?.isIntersecting;
          onScreen ? run() : halt();
        },
        { threshold: 0 },
      );
      io.observe(canvas);

      const onVis = (): void => (document.hidden ? halt() : run());
      const onResize = (): void => {
        layout();
        if (!raf) renderer.render(scene, camera);
      };

      document.addEventListener("visibilitychange", onVis);
      addEventListener("resize", onResize);
      addEventListener("scroll", onResize, { passive: true });
      run();

      stop = () => {
        halt();
        io.disconnect();
        document.removeEventListener("visibilitychange", onVis);
        removeEventListener("resize", onResize);
        removeEventListener("scroll", onResize);
        barLong.geometry.dispose();
        barShort.geometry.dispose();
        plane.geometry.dispose();
        planeMat.dispose();
        material.dispose();
        tex.dispose();
        envRT.dispose();
        pmrem.dispose();
        renderer.dispose();
        onLive(false);
      };
    };

    // Off the critical path: let the page paint and the video get going
    // first. A plain timer rather than requestIdleCallback — with a video
    // decoding there may never be an idle period, and the callback can sit
    // unfired long past its own timeout.
    const timer = setTimeout(() => void start(), 700);

    return () => {
      disposed = true;
      clearTimeout(timer);
      stop?.();
    };
  }, [videoRef, anchorRef, onLive]);

  return <canvas ref={canvasRef} className="glass-canvas" aria-hidden="true" />;
}
