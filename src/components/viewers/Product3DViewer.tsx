import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { BlueprintData, ThemeMode } from '../../types/render';
import {
  applyStudioEnvironment,
  createContactShadowMesh,
  createStudioRenderer,
  exportSceneToGLB,
  exportSceneToOBJ,
  isSoftwareGl,
  scheduleAfterDraw,
} from '../../utils/threeHelpers';
import {
  ChevronDown,
  ChevronUp,
  Download,
  Maximize2,
  RotateCcw,
  Ruler,
  Sliders,
} from 'lucide-react';

interface Product3DViewerProps {
  blueprint: BlueprintData;
  theme: ThemeMode;
  uploadedImageDataUrl?: string | null;
}

type MetalFinish = 'black_steel' | 'galvanized_zinc' | 'brushed_aluminum' | 'corten_steel';

/**
 * Generates a high-resolution procedural Polar Coordinate Engineering Grid texture
 * adapted for high legibility on both Dark and Light themes.
 */
function createPolarGridTexture(
  renderer: THREE.WebGLRenderer,
  theme: ThemeMode
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;
  const cx = 512;
  const cy = 512;

  const isLight = theme === 'light';
  ctx.fillStyle = isLight ? '#ffffff' : '#0b111e';
  ctx.fillRect(0, 0, 1024, 1024);

  const rings = [90, 175, 260, 345, 430, 490];
  for (let i = 0; i < rings.length; i++) {
    ctx.strokeStyle = isLight
      ? i % 2 === 0
        ? 'rgba(0, 71, 186, 0.42)'
        : 'rgba(4, 11, 41, 0.16)'
      : i % 2 === 0
        ? 'rgba(166, 200, 255, 0.38)'
        : 'rgba(148, 163, 184, 0.18)';
    ctx.lineWidth = i === rings.length - 1 ? 3 : 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, rings[i], 0, Math.PI * 2);
    ctx.stroke();
  }

  for (let deg = 0; deg < 360; deg += 15) {
    const rad = (deg * Math.PI) / 180;
    const isMajor = deg % 45 === 0;
    ctx.strokeStyle = isLight
      ? isMajor
        ? 'rgba(0, 71, 186, 0.35)'
        : 'rgba(4, 11, 41, 0.12)'
      : isMajor
        ? 'rgba(166, 200, 255, 0.35)'
        : 'rgba(148, 163, 184, 0.12)';
    ctx.lineWidth = isMajor ? 1.8 : 1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(rad) * 45, cy + Math.sin(rad) * 45);
    ctx.lineTo(cx + Math.cos(rad) * 490, cy + Math.sin(rad) * 490);
    ctx.stroke();

    if (deg % 30 === 0) {
      ctx.save();
      ctx.fillStyle = isLight ? '#0047BA' : '#FF7A00';
      ctx.font = '700 18px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${deg}°`, cx + Math.cos(rad) * 460, cy + Math.sin(rad) * 460);
      ctx.restore();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

/**
 * Creates a high-contrast floating 3D technical dimension callout badge
 * legible against both Dark and Light backgrounds.
 */
function createDimensionSprite(label: string, value: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = 'rgba(4, 11, 41, 0.94)';
  ctx.strokeStyle = '#FF7A00';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(8, 12, 496, 104, 14);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#A6C8FF';
  ctx.font = '600 22px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label.toUpperCase(), 256, 48);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 32px "JetBrains Mono", monospace';
  ctx.fillText(value, 256, 92);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.45, 0.36, 1);
  sprite.renderOrder = 20;
  return sprite;
}

export const Product3DViewer: React.FC<Product3DViewerProps> = ({
  blueprint,
  theme,
  uploadedImageDataUrl,
}) => {
  const canvasMountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);

  const [explodedAmount, setExplodedAmount] = useState<number>(0);
  const [finish, setFinish] = useState<MetalFinish>(blueprint.metalFinish || 'black_steel');
  const [showDimensions, setShowDimensions] = useState<boolean>(true);
  const [autoRotate, setAutoRotate] = useState<boolean>(true);
  const [showHud, setShowHud] = useState<boolean>(true);

  const explodedTargetRef = useRef<number>(0);
  const showDimsRef = useRef<boolean>(true);
  const autoRotateRef = useRef<boolean>(true);
  const applyFinishRef = useRef<((f: MetalFinish) => void) | null>(null);

  const isLight = theme === 'light';

  useEffect(() => {
    explodedTargetRef.current = explodedAmount;
  }, [explodedAmount]);

  useEffect(() => {
    showDimsRef.current = showDimensions;
  }, [showDimensions]);

  useEffect(() => {
    autoRotateRef.current = autoRotate;
  }, [autoRotate]);

  useEffect(() => {
    applyFinishRef.current?.(finish);
  }, [finish]);

  useEffect(() => {
    const mount = canvasMountRef.current;
    if (!mount) return;

    const width = mount.clientWidth || window.innerWidth;
    const height = mount.clientHeight || window.innerHeight;

    const renderer = createStudioRenderer(width, height);
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);

    const bgHex = theme === 'light' ? 0xebf3ff : 0x0b0f19;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(bgHex);
    scene.fog = new THREE.FogExp2(bgHex, 0.025);
    sceneRef.current = scene;

    const envTex = applyStudioEnvironment(renderer, scene);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(4.6, 3.3, 5.2);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 + 0.06;
    controls.minDistance = 2.2;
    controls.maxDistance = 16.0;
    controls.target.set(0, 1.55, 0);

    const hemiLight = new THREE.HemisphereLight(0xe0f2fe, 0x0f172a, 0.85);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfffbeb, 2.2);
    keyLight.position.set(6, 9, 6);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(2048, 2048);
    const d = 4.5;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x0047ba, 1.1);
    rimLight.position.set(-6, 5, -5);
    scene.add(rimLight);

    if (!isSoftwareGl) {
      RectAreaLightUniformsLib.init();
      const softbox1 = new THREE.RectAreaLight(0xffffff, 3.5, 3, 2);
      softbox1.position.set(4, 4, 3);
      softbox1.lookAt(0, 1.5, 0);
      scene.add(softbox1);
    }

    const polarTex = createPolarGridTexture(renderer, theme);
    const pedestalGroup = new THREE.Group();

    const turntableTop = new THREE.Mesh(
      new THREE.CylinderGeometry(2.85, 2.85, 0.08, 64),
      new THREE.MeshStandardMaterial({
        map: polarTex,
        roughness: 0.35,
        metalness: 0.2,
      })
    );
    turntableTop.position.y = -0.04;
    turntableTop.receiveShadow = true;
    pedestalGroup.add(turntableTop);

    const turntableBevelRing = new THREE.Mesh(
      new THREE.TorusGeometry(2.87, 0.045, 16, 64),
      new THREE.MeshPhysicalMaterial({
        color: 0x0047ba,
        roughness: 0.2,
        metalness: 0.85,
        clearcoat: 0.8,
      })
    );
    turntableBevelRing.rotation.x = Math.PI / 2;
    turntableBevelRing.position.y = -0.02;
    pedestalGroup.add(turntableBevelRing);

    const turntableBase = new THREE.Mesh(
      new THREE.CylinderGeometry(2.95, 3.15, 0.28, 64),
      new THREE.MeshStandardMaterial({
        color: 0x040b29,
        roughness: 0.45,
        metalness: 0.75,
      })
    );
    turntableBase.position.y = -0.22;
    pedestalGroup.add(turntableBase);

    pedestalGroup.add(createContactShadowMesh(3.4, 3.4, 0.48));
    scene.add(pedestalGroup);

    const primaryMetalMat = new THREE.MeshPhysicalMaterial({
      color: 0x1e293b,
      roughness: 0.28,
      metalness: 0.88,
      clearcoat: 0.35,
      clearcoatRoughness: 0.25,
    });

    const secondaryGalvMat = new THREE.MeshPhysicalMaterial({
      color: 0xcbd5e1,
      roughness: 0.22,
      metalness: 0.92,
      anisotropy: 0.6,
    });

    const accentSafetyMat = new THREE.MeshStandardMaterial({
      color: 0xff7a00,
      roughness: 0.32,
      metalness: 0.65,
    });

    applyFinishRef.current = (f: MetalFinish) => {
      if (f === 'black_steel') {
        primaryMetalMat.color.setHex(0x040b29);
        primaryMetalMat.roughness = 0.28;
        primaryMetalMat.metalness = 0.86;
      } else if (f === 'galvanized_zinc') {
        primaryMetalMat.color.setHex(0xcbd5e1);
        primaryMetalMat.roughness = 0.22;
        primaryMetalMat.metalness = 0.94;
      } else if (f === 'brushed_aluminum') {
        primaryMetalMat.color.setHex(0xe2e8f0);
        primaryMetalMat.roughness = 0.16;
        primaryMetalMat.metalness = 0.96;
      } else {
        primaryMetalMat.color.setHex(0x8c3f23);
        primaryMetalMat.roughness = 0.58;
        primaryMetalMat.metalness = 0.55;
      }
      primaryMetalMat.needsUpdate = true;
    };
    applyFinishRef.current(finish);

    const explodableParts: Array<{
      group: THREE.Group;
      basePos: THREE.Vector3;
      offsetDir: THREE.Vector3;
    }> = [];

    const maxPlanDim = Math.max(blueprint.totalWidth, blueprint.totalDepth, 4);
    const pedScale = 3.8 / maxPlanDim;

    // 1. Base Anchor Plates & Reference Decal Group (Explodes downward)
    const basePlatesGroup = new THREE.Group();
    if (uploadedImageDataUrl) {
      const img = new Image();
      img.src = uploadedImageDataUrl;
      const planTex = new THREE.Texture(img);
      planTex.colorSpace = THREE.SRGBColorSpace;
      img.onload = () => {
        planTex.needsUpdate = true;
      };
      const decalMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(
          blueprint.totalWidth * pedScale,
          blueprint.totalDepth * pedScale
        ),
        new THREE.MeshStandardMaterial({
          map: planTex,
          roughness: 0.4,
          metalness: 0.1,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        })
      );
      decalMesh.rotation.x = -Math.PI / 2;
      decalMesh.position.y = 0.008;
      basePlatesGroup.add(decalMesh);
    }

    // 2. Build 3D Structural Steel Assemblies directly from the user's blueprint.walls
    const lowerFrameGroup = new THREE.Group();
    const upperTrussGroup = new THREE.Group();
    const nodeConnectorsGroup = new THREE.Group();

    const structHeight = 1.65;

    for (let idx = 0; idx < blueprint.walls.length; idx++) {
      const w = blueprint.walls[idx];
      const x1 = w.x1 * pedScale;
      const z1 = w.z1 * pedScale;
      const x2 = w.x2 * pedScale;
      const z2 = w.z2 * pedScale;
      const dx = x2 - x1;
      const dz = z2 - z1;
      const len = Math.hypot(dx, dz);
      if (len < 0.04) continue;

      const angle = Math.atan2(dz, dx);
      const cx = (x1 + x2) / 2;
      const cz = (z1 + z2) / 2;
      const profileThick = w.isExterior ? 0.075 : 0.055;

      // Base anchor plate at start node
      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.025, 0.18),
        secondaryGalvMat
      );
      plate.position.set(x1, 0.015, z1);
      plate.castShadow = true;
      basePlatesGroup.add(plate);

      // Vertical structural column at start node
      const col = new THREE.Mesh(
        new THREE.BoxGeometry(profileThick, structHeight, profileThick),
        primaryMetalMat
      );
      col.position.set(x1, structHeight / 2, z1);
      col.castShadow = true;
      lowerFrameGroup.add(col);

      // Lower & middle horizontal structural web member along user's vector segment
      const lowerBeam = new THREE.Mesh(
        new THREE.BoxGeometry(len, profileThick * 0.85, profileThick * 0.85),
        primaryMetalMat
      );
      lowerBeam.position.set(cx, 0.22, cz);
      lowerBeam.rotation.y = -angle;
      lowerBeam.castShadow = true;
      lowerFrameGroup.add(lowerBeam);

      const midBeam = new THREE.Mesh(
        new THREE.BoxGeometry(len, profileThick * 0.7, profileThick * 0.7),
        secondaryGalvMat
      );
      midBeam.position.set(cx, structHeight * 0.55, cz);
      midBeam.rotation.y = -angle;
      midBeam.castShadow = true;
      lowerFrameGroup.add(midBeam);

      // Upper structural chord (Explodes upward)
      const topBeam = new THREE.Mesh(
        new THREE.BoxGeometry(len + 0.04, profileThick, profileThick),
        primaryMetalMat
      );
      topBeam.position.set(cx, structHeight + 0.04, cz);
      topBeam.rotation.y = -angle;
      topBeam.castShadow = true;
      upperTrussGroup.add(topBeam);

      // Node safety clamp/gusset cap (Explodes radially outward)
      const nodeCap = new THREE.Mesh(
        new THREE.BoxGeometry(profileThick * 1.45, 0.055, profileThick * 1.45),
        accentSafetyMat
      );
      nodeCap.position.set(x1, structHeight + 0.08, z1);
      nodeConnectorsGroup.add(nodeCap);

      // Individual radial explosion for major exterior segments
      if (idx < 12) {
        const segGroup = new THREE.Group();
        const webPanel = new THREE.Mesh(
          new THREE.BoxGeometry(len * 0.92, structHeight * 0.75, 0.018),
          secondaryGalvMat
        );
        webPanel.position.set(cx, structHeight * 0.52, cz);
        webPanel.rotation.y = -angle;
        segGroup.add(webPanel);
        scene.add(segGroup);

        const radialDir = new THREE.Vector3(cx, 0.15, cz);
        if (radialDir.lengthSq() < 0.01) radialDir.set(0, 0.5, 0);
        else radialDir.normalize().multiplyScalar(0.65);

        explodableParts.push({
          group: segGroup,
          basePos: new THREE.Vector3(0, 0, 0),
          offsetDir: radialDir,
        });
      }
    }

    scene.add(basePlatesGroup);
    explodableParts.push({
      group: basePlatesGroup,
      basePos: new THREE.Vector3(0, 0, 0),
      offsetDir: new THREE.Vector3(0, -0.45, 0),
    });

    scene.add(lowerFrameGroup);
    explodableParts.push({
      group: lowerFrameGroup,
      basePos: new THREE.Vector3(0, 0, 0),
      offsetDir: new THREE.Vector3(0, 0, 0),
    });

    scene.add(upperTrussGroup);
    explodableParts.push({
      group: upperTrussGroup,
      basePos: new THREE.Vector3(0, 0, 0),
      offsetDir: new THREE.Vector3(0, 0.75, 0),
    });

    scene.add(nodeConnectorsGroup);
    explodableParts.push({
      group: nodeConnectorsGroup,
      basePos: new THREE.Vector3(0, 0, 0),
      offsetDir: new THREE.Vector3(0, 1.1, 0),
    });

    // Floating Technical Dimension Callouts (Cotas Flotantes ISO) from user's real bounds
    const dimsGroup = new THREE.Group();
    const dimLineMat = new THREE.LineBasicMaterial({
      color: theme === 'light' ? 0x0047ba : 0xff7a00,
    });

    const halfW = (blueprint.totalWidth * pedScale) / 2;
    const halfD = (blueprint.totalDepth * pedScale) / 2;
    const dynamicDims = [
      {
        label: 'Ancho',
        value: `${blueprint.totalWidth.toFixed(2)} m`,
        start: new THREE.Vector3(-halfW, 0.08, halfD + 0.35),
        end: new THREE.Vector3(halfW, 0.08, halfD + 0.35),
      },
      {
        label: 'Fondo',
        value: `${blueprint.totalDepth.toFixed(2)} m`,
        start: new THREE.Vector3(halfW + 0.35, 0.08, -halfD),
        end: new THREE.Vector3(halfW + 0.35, 0.08, halfD),
      },
      {
        label: 'Altura',
        value: '2.60 m',
        start: new THREE.Vector3(-halfW - 0.3, 0, -halfD),
        end: new THREE.Vector3(-halfW - 0.3, structHeight, -halfD),
      },
    ];

    for (const dim of dynamicDims) {
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        dim.start,
        dim.end,
      ]);
      const line = new THREE.Line(lineGeo, dimLineMat);
      dimsGroup.add(line);

      const mid = dim.start.clone().add(dim.end).multiplyScalar(0.5);
      const sprite = createDimensionSprite(dim.label, dim.value);
      sprite.position.copy(mid).add(new THREE.Vector3(0, 0.18, 0));
      dimsGroup.add(sprite);
    }
    scene.add(dimsGroup);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    let currentExploded = 0;
    const clock = new THREE.Clock();
    let frameId = 0;
    const swTimer = { id: 0 };

    const tick = () => {
      const dt = Math.min(clock.getDelta(), 0.1);
      currentExploded = THREE.MathUtils.damp(currentExploded, explodedTargetRef.current, 7, dt);

      for (const part of explodableParts) {
        part.group.position
          .copy(part.basePos)
          .addScaledVector(part.offsetDir, currentExploded);
      }

      dimsGroup.visible = showDimsRef.current;
      controls.autoRotate = !isSoftwareGl && autoRotateRef.current;
      controls.autoRotateSpeed = 1.25;
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
      polarTex.dispose();
      renderer.dispose();
    };
  }, [blueprint, theme, uploadedImageDataUrl]);

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
            PASO 3 DE 3 · SUBSISTEMA INGENIERÍA 360° (PLANO DEL USUARIO)
          </p>
          <h2 className="text-sm font-semibold mt-0.5">{blueprint.title}</h2>
          <p
            className={`text-xs mt-0.5 font-mono tabular-nums ${
              isLight ? 'text-slate-600' : 'text-slate-400'
            }`}
          >
            Cuadrícula Polar ISO · {blueprint.walls.length} Perfiles Estructurales · Cotas Activas
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
          {/* Exploded View Slider */}
          <div className="flex items-center gap-2.5">
            <Maximize2 className="w-3.5 h-3.5 text-[#FF7A00] shrink-0" />
            <span className="text-xs whitespace-nowrap font-medium">Vista Explosionada:</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={explodedAmount}
              onChange={(e) => setExplodedAmount(parseFloat(e.target.value))}
              className="w-24 accent-[#0047BA] cursor-pointer"
            />
            <span className="text-xs font-mono text-[#FF7A00] font-semibold tabular-nums w-10">
              {Math.round(explodedAmount * 100)}%
            </span>
          </div>

          {/* Metallurgical Surface Finish */}
          <div className="flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-[#0047BA] shrink-0" />
            <div
              className={`flex items-center gap-1 p-1 rounded-lg border ${
                isLight ? 'bg-[#F4F7FB] border-slate-200' : 'bg-[#0b0f19] border-slate-800'
              }`}
            >
              {(
                [
                  { id: 'black_steel', label: 'Acero Negro' },
                  { id: 'galvanized_zinc', label: 'Galvanizado' },
                  { id: 'brushed_aluminum', label: 'Inox / Alum' },
                  { id: 'corten_steel', label: 'Corten' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setFinish(m.id)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    finish === m.id
                      ? 'bg-[#0047BA] text-white'
                      : isLight
                        ? 'text-slate-600 hover:text-[#040B29]'
                        : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Floating Dimensions Toggle + Turntable + Exporters */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowDimensions((prev) => !prev)}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                showDimensions
                  ? 'bg-[#0047BA] text-white border-[#0047BA]'
                  : isLight
                    ? 'bg-[#F4F7FB] text-slate-600 border-slate-300 hover:text-[#040B29]'
                    : 'bg-[#0b0f19] text-slate-400 border-slate-700 hover:text-white'
              }`}
            >
              <Ruler className="w-3.5 h-3.5" />
              Cotas ISO
            </button>
            <button
              type="button"
              onClick={() => setAutoRotate((prev) => !prev)}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                autoRotate
                  ? 'bg-[#0047BA] text-white border-[#0047BA]'
                  : isLight
                    ? 'bg-[#F4F7FB] text-slate-600 border-slate-300 hover:text-[#040B29]'
                    : 'bg-[#0b0f19] text-slate-400 border-slate-700 hover:text-white'
              }`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Giro 360°
            </button>
            <button
              type="button"
              onClick={() =>
                sceneRef.current && exportSceneToGLB(sceneRef.current, `${blueprint.id}-product.glb`)
              }
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-[#0047BA] rounded-lg hover:bg-[#002068] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-[#FF7A00]" />
              .GLB
            </button>
            <button
              type="button"
              onClick={() =>
                sceneRef.current && exportSceneToOBJ(sceneRef.current, `${blueprint.id}-product.obj`)
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
