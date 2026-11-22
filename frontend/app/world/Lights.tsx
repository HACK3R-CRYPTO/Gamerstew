"use client";

// ─── Light rig driven by the world theme ─────────────────────────────────────
// One shadow-casting directional "sun", a HemisphereLight for soft fill, a low
// ambient, the fog, and the sky dome (Sky.tsx) are all lerped between the DUSK
// (power on) and BLACKOUT (NEPA cut) presets in theme.ts by `worldControls.lit`
// every frame. This is the 3D equivalent of the 2D UP NEPA ON<->OUT cross-fade.
// The fog colour is the horizon colour, so the street dissolves into the sky.

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { worldControls } from "./controls";
import { DUSK, BLACKOUT, lerp, type TimePreset } from "./theme";
import Sky, { type SkyHandle } from "./Sky";
import { setFacadeGlow } from "./facade";

// Pre-parsed colours for both presets (no per-frame string parsing).
function colours(p: TimePreset) {
  return {
    skyTop: new THREE.Color(p.skyTop),
    skyBottom: new THREE.Color(p.skyBottom),
    skyMid: new THREE.Color(p.skyMid),
    fog: new THREE.Color(p.fog),
    sun: new THREE.Color(p.sun),
    hemiSky: new THREE.Color(p.hemiSky),
    hemiGround: new THREE.Color(p.hemiGround),
    disc: new THREE.Color(p.disc),
    discPos: new THREE.Vector3(...p.discPos),
    sunPos: new THREE.Vector3(...p.sunPos),
  };
}
const ON = colours(DUSK);
const OUT = colours(BLACKOUT);

export default function Lights({ lowPerf }: { lowPerf: boolean }) {
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const amb = useRef<THREE.AmbientLight>(null);
  const sky = useRef<SkyHandle>(null);
  const { scene, gl } = useThree();

  const c = useRef(new THREE.Color());
  const v = useRef(new THREE.Vector3());
  const fog = useRef<THREE.Fog>(null);

  useFrame(() => {
    const lit = worldControls.lit;
    const surge = worldControls.surge;

    if (sun.current) {
      sun.current.intensity = lerp(BLACKOUT.sunI, DUSK.sunI, lit) + surge * 0.8;
      sun.current.color.copy(c.current.copy(OUT.sun).lerp(ON.sun, lit));
      sun.current.position.copy(v.current.copy(OUT.sunPos).lerp(ON.sunPos, lit));
      sun.current.castShadow = !lowPerf;
    }
    if (hemi.current) {
      hemi.current.intensity = lerp(BLACKOUT.hemiI, DUSK.hemiI, lit) + surge * 0.3;
      hemi.current.color.copy(c.current.copy(OUT.hemiSky).lerp(ON.hemiSky, lit));
      hemi.current.groundColor.copy(c.current.copy(OUT.hemiGround).lerp(ON.hemiGround, lit));
    }
    if (amb.current) {
      amb.current.intensity = lerp(BLACKOUT.ambI, DUSK.ambI, lit) + surge * 0.25;
    }

    // Fog = horizon colour. The dome draws behind it, so the far street fades
    // straight into the sky with no visible seam.
    if (!fog.current) {
      fog.current = new THREE.Fog(ON.fog.getHex(), DUSK.fogNear, DUSK.fogFar);
      scene.fog = fog.current;
      scene.background = null; // the dome is the background now
    }
    fog.current.color.copy(c.current.copy(OUT.fog).lerp(ON.fog, lit));
    fog.current.near = lerp(BLACKOUT.fogNear, DUSK.fogNear, lit);
    fog.current.far = lerp(BLACKOUT.fogFar, DUSK.fogFar, lit);

    if (sky.current) {
      sky.current.top.copy(OUT.skyTop).lerp(ON.skyTop, lit);
      sky.current.bottom.copy(OUT.skyBottom).lerp(ON.skyBottom, lit);
      sky.current.mid.copy(OUT.skyMid).lerp(ON.skyMid, lit);
      sky.current.disc.copy(OUT.disc).lerp(ON.disc, lit);
      sky.current.discPos.copy(OUT.discPos).lerp(ON.discPos, lit);
      sky.current.discSize.value = lerp(BLACKOUT.discSize, DUSK.discSize, lit);
      sky.current.stars.value = 1 - lit;
    }

    // Windows follow the power: on with the light, dead in a blackout.
    setFacadeGlow(lerp(BLACKOUT.windowGlow, DUSK.windowGlow, lit) + surge * 0.6);

    // Whole-frame warm flash on UP NEPA: lift exposure so the relight reads as a
    // surge sweeping the street, then ease straight back.
    gl.toneMappingExposure = lerp(BLACKOUT.exposure, DUSK.exposure, lit) + surge * 0.35;
  });

  return (
    <>
      <Sky ref={sky} />
      <ambientLight ref={amb} intensity={DUSK.ambI} />
      <hemisphereLight ref={hemi} intensity={DUSK.hemiI} />
      <directionalLight
        ref={sun}
        position={DUSK.sunPos}
        intensity={DUSK.sunI}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={1}
        shadow-camera-far={90}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
        shadow-bias={-0.0004}
      />
    </>
  );
}
