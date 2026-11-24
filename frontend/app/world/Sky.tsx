"use client";

// ─── Sky dome + sun disc + stars ─────────────────────────────────────────────
// A camera-locked gradient dome (top → horizon), a sun/moon disc, and a star
// field, all driven by the DUSK ↔ BLACKOUT lerp in Lights.tsx through the refs
// it hands us. None of it is fogged (the fog colour IS the horizon colour, so
// the ground fades straight into the dome).

import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

export interface SkyHandle {
  top: THREE.Color;
  bottom: THREE.Color;
  mid: THREE.Color;
  disc: THREE.Color;
  discPos: THREE.Vector3;
  discSize: { value: number };
  stars: { value: number }; // 0..1 opacity
}

const DOME_R = 118; // inside the camera's far plane (140)

const vert = /* glsl */ `
  varying float vH;
  void main() {
    vH = normalize(position).y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const frag = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uBottom;
  uniform vec3 uMid;
  varying float vH;
  void main() {
    // Three stops: horizon glow → a pink/magenta band → deep purple overhead.
    float a = smoothstep(-0.04, 0.2, vH);
    float b = smoothstep(0.14, 0.62, vH);
    vec3 c = mix(uBottom, uMid, a);
    c = mix(c, uTop, b);
    gl_FragColor = vec4(c, 1.0);
  }
`;

const Sky = forwardRef<SkyHandle>(function Sky(_, ref) {
  const { camera } = useThree();
  const dome = useRef<THREE.Mesh>(null);
  const discRef = useRef<THREE.Mesh>(null);
  const starsRef = useRef<THREE.Points>(null);

  const uniforms = useMemo(
    () => ({
      uTop: { value: new THREE.Color("#2a1240") },
      uBottom: { value: new THREE.Color("#f6a65c") },
      uMid: { value: new THREE.Color("#c2578f") },
    }),
    [],
  );
  const discColor = useMemo(() => new THREE.Color("#ffd27a"), []);
  const discPos = useMemo(() => new THREE.Vector3(-60, 26, -110), []);
  const discSize = useMemo(() => ({ value: 14 }), []);
  const stars = useMemo(() => ({ value: 0 }), []);

  useImperativeHandle(ref, () => ({
    top: uniforms.uTop.value,
    bottom: uniforms.uBottom.value,
    mid: uniforms.uMid.value,
    disc: discColor,
    discPos,
    discSize,
    stars,
  }));

  // Star field on the upper hemisphere, built once.
  const starGeo = useMemo(() => {
    const n = 420;
    const pos = new Float32Array(n * 3);
    let seed = 7;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < n; i++) {
      const u = rnd();
      const v = rnd();
      const theta = u * Math.PI * 2;
      const phi = Math.acos(0.15 + v * 0.85); // keep them above the horizon
      const r = DOME_R * 0.96;
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.cos(phi);
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);

  useFrame(() => {
    // Lock everything to the camera so the sky never parallaxes or clips.
    if (dome.current) dome.current.position.copy(camera.position);
    if (starsRef.current) {
      starsRef.current.position.copy(camera.position);
      const m = starsRef.current.material as THREE.PointsMaterial;
      m.opacity = stars.value;
      starsRef.current.visible = stars.value > 0.02;
    }
    if (discRef.current) {
      discRef.current.position.copy(camera.position).add(discPos);
      discRef.current.lookAt(camera.position);
      const s = discSize.value;
      discRef.current.scale.set(s, s, s);
      (discRef.current.material as THREE.MeshBasicMaterial).color.copy(discColor);
    }
  });

  return (
    <group>
      <mesh ref={dome} renderOrder={-10} frustumCulled={false}>
        <sphereGeometry args={[DOME_R, 24, 14]} />
        <shaderMaterial
          uniforms={uniforms}
          vertexShader={vert}
          fragmentShader={frag}
          side={THREE.BackSide}
          depthWrite={false}
          fog={false}
        />
      </mesh>
      <mesh ref={discRef} renderOrder={-9} frustumCulled={false}>
        <circleGeometry args={[1, 28]} />
        <meshBasicMaterial color="#ffd27a" fog={false} toneMapped={false} depthWrite={false} />
      </mesh>
      <points ref={starsRef} geometry={starGeo} renderOrder={-9} frustumCulled={false}>
        <pointsMaterial color="#ffffff" size={0.9} sizeAttenuation transparent opacity={0} fog={false} depthWrite={false} />
      </points>
    </group>
  );
});

export default Sky;
