"use client";
/* Eye candy only — if WebGL fails the desk keeps working. Rendered only on
   wide screens (the wrapper is display:none under 1280px) and loaded lazily. */
import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function NeuralCore() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const router = useRouter();
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (typeof window !== "undefined" && window.innerWidth < 1280) return;
    let raf = 0, dispose: (() => void) | null = null, cancelled = false;
    import("three").then(THREE => {
      if (cancelled) return;
      try {
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(36, 2, 0.1, 80);
        const loader = new THREE.TextureLoader();
        const tex = loader.load("/assets/neural-core-4lobe.jpg");
        const coreTex = loader.load("/assets/neural-core.jpg");
        const brain = new THREE.Group();
        scene.add(brain);
        [2.55, 2.9, 3.25].forEach((r, i) => {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.018, 8, 96), new THREE.MeshBasicMaterial({ color: 0x00e8ff, transparent: true, opacity: 0.5 - i * 0.12 }));
          ring.rotation.x = Math.PI / 2; brain.add(ring);
        });
        const lobes = [
          { href: "/floor/1", color: 0x00e8ff, p: [0.2, -1.05, 0.15], s: [0.85, 0.7, 0.75] },
          { href: "/floor/2", color: 0x3d8bff, p: [-0.9, 0.4, -0.2], s: [1.35, 1.15, 1.05] },
          { href: "/floor/3", color: 0xff6a00, p: [0.95, -0.05, 0.35], s: [1.25, 0.95, 1.05] },
          { href: "/floor/4", color: 0xffe14a, p: [0.5, 0.95, 0.45], s: [1.1, 0.95, 0.95] }
        ];
        const meshes: InstanceType<typeof THREE.Mesh>[] = [];
        lobes.forEach(L => {
          const mat = new THREE.MeshStandardMaterial({ color: L.color, emissive: L.color, emissiveIntensity: 0.7, metalness: 0.15, roughness: 0.28, transparent: true, opacity: 0.22 });
          const m = new THREE.Mesh(new THREE.SphereGeometry(1, 36, 28), mat);
          m.position.set(L.p[0], L.p[1], L.p[2]); m.scale.set(L.s[0], L.s[1], L.s[2]); m.userData.href = L.href;
          brain.add(m); meshes.push(m);
        });
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
        sprite.scale.set(4.55, 4.55, 1); sprite.renderOrder = 2; scene.add(sprite);
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: coreTex, transparent: true, opacity: 0.18, depthTest: false, depthWrite: false }));
        halo.scale.set(5.1, 5.1, 1); halo.renderOrder = 1; scene.add(halo);
        scene.add(new THREE.AmbientLight(0x1a2a44, 0.9));
        const l1 = new THREE.PointLight(0x00e8ff, 36, 22); l1.position.set(-4, 2, 5); scene.add(l1);
        const l2 = new THREE.PointLight(0xff6a00, 28, 18); l2.position.set(5, 1, -3); scene.add(l2);
        const l3 = new THREE.PointLight(0xffe14a, 22, 16); l3.position.set(1, 5, 2); scene.add(l3);
        const stars = new THREE.BufferGeometry();
        const pos: number[] = [];
        for (let i = 0; i < 600; i++) pos.push((Math.random() - 0.5) * 40, (Math.random() - 0.5) * 24, (Math.random() - 0.5) * 40);
        stars.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        scene.add(new THREE.Points(stars, new THREE.PointsMaterial({ color: 0x88e0ff, size: 0.035 })));
        const ray = new THREE.Raycaster(); const mouse = new THREE.Vector2();
        let drag = false, lastX = 0, lastY = 0, auto = true, theta = 0.35, phi = 1.05, dist = 8.6, moved = 0;
        const layout = () => { const w = canvas.clientWidth, h = canvas.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
        const ro = new ResizeObserver(layout); ro.observe(canvas); layout();
        const down = (e: PointerEvent) => { drag = true; auto = false; moved = 0; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); };
        const up = () => { drag = false; };
        const move = (e: PointerEvent) => { if (!drag) return; const dx = e.clientX - lastX, dy = e.clientY - lastY; moved += Math.abs(dx) + Math.abs(dy); theta -= dx * 0.005; phi -= dy * 0.005; phi = Math.max(0.45, Math.min(1.4, phi)); lastX = e.clientX; lastY = e.clientY; };
        const wheel = (e: WheelEvent) => { dist = Math.max(6, Math.min(14, dist + e.deltaY * 0.01)); e.preventDefault(); };
        const click = (e: MouseEvent) => {
          if (moved > 8) return;
          const r = canvas.getBoundingClientRect();
          mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1; mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
          ray.setFromCamera(mouse, camera);
          const hit = ray.intersectObjects(meshes)[0];
          if (hit) router.push(hit.object.userData.href);
        };
        canvas.addEventListener("pointerdown", down); canvas.addEventListener("pointerup", up);
        canvas.addEventListener("pointermove", move); canvas.addEventListener("wheel", wheel, { passive: false });
        canvas.addEventListener("click", click);
        const frame = () => {
          if (auto) theta += 0.0035;
          camera.position.set(Math.cos(theta) * Math.sin(phi) * dist, 0.35 + Math.cos(phi) * dist * 0.35, Math.sin(theta) * Math.sin(phi) * dist);
          camera.lookAt(0, 0, 0);
          brain.rotation.y += auto ? 0.003 : 0;
          renderer.render(scene, camera);
          raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);
        dispose = () => {
          cancelAnimationFrame(raf); ro.disconnect();
          canvas.removeEventListener("pointerdown", down); canvas.removeEventListener("pointerup", up);
          canvas.removeEventListener("pointermove", move); canvas.removeEventListener("wheel", wheel); canvas.removeEventListener("click", click);
          renderer.dispose();
        };
      } catch (e) { setFailed(String((e as Error).message || e)); }
    }).catch(e => setFailed(String(e)));
    return () => { cancelled = true; if (dispose) dispose(); };
  }, [router]);
  if (failed) return <div style={{ height: 220, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--dim)", border: "1px solid var(--line)", borderRadius: 10 }}>3D core offline — use the lobe map or nav</div>;
  return <canvas id="tower" ref={ref} />;
}
