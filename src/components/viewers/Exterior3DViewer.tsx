import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BlueprintData, ExteriorModule, ThemeMode } from '../../types/render';
import {
  applyStudioEnvironment,
  createContactShadowMesh,
  createProceduralTileTexture,
  createProceduralWoodTexture,
  createStudioRenderer,
  exportSceneToGLB,
  exportSceneToOBJ,
  isSoftwareGl,
  scheduleAfterDraw,
} from '../../utils/threeHelpers';
import {
  Camera,
  ChevronDown,
  ChevronUp,
  Download,
  Moon,
  RotateCcw,
  Sun,
  Sunset,
} from 'lucide-react';

interface Exterior3DViewerProps {
  blueprint: BlueprintData;
  theme: ThemeMode;
  uploadedImageDataUrl?: string | null;
}

type TimeOfDay = 'day' | 'sunset' | 'night';

function buildArchitecturalVolumeGroup(
  mod: ExteriorModule,
  concreteTex: THREE.Texture,
  woodTex: THREE.Texture,
  facadeTex: THREE.Texture | null,
  emissiveWindowsMat: THREE.MeshStandardMaterial
): THREE.Group {
  const group = new THREE.Group();
  group.position.set(mod.x, mod.elevationY, mod.z);

  const w = mod.width;
  const d = mod.depth;
  const h = mod.height;
  const oh = mod.overhang || 0.65;

  const concreteMat = new THREE.MeshStandardMaterial({
    map: concreteTex,
    color: 0xd1d5db,
    roughness: 0.62,
    metalness: 0.08,
  });

  const blackSteelMat = new THREE.MeshStandardMaterial({
    color: 0x040b29,
    roughness: 0.34,
    metalness: 0.86,
  });

  const timberSlatMat = new THREE.MeshStandardMaterial({
    map: woodTex,
    color: 0xb47b44,
    roughness: 0.55,
    metalness: 0.05,
  });

  const glassCurtainMat = new THREE.MeshPhysicalMaterial({
    color: 0xa6c8ff,
    roughness: 0.08,
    metalness: 0.15,
    transmission: isSoftwareGl ? 0 : 0.72,
    transparent: true,
    opacity: isSoftwareGl ? 0.55 : 0.92,
    ior: 1.52,
    clearcoat: 1.0,
    depthWrite: false,
  });

  const primaryMat =
    mod.facadeMaterial === 'black_steel_cladding'
      ? blackSteelMat
      : mod.facadeMaterial === 'warm_timber_slats'
        ? timberSlatMat
        : concreteMat;

  const coreShrink = mod.facadeMaterial === 'curtain_glass' ? 0.25 : 0.0;
  const coreMesh = new THREE.Mesh(
    new THREE.BoxGeometry(w - coreShrink, h - 0.22, d - coreShrink),
    primaryMat
  );
  coreMesh.position.set(0, (h - 0.22) / 2, 0);
  coreMesh.castShadow = true;
  coreMesh.receiveShadow = true;
  group.add(coreMesh);

  if (facadeTex && mod.elevationY === 0 && w >= 6.0) {
    const projMat = new THREE.MeshStandardMaterial({
      map: facadeTex,
      roughness: 0.42,
      metalness: 0.12,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const projPlane = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.92, h * 0.82), projMat);
    projPlane.position.set(0, h * 0.46, d / 2 + 0.015);
    group.add(projPlane);
  }

  const bands = Math.max(1, mod.windowBands || 1);
  const bandH = (h - 0.9) / bands;
  for (let b = 0; b < bands; b++) {
    const by = 0.45 + b * bandH + bandH * 0.45;
    const winH = bandH * 0.62;

    const glowBox = new THREE.Mesh(
      new THREE.BoxGeometry(w - 0.35, winH - 0.06, d - 0.35),
      emissiveWindowsMat
    );
    glowBox.position.set(0, by, 0);
    group.add(glowBox);

    const frontGlass = new THREE.Mesh(new THREE.BoxGeometry(w - 0.24, winH, 0.04), glassCurtainMat);
    frontGlass.position.set(0, by, d / 2 + 0.01);
    frontGlass.renderOrder = 6;
    group.add(frontGlass);

    const sill = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, 0.06, d + 0.08), blackSteelMat);
    sill.position.set(0, by - winH / 2 - 0.02, 0);
    group.add(sill);
  }

  const colCount = Math.max(3, Math.round(w / 1.8));
  for (let i = 0; i <= colCount; i++) {
    const cx = -w / 2 + (w / colCount) * i;
    const mullionFront = new THREE.Mesh(new THREE.BoxGeometry(0.08, h, 0.12), blackSteelMat);
    mullionFront.position.set(cx, h / 2, d / 2 + 0.02);
    mullionFront.castShadow = true;
    group.add(mullionFront);

    const mullionBack = new THREE.Mesh(new THREE.BoxGeometry(0.08, h, 0.12), blackSteelMat);
    mullionBack.position.set(cx, h / 2, -d / 2 - 0.02);
    group.add(mullionBack);
  }

  const louverCount = 8;
  for (let l = 0; l < louverCount; l++) {
    const ly = 0.6 + (l / louverCount) * (h - 1.0);
    const louver = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, d * 0.72), timberSlatMat);
    louver.position.set(-w / 2 - 0.04, ly, 0);
    group.add(louver);
  }

  const roofSlab = new THREE.Mesh(
    new THREE.BoxGeometry(w + oh * 2, 0.26, d + oh * 2),
    concreteMat
  );
  roofSlab.position.set(0, h - 0.1, 0);
  roofSlab.castShadow = true;
  roofSlab.receiveShadow = true;
  group.add(roofSlab);

  const roofFascia = new THREE.Mesh(
    new THREE.BoxGeometry(w + oh * 2 + 0.04, 0.12, d + oh * 2 + 0.04),
    blackSteelMat
  );
  roofFascia.position.set(0, h - 0.04, 0);
  group.add(roofFascia);

  return group;
}

function buildArchitecturalTree(x: number, z: number, scale = 1.0): THREE.Group {
  const tree = new THREE.Group();
  tree.position.set(x, 0, z);
  tree.scale.setScalar(scale);

  tree.add(createContactShadowMesh(1.4, 1.4, 0.38));

  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3525, roughness: 0.85 });
  const foliageMat1 = new THREE.MeshStandardMaterial({ color: 0x2d4c3e, roughness: 0.75 });
  const foliageMat2 = new THREE.MeshStandardMaterial({ color: 0x3b6251, roughness: 0.68 });

  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.13, 1.3, 10), trunkMat);
  trunk.position.y = 0.65;
  trunk.castShadow = true;
  tree.add(trunk);

  const c1 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.75, 1), foliageMat1);
  c1.position.set(0, 1.65, 0);
  c1.castShadow = true;
  tree.add(c1);

  const c2 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.55, 1), foliageMat2);
  c2.position.set(0.32, 2.05, 0.18);
  c2.castShadow = true;
  tree.add(c2);

  const c3 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.48, 1), foliageMat1);
  c3.position.set(-0.28, 1.9, -0.22);
  c3.castShadow = true;
  tree.add(c3);

  return tree;
}

export const Exterior3DViewer: React.FC<Exterior3DViewerProps> = ({
  blueprint,
  theme,
  uploadedImageDataUrl,
}) => {
  const canvasMountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);

  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>('day');
  const [autoRotate, setAutoRotate] = useState<boolean>(false);
  const [showHud, setShowHud] = useState<boolean>(true);

  const timeOfDayRef = useRef<TimeOfDay>('day');
  const themeRef = useRef<ThemeMode>(theme);
  const autoRotateRef = useRef<boolean>(false);
  const setCameraPresetRef = useRef<((preset: 'iso' | 'front' | 'aerial') => void) | null>(null);

  const isLight = theme === 'light';

  useEffect(() => {
    timeOfDayRef.current = timeOfDay;
  }, [timeOfDay]);

  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  useEffect(() => {
    autoRotateRef.current = autoRotate;
  }, [autoRotate]);

  useEffect(() => {
    const mount = canvasMountRef.current;
    if (!mount) return;

    const width = mount.clientWidth || window.innerWidth;
    const height = mount.clientHeight || window.innerHeight;

    const renderer = createStudioRenderer(width, height);
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);

    const initialSky = themeRef.current === 'light' ? 0xebf3ff : 0x0b0f19;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(initialSky);
    scene.fog = new THREE.FogExp2(initialSky, 0.012);
    sceneRef.current = scene;

    const envTex = applyStudioEnvironment(renderer, scene);

    const camera = new THREE.PerspectiveCamera(46, width / height, 0.1, 200);
    camera.position.set(16.5, 10.5, 18.5);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    controls.minDistance = 5.0;
    controls.maxDistance = 48.0;
    controls.target.set(0, 2.4, 0);

    const desiredCamPos = new THREE.Vector3().copy(camera.position);
    const desiredTarget = new THREE.Vector3().copy(controls.target);
    let isTransitioningCamera = false;

    controls.addEventListener('start', () => {
      isTransitioningCamera = false;
    });

    setCameraPresetRef.current = (preset) => {
      isTransitioningCamera = true;
      if (preset === 'front') {
        desiredCamPos.set(0, 3.8, 21.0);
        desiredTarget.set(0, 2.6, 0);
      } else if (preset === 'aerial') {
        desiredCamPos.set(0.1, 24.0, 14.0);
        desiredTarget.set(0, 1.5, 0);
      } else {
        desiredCamPos.set(16.5, 10.5, 18.5);
        desiredTarget.set(0, 2.4, 0);
      }
    };

    const hemiLight = new THREE.HemisphereLight(0xe0f2fe, 0x1e293b, 0.85);
    hemiLight.position.set(0, 30, 0);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xfffbeb, 2.4);
    sunLight.position.set(18, 24, 16);
    sunLight.castShadow = !isSoftwareGl;
    sunLight.shadow.mapSize.set(2048, 2048);
    const d = 16;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 65;
    sunLight.shadow.bias = -0.0005;
    sunLight.shadow.normalBias = 0.02;
    scene.add(sunLight);

    const rimLight = new THREE.DirectionalLight(0x0047ba, 0.65);
    rimLight.position.set(-18, 12, -14);
    scene.add(rimLight);

    const concreteTex = createProceduralTileTexture(renderer, '#94a3b8', '#64748b', 6);
    const darkMarbleTex = createProceduralTileTexture(renderer, '#1e293b', '#0f172a', 8);
    const woodTex = createProceduralWoodTexture(renderer);

    const plinthW = Math.max(blueprint.totalWidth + 6, 22);
    const plinthD = Math.max(blueprint.totalDepth + 6, 18);

    const basePlinth = new THREE.Mesh(
      new THREE.BoxGeometry(plinthW + 0.8, 0.45, plinthD + 0.8),
      new THREE.MeshStandardMaterial({ color: 0x040b29, roughness: 0.35, metalness: 0.7 })
    );
    basePlinth.position.set(0, -0.45, 0);
    scene.add(basePlinth);

    const upperPlinth = new THREE.Mesh(
      new THREE.BoxGeometry(plinthW, 0.24, plinthD),
      new THREE.MeshPhysicalMaterial({
        map: darkMarbleTex,
        roughness: 0.18,
        metalness: 0.1,
        clearcoat: 0.75,
        clearcoatRoughness: 0.15,
      })
    );
    upperPlinth.position.set(0, -0.12, 0);
    upperPlinth.receiveShadow = true;
    scene.add(upperPlinth);

    const walkway = new THREE.Mesh(
      new THREE.BoxGeometry(4.2, 0.03, 6.5),
      new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.5 })
    );
    walkway.position.set(1.2, 0.015, 5.2);
    walkway.receiveShadow = true;
    scene.add(walkway);

    let uploadedTex: THREE.Texture | null = null;
    if (uploadedImageDataUrl) {
      const img = new Image();
      img.src = uploadedImageDataUrl;
      uploadedTex = new THREE.Texture(img);
      uploadedTex.colorSpace = THREE.SRGBColorSpace;
      img.onload = () => {
        if (uploadedTex) uploadedTex.needsUpdate = true;
      };
    }

    const emissiveWindowsMat = new THREE.MeshStandardMaterial({
      color: 0xfef3c7,
      emissive: new THREE.Color(0xff7a00),
      emissiveIntensity: 0.25,
      roughness: 0.4,
    });

    const buildingGroup = new THREE.Group();

    // 1. Project user's uploaded plan/elevation onto the base plinth if available
    if (uploadedTex) {
      const basePlanPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(blueprint.totalWidth, blueprint.totalDepth),
        new THREE.MeshStandardMaterial({
          map: uploadedTex,
          roughness: 0.45,
          metalness: 0.05,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        })
      );
      basePlanPlane.rotation.x = -Math.PI / 2;
      basePlanPlane.position.set(0, 0.02, 0);
      basePlanPlane.receiveShadow = true;
      buildingGroup.add(basePlanPlane);
    }

    // 2. Extrude all user walls directly into 3D architectural exterior structural volumes
    const extWallMat = new THREE.MeshStandardMaterial({
      map: concreteTex,
      color: 0xe2e8f0,
      roughness: 0.55,
      metalness: 0.1,
    });
    const extSteelMat = new THREE.MeshStandardMaterial({
      color: 0x040b29,
      roughness: 0.32,
      metalness: 0.85,
    });

    const wallExtHeight = 3.4;
    for (const wall of blueprint.walls) {
      const dx = wall.x2 - wall.x1;
      const dz = wall.z2 - wall.z1;
      const len = Math.hypot(dx, dz);
      if (len < 0.08) continue;

      const angle = Math.atan2(dz, dx);
      const cx = (wall.x1 + wall.x2) / 2;
      const cz = (wall.z1 + wall.z2) / 2;
      const thick = (wall.thickness || 0.2) * 1.15;

      const wMesh = new THREE.Mesh(
        new THREE.BoxGeometry(len, wallExtHeight, thick),
        wall.isExterior ? extWallMat : extSteelMat
      );
      wMesh.position.set(cx, wallExtHeight / 2, cz);
      wMesh.rotation.y = -angle;
      wMesh.castShadow = true;
      wMesh.receiveShadow = true;
      buildingGroup.add(wMesh);

      // Architectural coping / steel fascia cap on top of each wall
      const capMesh = new THREE.Mesh(
        new THREE.BoxGeometry(len + 0.04, 0.08, thick + 0.04),
        extSteelMat
      );
      capMesh.position.set(cx, wallExtHeight + 0.04, cz);
      capMesh.rotation.y = -angle;
      buildingGroup.add(capMesh);
    }

    // 3. Render user's exterior volume envelope (translucent architectural roof & facade mullions)
    if (blueprint.exteriorModules && blueprint.exteriorModules.length > 0) {
      for (const mod of blueprint.exteriorModules) {
        const roofOverhang = mod.overhang || 0.55;
        const roofSlab = new THREE.Mesh(
          new THREE.BoxGeometry(
            mod.width + roofOverhang * 2,
            0.22,
            mod.depth + roofOverhang * 2
          ),
          new THREE.MeshPhysicalMaterial({
            color: 0xa6c8ff,
            roughness: 0.15,
            metalness: 0.1,
            transmission: isSoftwareGl ? 0 : 0.65,
            transparent: true,
            opacity: isSoftwareGl ? 0.45 : 0.78,
            depthWrite: false,
          })
        );
        roofSlab.position.set(mod.x, wallExtHeight + 0.16, mod.z);
        buildingGroup.add(roofSlab);

        const roofFascia = new THREE.Mesh(
          new THREE.BoxGeometry(
            mod.width + roofOverhang * 2 + 0.04,
            0.1,
            mod.depth + roofOverhang * 2 + 0.04
          ),
          extSteelMat
        );
        roofFascia.position.set(mod.x, wallExtHeight + 0.2, mod.z);
        buildingGroup.add(roofFascia);
      }
    }

    scene.add(buildingGroup);

    const trees = [
      [-8.2, 4.8, 1.05],
      [8.4, 4.5, 0.92],
      [-7.8, -5.2, 1.15],
      [8.1, -4.8, 0.88],
    ];
    for (const [tx, tz, sc] of trees) {
      scene.add(buildArchitecturalTree(tx, tz, sc));
    }

    const bollardMat = new THREE.MeshStandardMaterial({
      color: 0xff7a00,
      emissive: new THREE.Color(0xff7a00),
      emissiveIntensity: 0.5,
    });
    const bollardCoords = [
      [-0.8, 6.8],
      [3.2, 6.8],
      [-0.8, 4.2],
      [3.2, 4.2],
    ];
    for (const [bx, bz] of bollardCoords) {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 0.75, 12),
        new THREE.MeshStandardMaterial({ color: 0x040b29, metalness: 0.8, roughness: 0.3 })
      );
      post.position.set(bx, 0.375, bz);
      post.castShadow = true;
      const lampHead = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.14, 12), bollardMat);
      lampHead.position.set(bx, 0.78, bz);
      scene.add(post, lampHead);
    }

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    const targetSkyColor = new THREE.Color(initialSky);
    const targetSunPos = new THREE.Vector3(18, 24, 16);
    const targetSunColor = new THREE.Color(0xfffbeb);

    const clock = new THREE.Clock();
    let frameId = 0;
    const swTimer = { id: 0 };

    const tick = () => {
      const dt = Math.min(clock.getDelta(), 0.1);
      const damp = 1 - Math.exp(-6 * dt);

      const mode = timeOfDayRef.current;
      const isLightTheme = themeRef.current === 'light';
      if (mode === 'day') {
        targetSkyColor.setHex(isLightTheme ? 0xebf3ff : 0x0b1323);
        targetSunPos.set(18, 25, 16);
        targetSunColor.setHex(0xfffbeb);
        sunLight.intensity = THREE.MathUtils.lerp(sunLight.intensity, 2.5, damp);
        hemiLight.intensity = THREE.MathUtils.lerp(hemiLight.intensity, 0.95, damp);
        emissiveWindowsMat.emissiveIntensity = THREE.MathUtils.lerp(
          emissiveWindowsMat.emissiveIntensity,
          0.18,
          damp
        );
        bollardMat.emissiveIntensity = THREE.MathUtils.lerp(bollardMat.emissiveIntensity, 0.25, damp);
      } else if (mode === 'sunset') {
        targetSkyColor.setHex(isLightTheme ? 0xfde68a : 0x1c1423);
        targetSunPos.set(-22, 7.5, 15);
        targetSunColor.setHex(0xff7a00);
        sunLight.intensity = THREE.MathUtils.lerp(sunLight.intensity, 2.1, damp);
        hemiLight.intensity = THREE.MathUtils.lerp(hemiLight.intensity, 0.55, damp);
        emissiveWindowsMat.emissiveIntensity = THREE.MathUtils.lerp(
          emissiveWindowsMat.emissiveIntensity,
          1.15,
          damp
        );
        bollardMat.emissiveIntensity = THREE.MathUtils.lerp(bollardMat.emissiveIntensity, 1.4, damp);
      } else {
        targetSkyColor.setHex(0x040b29);
        targetSunPos.set(-12, 18, -14);
        targetSunColor.setHex(0xa6c8ff);
        sunLight.intensity = THREE.MathUtils.lerp(sunLight.intensity, 0.55, damp);
        hemiLight.intensity = THREE.MathUtils.lerp(hemiLight.intensity, 0.28, damp);
        emissiveWindowsMat.emissiveIntensity = THREE.MathUtils.lerp(
          emissiveWindowsMat.emissiveIntensity,
          1.85,
          damp
        );
        bollardMat.emissiveIntensity = THREE.MathUtils.lerp(bollardMat.emissiveIntensity, 2.2, damp);
      }

      (scene.background as THREE.Color).lerp(targetSkyColor, damp);
      if (scene.fog instanceof THREE.FogExp2) {
        scene.fog.color.copy(scene.background as THREE.Color);
      }
      sunLight.position.lerp(targetSunPos, damp);
      sunLight.color.lerp(targetSunColor, damp);

      if (isTransitioningCamera) {
        camera.position.lerp(desiredCamPos, damp);
        controls.target.lerp(desiredTarget, damp);
        if (camera.position.distanceToSquared(desiredCamPos) < 0.02) {
          isTransitioningCamera = false;
        }
      }

      controls.autoRotate = !isSoftwareGl && autoRotateRef.current;
      controls.autoRotateSpeed = 1.1;
      controls.update();

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        scheduleAfterDraw(renderer, tick, swTimer);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };

    tick();

    const onResize = () => {
      if (!mount) return;
      const w = mount.clientWidth || window.innerWidth;
      const h = mount.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(swTimer.id);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      envTex.dispose();
      concreteTex.dispose();
      darkMarbleTex.dispose();
      woodTex.dispose();
      if (uploadedTex) uploadedTex.dispose();
      renderer.dispose();
    };
  }, [blueprint, uploadedImageDataUrl]);

  return (
    <div
      className={`relative w-full h-full overflow-hidden transition-colors ${
        isLight ? 'bg-[#EBF3FF]' : 'bg-[#0b0f19]'
      }`}
    >
      <div ref={canvasMountRef} className="w-full h-full" />

      {/* Top-Left Spec Header */}
      <div className="absolute top-4 left-5 pointer-events-none select-none z-10">
        <div
          className={`border px-3.5 py-2 rounded-lg shadow-md ${
            isLight
              ? 'bg-white/95 border-slate-200 text-[#040B29]'
              : 'bg-[#0b0f19]/90 border-slate-800 text-slate-100'
          }`}
        >
          <p className="text-xs font-mono font-semibold text-[#FF7A00]">
            PASO 3 DE 3 · SUBSISTEMA EXTERIOR 3D (PLANO DEL USUARIO)
          </p>
          <h2 className="text-sm font-semibold mt-0.5">{blueprint.title}</h2>
          <p
            className={`text-xs mt-0.5 font-mono tabular-nums ${
              isLight ? 'text-slate-600' : 'text-slate-400'
            }`}
          >
            {blueprint.walls.length} Volúmenes/Muros · Solera PBR {blueprint.totalWidth}m × {blueprint.totalDepth}m · Iluminación Solar
          </p>
        </div>
      </div>

      {/* Unified Collapsible Bottom Control Dock */}
      <div
        className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-20 w-[min(940px,95vw)] transition-transform duration-200 ${
          showHud ? 'translate-y-0' : 'translate-y-[calc(100%-32px)]'
        }`}
      >
        <div className="flex justify-center mb-1">
          <button
            type="button"
            onClick={() => setShowHud((prev) => !prev)}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium border rounded-t-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              isLight
                ? 'bg-white border-slate-300 text-[#040B29] hover:bg-slate-50'
                : 'bg-[#111827] border-slate-700 text-slate-300 hover:text-white'
            }`}
          >
            {showHud ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            {showHud ? 'Ocultar Controles' : 'Mostrar Controles 3D'}
          </button>
        </div>

        <div
          className={`border rounded-xl px-4 py-3 shadow-2xl flex flex-wrap items-center justify-between gap-4 ${
            isLight
              ? 'bg-white border-slate-300 text-[#040B29]'
              : 'bg-[#111827] border-slate-700/90 text-slate-100'
          }`}
        >
          {/* Solar Lighting Selector */}
          <div
            className={`flex items-center gap-1 p-1 rounded-lg border ${
              isLight ? 'bg-[#F4F7FB] border-slate-200' : 'bg-[#0b0f19] border-slate-800'
            }`}
          >
            <button
              type="button"
              onClick={() => setTimeOfDay('day')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                timeOfDay === 'day'
                  ? 'bg-[#0047BA] text-white'
                  : isLight
                    ? 'text-slate-600 hover:text-[#040B29]'
                    : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sun className="w-3.5 h-3.5" />
              Día Solar
            </button>
            <button
              type="button"
              onClick={() => setTimeOfDay('sunset')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                timeOfDay === 'sunset'
                  ? 'bg-[#FF7A00] text-white'
                  : isLight
                    ? 'text-slate-600 hover:text-[#040B29]'
                    : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sunset className="w-3.5 h-3.5" />
              Atardecer
            </button>
            <button
              type="button"
              onClick={() => setTimeOfDay('night')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                timeOfDay === 'night'
                  ? 'bg-[#040B29] text-white'
                  : isLight
                    ? 'text-slate-600 hover:text-[#040B29]'
                    : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Moon className="w-3.5 h-3.5" />
              Noche & Luces
            </button>
          </div>

          {/* Camera Angle Presets */}
          <div className="flex items-center gap-1.5">
            <Camera className="w-3.5 h-3.5 text-[#0047BA] shrink-0" />
            <div
              className={`flex items-center gap-1 p-1 rounded-lg border ${
                isLight ? 'bg-[#F4F7FB] border-slate-200' : 'bg-[#0b0f19] border-slate-800'
              }`}
            >
              {(
                [
                  { id: 'iso', label: 'Perspectiva' },
                  { id: 'front', label: 'Fachada Principal' },
                  { id: 'aerial', label: 'Planta Cubiertas' },
                ] as const
              ).map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setCameraPresetRef.current?.(v.id)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isLight
                      ? 'text-slate-700 hover:text-[#0047BA] hover:bg-white'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          {/* Turntable Auto-Rotate + Exporters */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAutoRotate((prev) => !prev)}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                autoRotate
                  ? 'bg-[#0047BA] text-white border-[#0047BA]'
                  : isLight
                    ? 'bg-[#F4F7FB] text-slate-700 border-slate-300 hover:bg-slate-200'
                    : 'bg-[#0b0f19] text-slate-300 border-slate-700 hover:text-white'
              }`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Giro 360°
            </button>
            <button
              type="button"
              onClick={() =>
                sceneRef.current && exportSceneToGLB(sceneRef.current, `${blueprint.id}-exterior.glb`)
              }
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-[#0047BA] rounded-lg hover:bg-[#002068] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-[#FF7A00]" />
              .GLB
            </button>
            <button
              type="button"
              onClick={() =>
                sceneRef.current && exportSceneToOBJ(sceneRef.current, `${blueprint.id}-exterior.obj`)
              }
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isLight
                  ? 'bg-white border-slate-300 text-[#040B29] hover:border-[#0047BA]'
                  : 'bg-[#0b0f19] border-slate-700 text-slate-200 hover:border-[#0047BA]'
              }`}
            >
              <Download className="w-3.5 h-3.5" />
              .OBJ
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
