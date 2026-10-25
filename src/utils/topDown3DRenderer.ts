import * as THREE from 'three';
import {
  BlueprintData,
  Controls2DState,
  ThemeMode,
} from '../types/render';
import {
  computeWallAttachmentTransform,
  isSoftwareGl,
} from './threeHelpers';
import { buildProceduralFurnitureGroup } from './proceduralModels';

// Singleton offscreen WebGLRenderer for the 90° Top-Down 3D Architectural Renderer
// to avoid creating multiple WebGL contexts.
let _sharedTopDownRenderer: THREE.WebGLRenderer | null = null;

function getTopDownWebGLRenderer(w: number, h: number): THREE.WebGLRenderer {
  if (!_sharedTopDownRenderer) {
    _sharedTopDownRenderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    _sharedTopDownRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    _sharedTopDownRenderer.toneMappingExposure = 1.12;
    _sharedTopDownRenderer.shadowMap.enabled = true;
    _sharedTopDownRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  _sharedTopDownRenderer.setPixelRatio(1);
  _sharedTopDownRenderer.setSize(w, h, false);
  return _sharedTopDownRenderer;
}

function createHighResParquetTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#cf9760';
  ctx.fillRect(0, 0, 512, 512);

  const rows = 16;
  const cols = 4;
  const rowH = 512 / rows;
  const colW = 512 / cols;

  for (let r = 0; r < rows; r++) {
    const stagger = (r % 3) * (colW / 3);
    for (let c = -1; c <= cols; c++) {
      const x = c * colW + stagger;
      const y = r * rowH;
      const shade = ((r * 7 + c * 13) % 5) * 4 - 8;
      ctx.fillStyle = `rgb(${208 + shade}, ${152 + shade}, ${96 + shade})`;
      ctx.fillRect(x, y, colW - 1, rowH - 1);

      // Subtle wood grain fibers
      ctx.fillStyle = 'rgba(110, 62, 24, 0.10)';
      for (let g = 0; g < 3; g++) {
        ctx.fillRect(x + 4, y + (g + 1) * (rowH / 4), colW - 8, 1.2);
      }

      ctx.strokeStyle = 'rgba(82, 45, 18, 0.38)';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(x, y, colW, rowH);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3.5, 3.5);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createHighResPorcelainTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#f3f5f8';
  ctx.fillRect(0, 0, 512, 512);

  const cells = 8;
  const step = 512 / cells;
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      const x = c * step;
      const y = r * step;
      ctx.fillStyle = (r + c) % 2 === 0 ? '#f8fafc' : '#eff3f8';
      ctx.fillRect(x + 2, y + 2, step - 4, step - 4);

      // Subtle marble vein
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 8, y + step * 0.3);
      ctx.quadraticCurveTo(x + step * 0.5, y + step * 0.55, x + step - 8, y + step * 0.7);
      ctx.stroke();

      // Grout joint
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, step, step);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2.5, 2.5);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createHighResGrassTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, 512, 512);
  grad.addColorStop(0, '#4d7c43');
  grad.addColorStop(0.5, '#588b4c');
  grad.addColorStop(1, '#436e3a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);

  // Subtle organic turf blades
  for (let i = 0; i < 1800; i++) {
    const x = (i * 73) % 512;
    const y = (i * 137) % 512;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(163, 217, 138, 0.22)' : 'rgba(28, 56, 24, 0.20)';
    ctx.fillRect(x, y, 2, 4);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createHighResDeckTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#9b673e';
  ctx.fillRect(0, 0, 512, 512);

  const slats = 24;
  const slatH = 512 / slats;
  for (let i = 0; i < slats; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#a46f44' : '#915f38';
    ctx.fillRect(0, i * slatH, 512, slatH - 2);
    ctx.fillStyle = '#3e2310';
    ctx.fillRect(0, (i + 1) * slatH - 2, 512, 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Builds a lush 3D top-down shrub/tree cluster for the perimeter garden.
 */
function buildTopDownGardenPlant(x: number, z: number, radius = 0.55): THREE.Group {
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  const potMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 });
  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.65, radius * 0.55, 0.35, 20),
    potMat
  );
  pot.position.y = 0.18;
  pot.castShadow = true;
  pot.receiveShadow = true;
  group.add(pot);

  const leafColors = [0x2e6f40, 0x3b8750, 0x4ea063];
  for (let i = 0; i < 7; i++) {
    const ang = (i / 7) * Math.PI * 2;
    const dist = i === 0 ? 0 : radius * 0.36;
    const rSphere = i === 0 ? radius * 0.55 : radius * 0.42;
    const leafMat = new THREE.MeshStandardMaterial({
      color: leafColors[i % leafColors.length],
      roughness: 0.72,
    });
    const bush = new THREE.Mesh(new THREE.SphereGeometry(rSphere, 14, 12), leafMat);
    bush.scale.set(1, 0.65, 1);
    bush.position.set(Math.cos(ang) * dist, 0.48 + (i % 2) * 0.08, Math.sin(ang) * dist);
    bush.castShadow = true;
    bush.receiveShadow = true;
    group.add(bush);
  }

  return group;
}

/**
 * Renders a photorealistic 90° Top-Down 3D Architectural Floor Plan (Planta 3D Cenital Amoblada)
 * using Three.js orthographic projection, 2048px soft shadows, realistic room textures,
 * volumetric 3D furniture, and matte-black mid-height cut walls over the exact geometry from Step 1.
 */
export function renderTopDown3DFloorPlan(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  blueprint: BlueprintData,
  controls: Controls2DState,
  uploadedImage: HTMLImageElement | null,
  theme: ThemeMode
) {
  const isLightSurface =
    (theme === 'light' && !controls.invertColors) ||
    (theme === 'dark' && controls.invertColors);

  // 1. Studio Backdrop & Technical Grid on the 2D Host Canvas
  ctx.save();
  ctx.fillStyle = isLightSurface ? '#e4edf7' : '#060b14';
  ctx.fillRect(0, 0, width, height);

  if (controls.showGrid) {
    const gridSpacing = Math.max(24, Math.round(32 * controls.zoom));
    const majorEvery = 5;
    ctx.lineWidth = 1;
    const offsetX =
      (((width / 2 + controls.panX) % gridSpacing) + gridSpacing) % gridSpacing;
    const offsetY =
      (((height / 2 + controls.panY) % gridSpacing) + gridSpacing) % gridSpacing;

    for (let x = offsetX, idx = 0; x < width; x += gridSpacing, idx++) {
      const isMajor = idx % majorEvery === 0;
      ctx.strokeStyle = isLightSurface
        ? isMajor
          ? 'rgba(0, 71, 186, 0.14)'
          : 'rgba(4, 11, 41, 0.04)'
        : isMajor
          ? 'rgba(166, 200, 255, 0.12)'
          : 'rgba(148, 163, 184, 0.04)';
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = offsetY, idx = 0; y < height; y += gridSpacing, idx++) {
      const isMajor = idx % majorEvery === 0;
      ctx.strokeStyle = isLightSurface
        ? isMajor
          ? 'rgba(0, 71, 186, 0.14)'
          : 'rgba(4, 11, 41, 0.04)'
        : isMajor
          ? 'rgba(166, 200, 255, 0.12)'
          : 'rgba(148, 163, 184, 0.04)';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }

  // 2. Build the 3D Scene for 90° Orthographic Top-Down Rendering
  const renderW = Math.min(1200, Math.max(600, Math.floor(width * 1.15)));
  const renderH = Math.min(1000, Math.max(500, Math.floor(height * 1.15)));
  const glRenderer = getTopDownWebGLRenderer(renderW, renderH);

  const scene = new THREE.Scene();
  scene.background = null;

  const gardenMargin = 1.65;
  const worldW = blueprint.totalWidth + gardenMargin * 2;
  const worldD = blueprint.totalDepth + gardenMargin * 2;

  const aspect = renderW / renderH;
  const planAspect = worldW / worldD;
  let frustumW = worldW * 1.08;
  let frustumH = worldD * 1.08;
  if (aspect > planAspect) {
    frustumW = frustumH * aspect;
  } else {
    frustumH = frustumW / aspect;
  }

  const camera = new THREE.OrthographicCamera(
    -frustumW / 2,
    frustumW / 2,
    frustumH / 2,
    -frustumH / 2,
    0.1,
    60
  );
  // Strictly perpendicular 90° Top-Down camera
  camera.position.set(0, 26, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);

  // Natural Studio Daylight + Soft 90°/Angled Sun Shadows for 3D Depth
  const ambientLight = new THREE.AmbientLight(0xffffff, 1.35);
  scene.add(ambientLight);

  const hemiLight = new THREE.HemisphereLight(0xfffbeb, 0x334155, 0.75);
  hemiLight.position.set(0, 25, 0);
  scene.add(hemiLight);

  const sunLight = new THREE.DirectionalLight(0xfffaf0, 1.95);
  // Slight offset from vertical so walls and furniture cast crisp, realistic soft shadows
  sunLight.position.set(5.5, 22, 6.5);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(isSoftwareGl ? 1024 : 2048, isSoftwareGl ? 1024 : 2048);
  const sd = Math.max(worldW, worldD) * 0.65;
  sunLight.shadow.camera.left = -sd;
  sunLight.shadow.camera.right = sd;
  sunLight.shadow.camera.top = sd;
  sunLight.shadow.camera.bottom = -sd;
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 40;
  sunLight.shadow.bias = -0.0006;
  sunLight.shadow.normalBias = 0.015;
  scene.add(sunLight);

  const parquetTex = createHighResParquetTexture();
  const porcelainTex = createHighResPorcelainTexture();
  const grassTex = createHighResGrassTexture();
  const deckTex = createHighResDeckTexture();

  // 2a. Landscaped Natural Grass Perimeter Base
  const grassGeo = new THREE.BoxGeometry(
    blueprint.totalWidth + 1.8,
    0.12,
    blueprint.totalDepth + 1.8
  );
  const grassMat = new THREE.MeshStandardMaterial({
    map: grassTex,
    roughness: 0.88,
    metalness: 0.02,
  });
  const grassMesh = new THREE.Mesh(grassGeo, grassMat);
  grassMesh.position.set(0, -0.06, 0);
  grassMesh.receiveShadow = true;
  scene.add(grassMesh);

  // White stone architectural curb around grass perimeter
  const curbEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(grassGeo),
    new THREE.LineBasicMaterial({ color: 0xcbd5e1 })
  );
  curbEdges.position.copy(grassMesh.position);
  scene.add(curbEdges);

  // 2b. Main Interior Warm Parquet Floor Slab
  const baseFloorMat = new THREE.MeshStandardMaterial({
    map: parquetTex,
    roughness: 0.42,
    metalness: 0.06,
  });
  const baseFloorMesh = new THREE.Mesh(
    new THREE.BoxGeometry(blueprint.totalWidth, 0.06, blueprint.totalDepth),
    baseFloorMat
  );
  baseFloorMesh.position.set(0, 0.03, 0);
  baseFloorMesh.receiveShadow = true;
  scene.add(baseFloorMesh);

  // 2c. Individual Room Floor Material Zones (Wood Parquet, Porcelain Ceramic, Timber Deck)
  for (const room of blueprint.rooms) {
    const rMat = new THREE.MeshStandardMaterial({
      map:
        room.floorMaterial === 'porcelain'
          ? porcelainTex
          : room.floorMaterial === 'wood'
            ? parquetTex
            : deckTex,
      roughness: room.floorMaterial === 'porcelain' ? 0.25 : 0.44,
      metalness: room.floorMaterial === 'porcelain' ? 0.1 : 0.05,
    });
    const rMesh = new THREE.Mesh(
      new THREE.BoxGeometry(room.width, 0.02, room.depth),
      rMat
    );
    rMesh.position.set(room.x, 0.065, room.z);
    rMesh.receiveShadow = true;
    scene.add(rMesh);
  }

  // 2d. Subtle Blueprint Ink Reference Overlay on the Floor if User Uploaded an Image
  let userImgTex: THREE.CanvasTexture | null = null;
  if (uploadedImage) {
    const imgCanvas = document.createElement('canvas');
    imgCanvas.width = 512;
    imgCanvas.height = 512;
    const iCtx = imgCanvas.getContext('2d')!;
    iCtx.drawImage(uploadedImage, 0, 0, 512, 512);
    userImgTex = new THREE.CanvasTexture(imgCanvas);
    userImgTex.colorSpace = THREE.SRGBColorSpace;

    const overlayPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(blueprint.totalWidth, blueprint.totalDepth),
      new THREE.MeshBasicMaterial({
        map: userImgTex,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
      })
    );
    overlayPlane.rotation.x = -Math.PI / 2;
    overlayPlane.position.set(0, 0.078, 0);
    scene.add(overlayPlane);
  }

  // 2e. 3D Volumetric Furniture inside each Room (Casting Real 3D Soft Shadows)
  for (const item of blueprint.furniture) {
    const fGroup = buildProceduralFurnitureGroup(item);
    const transform = computeWallAttachmentTransform(item, blueprint.walls);
    fGroup.position.set(transform.x, 0.075, transform.z);
    fGroup.rotation.y = transform.rotationY;

    // Add an area rug under sofas/beds for extra commercial real-estate richness
    if (item.category === 'sofa' || item.category === 'bed') {
      const rugMesh = new THREE.Mesh(
        new THREE.BoxGeometry(item.width * 1.25, 0.012, item.depth * 1.25),
        new THREE.MeshStandardMaterial({
          color: item.category === 'sofa' ? 0xe2e8f0 : 0xf1f5f9,
          roughness: 0.9,
        })
      );
      rugMesh.position.set(0, 0.006, 0);
      rugMesh.receiveShadow = true;
      fGroup.add(rugMesh);
    }

    scene.add(fGroup);
  }

  // 2f. 3D Perimeter Garden Plants & Trees (Top-Down)
  const hw = blueprint.totalWidth / 2;
  const hd = blueprint.totalDepth / 2;
  const gardenCorners = [
    [-hw - 0.45, -hd - 0.42, 0.48],
    [hw + 0.45, -hd - 0.42, 0.44],
    [-hw - 0.45, hd + 0.42, 0.52],
    [hw + 0.45, hd + 0.42, 0.46],
    [0, -hd - 0.52, 0.38],
  ];
  for (const [gx, gz, gr] of gardenCorners) {
    scene.add(buildTopDownGardenPlant(gx, gz, gr));
  }

  // 2g. Extruded 3D Walls Cut at Mid-Height (Matte Black / Dark Charcoal Section Cut)
  const wallCutHeight = 1.35;
  const wallBodyMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.55,
    metalness: 0.05,
  });
  const wallCutCapMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a, // Matte black / dark charcoal top cut
    roughness: 0.75,
    metalness: 0.15,
  });
  const wallInnerTrimMat = new THREE.MeshBasicMaterial({
    color: 0x94a3b8,
  });
  const windowGlassMat = new THREE.MeshStandardMaterial({
    color: 0x7dd3fc,
    roughness: 0.15,
    metalness: 0.3,
  });
  const doorWoodMat = new THREE.MeshStandardMaterial({
    color: 0x8c5832,
    roughness: 0.5,
  });

  const thickFactor = Math.max(0.85, controls.lineThickness / 2.0);

  for (const wall of blueprint.walls) {
    const dx = wall.x2 - wall.x1;
    const dz = wall.z2 - wall.z1;
    const len = Math.hypot(dx, dz);
    if (len < 0.06) continue;

    const angle = Math.atan2(dz, dx);
    const cx = (wall.x1 + wall.x2) / 2;
    const cz = (wall.z1 + wall.z2) / 2;
    const thickness = (wall.thickness || 0.18) * thickFactor;

    const wGroup = new THREE.Group();
    wGroup.position.set(cx, 0.075, cz);
    wGroup.rotation.y = -angle;

    // Extruded 3D wall body (casts realistic 3D floor shadow)
    const bodyMesh = new THREE.Mesh(
      new THREE.BoxGeometry(len, wallCutHeight, thickness),
      wallBodyMat
    );
    bodyMesh.position.set(0, wallCutHeight / 2, 0);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    wGroup.add(bodyMesh);

    // Matte-black / dark-charcoal architectural cut cap on top of the wall
    const capMesh = new THREE.Mesh(
      new THREE.BoxGeometry(len + 0.02, 0.06, thickness + 0.02),
      wallCutCapMat
    );
    capMesh.position.set(0, wallCutHeight + 0.03, 0);
    wGroup.add(capMesh);

    // Subtle crisp inner core line on the cut cap
    const coreLine = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(0.02, len - 0.04), 0.065, Math.max(0.02, thickness * 0.25)),
      wallInnerTrimMat
    );
    coreLine.position.set(0, wallCutHeight + 0.032, 0);
    wGroup.add(coreLine);

    // Render top-down window glass & open 3D wooden door leaves
    if (wall.openings && wall.openings.length > 0) {
      for (const op of wall.openings) {
        const opX = (op.offsetRatio - 0.5) * len;
        const opW = Math.min(op.width, len * 0.55);
        if (op.type === 'window') {
          const glassPane = new THREE.Mesh(
            new THREE.BoxGeometry(opW, 0.08, thickness + 0.03),
            windowGlassMat
          );
          glassPane.position.set(opX, wallCutHeight + 0.035, 0);
          wGroup.add(glassPane);
        } else if (op.type === 'door') {
          // Floor fill over doorway gap
          const thresholdMesh = new THREE.Mesh(
            new THREE.BoxGeometry(opW, 0.08, thickness + 0.04),
            baseFloorMat
          );
          thresholdMesh.position.set(opX, wallCutHeight + 0.035, 0);
          wGroup.add(thresholdMesh);

          // 3D Open Door Leaf swung at 75°
          const doorPivot = new THREE.Group();
          doorPivot.position.set(opX - opW / 2, 0, thickness / 2);
          doorPivot.rotation.y = -Math.PI * 0.42;
          const doorLeaf = new THREE.Mesh(
            new THREE.BoxGeometry(opW * 0.92, wallCutHeight * 0.92, 0.045),
            doorWoodMat
          );
          doorLeaf.position.set((opW * 0.92) / 2, (wallCutHeight * 0.92) / 2, 0);
          doorLeaf.castShadow = true;
          doorPivot.add(doorLeaf);
          wGroup.add(doorPivot);
        }
      }
    }

    scene.add(wGroup);
  }

  // Render the 3D scene to the WebGL canvas
  glRenderer.render(scene, camera);

  // 3. Composite the Rendered 3D Floor Plan onto the 2D Presentation Sheet Canvas
  ctx.translate(width / 2 + controls.panX, height / 2 + controls.panY);

  const maxDrawW = width * 0.86 * controls.zoom;
  const maxDrawH = height * 0.82 * controls.zoom;
  const imgAspect = renderW / renderH;
  let drawW = maxDrawW;
  let drawH = drawW / imgAspect;
  if (drawH > maxDrawH) {
    drawH = maxDrawH;
    drawW = drawH * imgAspect;
  }

  const sheetPadX = 24;
  const sheetPadTop = 24;
  const sheetPadBottom = 64;
  const sheetW = drawW + sheetPadX * 2;
  const sheetH = drawH + sheetPadTop + sheetPadBottom;
  const sheetX = -sheetW / 2;
  const sheetY = -drawH / 2 - sheetPadTop;

  // Presentation Paper Board with Studio Drop Shadow
  ctx.save();
  ctx.shadowColor = isLightSurface
    ? 'rgba(4, 11, 41, 0.25)'
    : 'rgba(0, 0, 0, 0.72)';
  ctx.shadowBlur = 38;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 14;
  ctx.fillStyle = isLightSurface ? '#ffffff' : '#0f172a';
  ctx.beginPath();
  ctx.roundRect(sheetX, sheetY, sheetW, sheetH, 10);
  ctx.fill();
  ctx.restore();

  // Outer Frame Border
  ctx.strokeStyle = isLightSurface ? '#cbd5e1' : '#1e293b';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(sheetX, sheetY, sheetW, sheetH, 10);
  ctx.stroke();

  // Draw the Three.js 90° Top-Down 3D Render onto the Sheet
  ctx.save();
  const filters: string[] = [];
  if (controls.grayscale) filters.push('grayscale(100%)');
  if (controls.invertColors) filters.push('invert(100%)');
  if (filters.length > 0) ctx.filter = filters.join(' ');
  ctx.drawImage(glRenderer.domElement, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();

  // Project Room Labels & Area (m²) onto the 3D Render
  const pxPerWorldX = drawW / frustumW;
  const pxPerWorldZ = drawH / frustumH;

  for (const room of blueprint.rooms) {
    const rx = room.x * pxPerWorldX;
    const rz = room.z * pxPerWorldZ;
    const areaM2 = (room.width * room.depth).toFixed(1);

    ctx.save();
    ctx.fillStyle = 'rgba(4, 11, 41, 0.78)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.lineWidth = 1;
    const bw = 112;
    const bh = 26;
    ctx.beginPath();
    ctx.roundRect(rx - bw / 2, rz - bh / 2, bw, bh, 5);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = '700 8.5px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(room.name.toUpperCase(), rx, rz - 2);

    ctx.fillStyle = '#FF7A00';
    ctx.font = '700 8px "JetBrains Mono", monospace';
    ctx.fillText(`${areaM2} m²`, rx, rz + 9);
    ctx.restore();
  }

  // Official Status & Statistics Title Block at Bottom of Sheet
  const tbH = 44;
  const tbY = sheetY + sheetH - tbH - 12;
  const tbX = sheetX + 16;
  const tbW = sheetW - 32;

  ctx.fillStyle = isLightSurface ? '#f8fafc' : '#090e1a';
  ctx.strokeStyle = '#0047BA';
  ctx.lineWidth = 1.5;
  ctx.fillRect(tbX, tbY, tbW, tbH);
  ctx.strokeRect(tbX, tbY, tbW, tbH);

  ctx.fillStyle = '#FF7A00';
  ctx.fillRect(tbX, tbY, 6, tbH);

  ctx.fillStyle = isLightSurface ? '#040B29' : '#f8fafc';
  ctx.font = '700 10.5px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(
    `PLANTA ARQUITECTÓNICA 3D CENITAL (90° TOP-DOWN) — PROCESADO EXITOSAMENTE`,
    tbX + 14,
    tbY + 17
  );

  ctx.fillStyle = isLightSurface ? '#0047BA' : '#A6C8FF';
  ctx.font = '600 9.5px "JetBrains Mono", monospace';
  ctx.fillText(
    `ARCHIVO: ${blueprint.title.toUpperCase()}  |  DIMENSIONES: ${blueprint.totalWidth.toFixed(2)}m × ${blueprint.totalDepth.toFixed(2)}m  |  MUROS DETECTADOS: ${blueprint.walls.length}  |  RECINTOS AMOBLADOS: ${blueprint.rooms.length}`,
    tbX + 14,
    tbY + 33
  );

  // Dispose temporary textures
  parquetTex.dispose();
  porcelainTex.dispose();
  grassTex.dispose();
  deckTex.dispose();
  if (userImgTex) userImgTex.dispose();

  ctx.restore();
}
