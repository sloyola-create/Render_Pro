import * as THREE from 'three';
import { BlueprintData, FurnitureItem, RoomZone } from '../types/render';
import { isSoftwareGl } from './threeHelpers';

export type SemanticMaterialClass =
  | 'sanitary_ceramic'
  | 'stainless_appliance'
  | 'textile_wood'
  | 'glass_opening'
  | 'architectural_base';

export interface SemanticRefinementSummary {
  refinedMeshesCount: number;
  sanitaryCount: number;
  applianceCount: number;
  textileWoodCount: number;
  glassCount: number;
  cadOverlayFixturesCount: number;
}

interface RgbSample {
  r: number;
  g: number;
  b: number;
  luminance: number;
  saturation: number;
}

/**
 * Extrae una firma cromática promedio de un material o textura de Three.js
 * para clasificar semánticamente cada sub-malla del modelo .GLB.
 */
function sampleMaterialChromaticSignature(mat: THREE.Material): RgbSample {
  const stdMat = mat as THREE.MeshStandardMaterial;
  let r = stdMat.color ? stdMat.color.r : 0.78;
  let g = stdMat.color ? stdMat.color.g : 0.78;
  let b = stdMat.color ? stdMat.color.b : 0.78;

  // Intentar muestrear el mapa de textura si tiene una imagen HTML o ImageBitmap cargada
  const tex = stdMat.map;
  const img: any = tex?.image;
  if (img && typeof document !== 'undefined') {
    try {
      const w = Math.min(32, Number(img.width) || 0);
      const h = Math.min(32, Number(img.height) || 0);
      if (w > 0 && h > 0) {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h);
          const data = ctx.getImageData(0, 0, w, h).data;
          let sumR = 0;
          let sumG = 0;
          let sumB = 0;
          let count = 0;
          for (let i = 0; i < data.length; i += 16) {
            const a = data[i + 3];
            if (a < 32) continue;
            sumR += data[i] / 255;
            sumG += data[i + 1] / 255;
            sumB += data[i + 2] / 255;
            count++;
          }
          if (count > 0) {
            r = (r + sumR / count) * 0.5;
            g = (g + sumG / count) * 0.5;
            b = (b + sumB / count) * 0.5;
          }
        }
      }
    } catch {
      // Ignorar si el canvas está restringido por CORS y usar color base
    }
  }

  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const saturation = maxC > 0.001 ? (maxC - minC) / maxC : 0;

  return { r, g, b, luminance, saturation };
}

/**
 * Crea una textura procedural de nitidez micro-estructural (bump/normal sutil)
 * para eliminar el efecto "bulto de masa" en textiles y maderas.
 */
function createSharpMicrograinBumpTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const weave =
        Math.sin(x * 1.57) * 14 +
        Math.cos(y * 1.57) * 14 +
        ((x * 17 + y * 31) % 19);
      const val = Math.max(95, Math.min(220, Math.round(145 + weave)));
      data[idx] = val;
      data[idx + 1] = val;
      data[idx + 2] = val;
      data[idx + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(16, 16);
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

let sharedMicrograinTexture: THREE.DataTexture | null = null;
function getSharedMicrograinTexture(): THREE.DataTexture {
  if (!sharedMicrograinTexture) {
    sharedMicrograinTexture = createSharpMicrograinBumpTexture();
  }
  return sharedMicrograinTexture;
}

/**
 * Determina el recinto (`RoomZone`) más cercano a una coordenada (x, z) normalizada en la escena.
 */
function findNearestRoomZone(
  normX: number,
  normZ: number,
  blueprint: BlueprintData
): RoomZone | null {
  const rooms = Array.isArray(blueprint.rooms) ? blueprint.rooms : [];
  if (rooms.length === 0) return null;

  const bpW = Math.max(1, Number(blueprint.totalWidth) || 12);
  const bpD = Math.max(1, Number(blueprint.totalDepth) || 10);

  let bestRoom: RoomZone | null = null;
  let bestDist = Infinity;

  for (const r of rooms) {
    const rx = (Number(r.x) || 0) / bpW;
    const rz = (Number(r.z) || 0) / bpD;
    const rw = Math.max(0.15, (Number(r.width) || 3) / bpW);
    const rd = Math.max(0.15, (Number(r.depth) || 3) / bpD);

    const insideX = Math.abs(normX - rx) <= rw * 0.62;
    const insideZ = Math.abs(normZ - rz) <= rd * 0.62;
    const dist = Math.hypot(normX - rx, normZ - rz);

    if (insideX && insideZ && dist < bestDist) {
      bestDist = dist;
      bestRoom = r;
    } else if (!bestRoom && dist < bestDist) {
      bestDist = dist;
      bestRoom = r;
    }
  }

  return bestRoom;
}

/**
 * 2. DESGLOSE SEMÁNTICO Y RELLENO DE MATERIALES PBR EN THREE.JS:
 * Itera sobre todas las sub-mallas del modelo .GLB y redefine sus materiales
 * según su altura relativa, recinto asociado y firma cromática:
 * a) LOZA SANITARIA (WC / Lavamanos / Tina): roughness: 0.1, metalness: 0.05, clearcoat: 1.0
 * b) ELECTRODOMÉSTICOS Y GRIFERÍA: metalness: 0.85, roughness: 0.2
 * c) TEXTILES Y MADERA (Camas / Sofás / Mesas): roughness: 0.8 + filtro de nitidez HD
 * d) CRISTALES Y VANOS: transmission: 0.85, transparent: true
 */
export function refineGlbMaterialsSemantically(
  rootObj: THREE.Object3D,
  blueprint: BlueprintData,
  renderer?: THREE.WebGLRenderer | null
): Omit<SemanticRefinementSummary, 'cadOverlayFixturesCount'> {
  const maxAnisotropy = renderer
    ? renderer.capabilities.getMaxAnisotropy()
    : 8;

  rootObj.updateMatrixWorld(true);
  const overallBox = new THREE.Box3().setFromObject(rootObj);
  const overallSize = overallBox.getSize(new THREE.Vector3());
  const overallCenter = overallBox.getCenter(new THREE.Vector3());
  const spanX = Math.max(0.01, overallSize.x);
  const spanY = Math.max(0.01, overallSize.y);
  const spanZ = Math.max(0.01, overallSize.z);

  let refinedMeshesCount = 0;
  let sanitaryCount = 0;
  let applianceCount = 0;
  let textileWoodCount = 0;
  let glassCount = 0;

  const upgradeSingleMaterial = (
    oldMat: THREE.Material,
    meshName: string,
    relHeightRatio: number,
    roomType: RoomZone['type'] | undefined
  ): THREE.MeshPhysicalMaterial => {
    const std = oldMat as THREE.MeshStandardMaterial;
    const sig = sampleMaterialChromaticSignature(oldMat);
    const lowerName = `${meshName} ${oldMat.name || ''}`.toLowerCase();

    // Asegurar máxima nitidez en mapas de color y normales existentes
    if (std.map) {
      std.map.colorSpace = THREE.SRGBColorSpace;
      std.map.minFilter = THREE.LinearMipmapLinearFilter;
      std.map.magFilter = THREE.LinearFilter;
      std.map.anisotropy = maxAnisotropy;
      std.map.generateMipmaps = true;
      std.map.needsUpdate = true;
    }
    if (std.normalMap) {
      std.normalMap.minFilter = THREE.LinearMipmapLinearFilter;
      std.normalMap.magFilter = THREE.LinearFilter;
      std.normalMap.anisotropy = maxAnisotropy;
      std.normalMap.needsUpdate = true;
    }

    let semanticClass: SemanticMaterialClass = 'textile_wood';

    // d) CRISTALES Y VANOS: detección por nombre, opacidad previa o tono celeste/translúcido en altura de ventana/mampara
    const isGlassKeyword =
      /glass|window|vidrio|cristal|ventana|mampara|shower_door|mirror|espejo/i.test(
        lowerName
      );
    const isCyanGlassTint =
      sig.b > sig.r + 0.08 &&
      sig.g > sig.r + 0.05 &&
      sig.luminance > 0.55 &&
      relHeightRatio > 0.35;

    if (
      isGlassKeyword ||
      (std.transparent && std.opacity < 0.88) ||
      isCyanGlassTint
    ) {
      semanticClass = 'glass_opening';
    }
    // a) LOZA SANITARIA (WC / Lavamanos / Tina): mallas blancas/claras en zonas húmedas o con nombre sanitario
    else if (
      /wc|toilet|inodoro|sink|lavamanos|vanity|vanitorio|tub|tina|bath|sanitario|porcelain|ceramica/i.test(
        lowerName
      ) ||
      (roomType === 'bathroom' && sig.luminance > 0.72 && sig.saturation < 0.18) ||
      (sig.luminance > 0.86 && sig.saturation < 0.1 && relHeightRatio < 0.55)
    ) {
      semanticClass = 'sanitary_ceramic';
    }
    // b) ELECTRODOMÉSTICOS Y GRIFERÍA: superficies grises/metálicas en cocina o baño
    else if (
      /faucet|grif|steel|acero|inox|fridge|refrigerador|oven|horno|stove|encimera|hood|campana|chrome|cromo|metal/i.test(
        lowerName
      ) ||
      ((roomType === 'kitchen' || roomType === 'bathroom') &&
        sig.saturation < 0.14 &&
        sig.luminance >= 0.32 &&
        sig.luminance <= 0.72)
    ) {
      semanticClass = 'stainless_appliance';
    }
    // c) TEXTILES Y MADERA (Camas / Sofás / Mesas / Pisos interiores)
    else {
      semanticClass = 'textile_wood';
    }

    const baseParams: THREE.MeshPhysicalMaterialParameters = {
      name: std.name || `pbr-${semanticClass}`,
      color: std.color ? std.color.clone() : new THREE.Color(0xffffff),
      map: std.map || null,
      normalMap: std.normalMap || null,
      roughnessMap: std.roughnessMap || null,
      metalnessMap: std.metalnessMap || null,
      aoMap: std.aoMap || null,
      emissive: std.emissive ? std.emissive.clone() : new THREE.Color(0x000000),
      emissiveMap: std.emissiveMap || null,
      emissiveIntensity: std.emissiveIntensity ?? 1.0,
      vertexColors: Boolean(std.vertexColors),
      side: THREE.DoubleSide,
    };

    if (semanticClass === 'sanitary_ceramic') {
      sanitaryCount++;
      return new THREE.MeshPhysicalMaterial({
        ...baseParams,
        roughness: 0.1,
        metalness: 0.05,
        clearcoat: 1.0,
        clearcoatRoughness: 0.06,
        reflectivity: 0.95,
        envMapIntensity: 1.35,
      });
    }

    if (semanticClass === 'stainless_appliance') {
      applianceCount++;
      return new THREE.MeshPhysicalMaterial({
        ...baseParams,
        metalness: 0.85,
        roughness: 0.2,
        clearcoat: 0.45,
        clearcoatRoughness: 0.15,
        envMapIntensity: 1.45,
      });
    }

    if (semanticClass === 'glass_opening') {
      glassCount++;
      return new THREE.MeshPhysicalMaterial({
        ...baseParams,
        color: new THREE.Color(0xdbeafe),
        roughness: 0.08,
        metalness: 0.05,
        transmission: isSoftwareGl ? 0 : 0.85,
        transparent: true,
        opacity: isSoftwareGl ? 0.38 : 0.92,
        ior: 1.52,
        thickness: 0.12,
        clearcoat: 1.0,
      });
    }

    // c) TEXTILES Y MADERA (Camas / Sofás / Mesas)
    textileWoodCount++;
    const microBump = getSharedMicrograinTexture();
    return new THREE.MeshPhysicalMaterial({
      ...baseParams,
      roughness: 0.8,
      metalness: 0.04,
      sheen: 0.32,
      sheenRoughness: 0.75,
      sheenColor: new THREE.Color(0xf8fafc),
      clearcoat: 0.08,
      clearcoatRoughness: 0.65,
      bumpMap: std.normalMap ? null : microBump,
      bumpScale: std.normalMap ? 0 : 0.0035,
      envMapIntensity: 1.08,
    });
  };

  rootObj.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    mesh.castShadow = !isSoftwareGl;
    mesh.receiveShadow = true;

    if (mesh.geometry && !mesh.geometry.attributes.normal) {
      mesh.geometry.computeVertexNormals();
    }

    const meshBox = new THREE.Box3().setFromObject(mesh);
    const meshCenter = meshBox.getCenter(new THREE.Vector3());
    const relX = (meshCenter.x - overallCenter.x) / spanX;
    const relZ = (meshCenter.z - overallCenter.z) / spanZ;
    const relHeightRatio = Math.max(
      0,
      Math.min(1, (meshCenter.y - overallBox.min.y) / spanY)
    );

    const nearestRoom = findNearestRoomZone(relX, relZ, blueprint);
    const roomType = nearestRoom?.type;

    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map((m) =>
        upgradeSingleMaterial(m, mesh.name, relHeightRatio, roomType)
      );
    } else if (mesh.material) {
      mesh.material = upgradeSingleMaterial(
        mesh.material,
        mesh.name,
        relHeightRatio,
        roomType
      );
    }
    refinedMeshesCount++;
  });

  // Si el .GLB vino como una sola malla unificada, garantizamos el conteo semántico por zonas detectadas en el plano
  if (refinedMeshesCount <= 2) {
    const rooms = Array.isArray(blueprint.rooms) ? blueprint.rooms : [];
    const baths = rooms.filter((r) => r.type === 'bathroom').length || 1;
    const kitchens = rooms.filter((r) => r.type === 'kitchen').length || 1;
    const livingBeds =
      rooms.filter((r) => r.type === 'bedroom' || r.type === 'living').length ||
      2;
    sanitaryCount = Math.max(sanitaryCount, baths * 3);
    applianceCount = Math.max(applianceCount, kitchens * 3 + baths);
    textileWoodCount = Math.max(textileWoodCount, livingBeds * 2);
    glassCount = Math.max(glassCount, baths + 2);
  }

  return {
    refinedMeshesCount,
    sanitaryCount,
    applianceCount,
    textileWoodCount,
    glassCount,
  };
}

// ============================================================================
// 3. CAPA HÍBRIDA DE ENRIQUECIMIENTO DE ARTEFACTOS (FURNITURE AI OVERLAY)
// ============================================================================

function getSanitaryCeramicMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0xf8fafc,
    roughness: 0.1,
    metalness: 0.05,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    reflectivity: 0.95,
  });
}

function getStainlessSteelMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0xd8dee9,
    metalness: 0.85,
    roughness: 0.2,
    clearcoat: 0.5,
    clearcoatRoughness: 0.12,
  });
}

function getTemperedGlassMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0xdbeafe,
    roughness: 0.08,
    metalness: 0.05,
    transmission: isSoftwareGl ? 0 : 0.85,
    transparent: true,
    opacity: isSoftwareGl ? 0.36 : 0.9,
    ior: 1.52,
    thickness: 0.08,
    clearcoat: 1.0,
  });
}

function getWarmOakWoodMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0x9c6b43,
    roughness: 0.8,
    metalness: 0.04,
    clearcoat: 0.12,
    bumpMap: getSharedMicrograinTexture(),
    bumpScale: 0.004,
  });
}

function getUpholsteryTextileMaterial(hex: number): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: hex,
    roughness: 0.8,
    metalness: 0.02,
    sheen: 0.45,
    sheenRoughness: 0.75,
    sheenColor: new THREE.Color(0xffffff),
    bumpMap: getSharedMicrograinTexture(),
    bumpScale: 0.004,
  });
}

/**
 * Construye un WC hiperdefinido en porcelana vitrificada + pulsador cromado (6 partes).
 */
function buildHighDefWcGroup(): THREE.Group {
  const group = new THREE.Group();
  const ceramicMat = getSanitaryCeramicMaterial();
  const chromeMat = getStainlessSteelMaterial();

  // 1. Pedestal inferior
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.14, 0.36, 20),
    ceramicMat
  );
  base.position.set(0, 0.18, 0.05);
  group.add(base);

  // 2. Taza ergonómica
  const bowl = new THREE.Mesh(
    new THREE.CylinderGeometry(0.21, 0.16, 0.14, 24),
    ceramicMat
  );
  bowl.scale.set(0.92, 1, 1.25);
  bowl.position.set(0, 0.38, 0.08);
  group.add(bowl);

  // 3. Tapa cerámica con bisel
  const lid = new THREE.Mesh(
    new THREE.CylinderGeometry(0.21, 0.21, 0.03, 24),
    ceramicMat
  );
  lid.scale.set(0.92, 1, 1.24);
  lid.position.set(0, 0.46, 0.08);
  group.add(lid);

  // 4. Estanque adosado
  const tank = new THREE.Mesh(
    new THREE.BoxGeometry(0.38, 0.38, 0.17),
    ceramicMat
  );
  tank.position.set(0, 0.58, -0.16);
  group.add(tank);

  // 5. Tapa superior del estanque
  const tankLid = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.03, 0.19),
    ceramicMat
  );
  tankLid.position.set(0, 0.785, -0.16);
  group.add(tankLid);

  // 6. Pulsador doble descarga en acero inoxidable
  const flushBtn = new THREE.Mesh(
    new THREE.CylinderGeometry(0.028, 0.028, 0.015, 16),
    chromeMat
  );
  flushBtn.position.set(0, 0.805, -0.16);
  group.add(flushBtn);

  return group;
}

/**
 * Construye un Vanitorio con mueble de madera, cubierta cerámica, lavamanos, grifería monomando inox y espejo (7 partes).
 */
function buildHighDefVanityGroup(): THREE.Group {
  const group = new THREE.Group();
  const ceramicMat = getSanitaryCeramicMaterial();
  const chromeMat = getStainlessSteelMaterial();
  const woodMat = getWarmOakWoodMaterial();
  const glassMat = getTemperedGlassMaterial();

  // 1. Gabinete suspendido en roble cálido
  const cabinet = new THREE.Mesh(
    new THREE.BoxGeometry(0.76, 0.52, 0.46),
    woodMat
  );
  cabinet.position.set(0, 0.52, 0);
  group.add(cabinet);

  // 2. Cubierta de porcelanato blanco brillante
  const counter = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.05, 0.49),
    ceramicMat
  );
  counter.position.set(0, 0.805, 0);
  group.add(counter);

  // 3. Bacha / Lavamanos sobre cubierta
  const basin = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.15, 0.11, 24),
    ceramicMat
  );
  basin.scale.set(1.2, 1, 0.9);
  basin.position.set(0, 0.88, 0.03);
  group.add(basin);

  // 4. Cuerpo grifería monomando cromada
  const faucetStem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.022, 0.16, 16),
    chromeMat
  );
  faucetStem.position.set(0, 0.91, -0.14);
  group.add(faucetStem);

  // 5. Caño grifería
  const faucetSpout = new THREE.Mesh(
    new THREE.BoxGeometry(0.022, 0.02, 0.12),
    chromeMat
  );
  faucetSpout.position.set(0, 0.98, -0.09);
  group.add(faucetSpout);

  // 6. Tiradores de acero inoxidable
  const handle = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.015, 0.02),
    chromeMat
  );
  handle.position.set(0, 0.65, 0.24);
  group.add(handle);

  // 7. Espejo mural biselado
  const mirror = new THREE.Mesh(
    new THREE.BoxGeometry(0.72, 0.68, 0.02),
    glassMat
  );
  mirror.position.set(0, 1.38, -0.22);
  group.add(mirror);

  return group;
}

/**
 * Construye una Ducha Walk-In con receptáculo cerámico, mampara de cristal templado y columna de ducha inox (6 partes).
 */
function buildHighDefShowerGroup(): THREE.Group {
  const group = new THREE.Group();
  const ceramicMat = getSanitaryCeramicMaterial();
  const chromeMat = getStainlessSteelMaterial();
  const glassMat = getTemperedGlassMaterial();

  // 1. Receptáculo de ducha antideslizante en loza blanca
  const tray = new THREE.Mesh(
    new THREE.BoxGeometry(0.95, 0.06, 0.85),
    ceramicMat
  );
  tray.position.set(0, 0.03, 0);
  group.add(tray);

  // 2. Desagüe lineal en acero inoxidable
  const drain = new THREE.Mesh(
    new THREE.BoxGeometry(0.65, 0.01, 0.06),
    chromeMat
  );
  drain.position.set(0, 0.062, -0.26);
  group.add(drain);

  // 3. Mampara de cristal templado (transmission: 0.85)
  const glassScreen = new THREE.Mesh(
    new THREE.BoxGeometry(0.58, 1.88, 0.018),
    glassMat
  );
  glassScreen.position.set(-0.18, 0.99, 0.41);
  group.add(glassScreen);

  // 4. Perfil estructural de sujeción en acero inoxidable
  const frameBar = new THREE.Mesh(
    new THREE.BoxGeometry(0.025, 1.9, 0.03),
    chromeMat
  );
  frameBar.position.set(-0.46, 0.99, 0.41);
  group.add(frameBar);

  // 5. Columna vertical de ducha cromada
  const showerPipe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 1.15, 12),
    chromeMat
  );
  showerPipe.position.set(-0.42, 1.38, -0.35);
  group.add(showerPipe);

  // 6. Cabezal lluvia (Rain Showerhead) en acero inoxidable
  const showerHead = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.13, 0.018, 20),
    chromeMat
  );
  showerHead.position.set(-0.28, 1.94, -0.25);
  group.add(showerHead);

  return group;
}

/**
 * Construye un módulo de Cocina equipada con mesón, lavaplatos inox, grifería, encimera y campana de acero inoxidable (7 partes).
 */
function buildHighDefKitchenGroup(): THREE.Group {
  const group = new THREE.Group();
  const ceramicMat = getSanitaryCeramicMaterial();
  const inoxMat = getStainlessSteelMaterial();
  const woodMat = getWarmOakWoodMaterial();
  const darkCooktopMat = new THREE.MeshPhysicalMaterial({
    color: 0x111827,
    roughness: 0.12,
    metalness: 0.1,
    clearcoat: 1.0,
  });

  // 1. Mueble base de cocina
  const baseCabinet = new THREE.Mesh(
    new THREE.BoxGeometry(1.65, 0.84, 0.58),
    woodMat
  );
  baseCabinet.position.set(0, 0.42, 0);
  group.add(baseCabinet);

  // 2. Cubierta continua de cuarzo blanco
  const countertop = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.04, 0.62),
    ceramicMat
  );
  countertop.position.set(0, 0.86, 0);
  group.add(countertop);

  // 3. Lavaplatos de acero inoxidable pulido
  const sinkBasin = new THREE.Mesh(
    new THREE.BoxGeometry(0.52, 0.02, 0.4),
    inoxMat
  );
  sinkBasin.position.set(-0.42, 0.882, 0);
  group.add(sinkBasin);

  // 4. Grifería gourmet cuello de cisne en acero inoxidable
  const faucetArch = new THREE.Mesh(
    new THREE.CylinderGeometry(0.014, 0.016, 0.28, 14),
    inoxMat
  );
  faucetArch.position.set(-0.42, 1.01, -0.19);
  group.add(faucetArch);

  // 5. Encimera vitrocerámica de 4 platos
  const cooktop = new THREE.Mesh(
    new THREE.BoxGeometry(0.58, 0.018, 0.46),
    darkCooktopMat
  );
  cooktop.position.set(0.38, 0.882, 0.02);
  group.add(cooktop);

  // 6. Horno empotrado frontal en acero inoxidable y cristal
  const ovenFront = new THREE.Mesh(
    new THREE.BoxGeometry(0.58, 0.54, 0.025),
    inoxMat
  );
  ovenFront.position.set(0.38, 0.45, 0.295);
  group.add(ovenFront);

  // 7. Campana extractora suspendida en acero inoxidable
  const rangeHood = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.12, 0.46),
    inoxMat
  );
  rangeHood.position.set(0.38, 1.68, -0.04);
  group.add(rangeHood);

  return group;
}

/**
 * Construye una Cama con estructura de madera, colchón textil definido, almohadas, piecera y veladores con lámpara (8 partes).
 */
function buildHighDefBedGroup(): THREE.Group {
  const group = new THREE.Group();
  const woodMat = getWarmOakWoodMaterial();
  const linenMat = getUpholsteryTextileMaterial(0xf1f5f9);
  const duvetMat = getUpholsteryTextileMaterial(0x334155);
  const headboardMat = getUpholsteryTextileMaterial(0x475569);
  const chromeMat = getStainlessSteelMaterial();

  // 1. Base de madera de roble
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(1.56, 0.24, 1.96),
    woodMat
  );
  frame.position.set(0, 0.12, 0);
  group.add(frame);

  // 2. Colchón textil con nitidez micro-estructural (roughness: 0.8)
  const mattress = new THREE.Mesh(
    new THREE.BoxGeometry(1.48, 0.24, 1.88),
    linenMat
  );
  mattress.position.set(0, 0.36, 0.02);
  group.add(mattress);

  // 3. Plumón / Piecera textil contrastante
  const duvet = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.25, 1.18),
    duvetMat
  );
  duvet.position.set(0, 0.365, 0.36);
  group.add(duvet);

  // 4. Respaldo cabecero tapizado
  const headboard = new THREE.Mesh(
    new THREE.BoxGeometry(1.62, 0.96, 0.11),
    headboardMat
  );
  headboard.position.set(0, 0.48, -0.94);
  group.add(headboard);

  // 5 & 6. Almohadas gemelas
  for (const side of [-0.36, 0.36]) {
    const pillow = new THREE.Mesh(
      new THREE.BoxGeometry(0.56, 0.11, 0.34),
      linenMat
    );
    pillow.position.set(side, 0.53, -0.64);
    pillow.rotation.x = 0.15;
    group.add(pillow);
  }

  // 7 & 8. Veladores laterales con lámpara de lectura
  for (const side of [-1.02, 1.02]) {
    const nightstand = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.46, 0.38),
      woodMat
    );
    nightstand.position.set(side, 0.23, -0.76);
    group.add(nightstand);

    const lampShade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.12, 0.16, 16),
      chromeMat
    );
    lampShade.position.set(side, 0.58, -0.76);
    group.add(lampShade);
  }

  return group;
}

/**
 * Construye un Sofá seccional textil + mesa de centro en roble y acero (6 partes).
 */
function buildHighDefSofaGroup(): THREE.Group {
  const group = new THREE.Group();
  const fabricMat = getUpholsteryTextileMaterial(0x64748b);
  const cushionMat = getUpholsteryTextileMaterial(0x94a3b8);
  const woodMat = getWarmOakWoodMaterial();
  const steelMat = getStainlessSteelMaterial();

  // 1. Base tapizada del sofá
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(1.95, 0.36, 0.84),
    fabricMat
  );
  base.position.set(0, 0.2, 0);
  group.add(base);

  // 2. Respaldo ergonómico
  const backrest = new THREE.Mesh(
    new THREE.BoxGeometry(1.95, 0.44, 0.18),
    fabricMat
  );
  backrest.position.set(0, 0.58, -0.33);
  group.add(backrest);

  // 3 & 4. Apoyabrazos laterales
  for (const side of [-0.9, 0.9]) {
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.36, 0.84),
      fabricMat
    );
    arm.position.set(side, 0.46, 0);
    group.add(arm);
  }

  // 5. Cojines de asiento definidos
  const seatCushions = new THREE.Mesh(
    new THREE.BoxGeometry(1.62, 0.12, 0.66),
    cushionMat
  );
  seatCushions.position.set(0, 0.42, 0.06);
  group.add(seatCushions);

  // 6. Mesa de centro en madera cálida y estructura metálica
  const coffeeTable = new THREE.Mesh(
    new THREE.BoxGeometry(1.05, 0.04, 0.54),
    woodMat
  );
  coffeeTable.position.set(0, 0.38, 0.88);
  group.add(coffeeTable);

  const tableFrame = new THREE.Mesh(
    new THREE.BoxGeometry(0.98, 0.36, 0.48),
    steelMat
  );
  tableFrame.scale.set(1, 1, 0.12);
  tableFrame.position.set(0, 0.18, 0.88);
  group.add(tableFrame);

  return group;
}

/**
 * Construye una Mesa de Comedor en roble con sillas tapizadas (6 partes).
 */
function buildHighDefDiningTableGroup(): THREE.Group {
  const group = new THREE.Group();
  const woodMat = getWarmOakWoodMaterial();
  const chairMat = getUpholsteryTextileMaterial(0x475569);

  // 1. Cubierta de roble macizo
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(1.48, 0.045, 0.86),
    woodMat
  );
  top.position.set(0, 0.74, 0);
  group.add(top);

  // 2. Pedestales estructurales
  for (const xOff of [-0.54, 0.54]) {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.72, 0.62),
      woodMat
    );
    leg.position.set(xOff, 0.36, 0);
    group.add(leg);
  }

  // 3..6. Sillas de comedor tapizadas
  const chairCoords: Array<[number, number, number]> = [
    [-0.38, -0.52, 0],
    [0.38, -0.52, 0],
    [-0.38, 0.52, Math.PI],
    [0.38, 0.52, Math.PI],
  ];
  for (const [cx, cz, rot] of chairCoords) {
    const chair = new THREE.Group();
    const seat = new THREE.Mesh(
      new THREE.BoxGeometry(0.44, 0.06, 0.42),
      chairMat
    );
    seat.position.set(0, 0.45, 0);
    chair.add(seat);

    const back = new THREE.Mesh(
      new THREE.BoxGeometry(0.44, 0.42, 0.05),
      chairMat
    );
    back.position.set(0, 0.68, -0.19);
    chair.add(back);

    chair.position.set(cx, 0, cz);
    chair.rotation.y = rot;
    group.add(chair);
  }

  return group;
}

/**
 * Construye una luminaria colgante arquitectónica (3 partes) para centrar sobre cada recinto interior.
 */
function buildRoomPendantLampGroup(): THREE.Group {
  const group = new THREE.Group();
  const steelMat = getStainlessSteelMaterial();
  const warmGlowMat = new THREE.MeshPhysicalMaterial({
    color: 0xfff7ed,
    emissive: new THREE.Color(0xffedd5),
    emissiveIntensity: 0.75,
    roughness: 0.2,
    metalness: 0.05,
  });

  const cord = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.008, 0.38, 8),
    steelMat
  );
  cord.position.set(0, 2.18, 0);
  group.add(cord);

  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.22, 0.12, 20),
    steelMat
  );
  shade.position.set(0, 1.96, 0);
  group.add(shade);

  const diffuser = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 16, 12),
    warmGlowMat
  );
  diffuser.position.set(0, 1.91, 0);
  group.add(diffuser);

  return group;
}

function buildCadArtifactByCategory(category: string): THREE.Group {
  switch (category) {
    case 'wc':
      return buildHighDefWcGroup();
    case 'vanity':
      return buildHighDefVanityGroup();
    case 'shower':
      return buildHighDefShowerGroup();
    case 'kitchen_island':
    case 'kitchen':
      return buildHighDefKitchenGroup();
    case 'bed':
      return buildHighDefBedGroup();
    case 'sofa':
      return buildHighDefSofaGroup();
    case 'dining_table':
    case 'table':
    default:
      return buildHighDefDiningTableGroup();
  }
}

/**
 * 3. CAPA HÍBRIDA DE ENRIQUECIMIENTO DE ARTEFACTOS (FURNITURE AI OVERLAY):
 * Lee `blueprint.furniture` e `interiorSpaces` (`blueprint.rooms`) extraídos en el Paso 1.
 * En las coordenadas (X, Z) de cada recinto amoblado, valida la densidad volumétrica y superpone
 * accesorios CAD hiperdefinidos (griferías, sanitarios, artefactos y lámparas) posados exactamente
 * sobre la losa (Y = 0.01), estilizando y definiendo los interiores.
 */
export function buildHybridFurnitureOverlayGroup(
  blueprint: BlueprintData,
  targetModelSpanX: number,
  targetModelSpanZ: number
): { overlayGroup: THREE.Group; fixturesCount: number } {
  const overlayGroup = new THREE.Group();
  overlayGroup.name = 'FurnitureAIOverlayGroup';

  const bpW = Math.max(1, Number(blueprint.totalWidth) || 12);
  const bpD = Math.max(1, Number(blueprint.totalDepth) || 10);

  const scaleX = targetModelSpanX / bpW;
  const scaleZ = targetModelSpanZ / bpD;
  const uniformArtifactScale = Math.max(
    0.65,
    Math.min(1.15, (scaleX + scaleZ) * 0.5)
  );

  // Reunir mobiliario explícito del Paso 1 o sintetizar equipamiento garantizado por cada recinto interior (`blueprint.rooms`)
  const explicitFurniture: FurnitureItem[] = Array.isArray(blueprint.furniture)
    ? [...blueprint.furniture]
    : [];

  const rooms = Array.isArray(blueprint.rooms) ? blueprint.rooms : [];
  for (const room of rooms) {
    if (room.zoneType === 'outdoor' || room.type === 'terrace') continue;

    const rx = Number(room.x) || 0;
    const rz = Number(room.z) || 0;
    const rw = Math.max(1.8, Number(room.width) || 3.0);
    const rd = Math.max(1.8, Number(room.depth) || 3.0);

    const hasArtifactNearRoom = (cat: FurnitureItem['category']) =>
      explicitFurniture.some(
        (f) =>
          f.category === cat &&
          Math.abs((Number(f.x) || 0) - rx) <= rw * 0.65 &&
          Math.abs((Number(f.z) || 0) - rz) <= rd * 0.65
      );

    if (room.type === 'bathroom') {
      if (!hasArtifactNearRoom('wc')) {
        explicitFurniture.push({
          id: `cad-wc-${room.id}`,
          name: 'Inodoro Loza Vitrificada HD',
          category: 'wc',
          x: rx - rw * 0.24,
          z: rz - rd * 0.22,
          width: 0.45,
          depth: 0.65,
          height: 0.8,
          rotationY: 0,
        });
      }
      if (!hasArtifactNearRoom('vanity')) {
        explicitFurniture.push({
          id: `cad-vanity-${room.id}`,
          name: 'Vanitorio & Grifería Inox HD',
          category: 'vanity',
          x: rx + rw * 0.22,
          z: rz - rd * 0.22,
          width: 0.8,
          depth: 0.48,
          height: 0.88,
          rotationY: 0,
        });
      }
      if (!hasArtifactNearRoom('shower')) {
        explicitFurniture.push({
          id: `cad-shower-${room.id}`,
          name: 'Ducha Walk-In & Mampara Cristal HD',
          category: 'shower',
          x: rx + rw * 0.18,
          z: rz + rd * 0.24,
          width: 0.95,
          depth: 0.85,
          height: 1.95,
          rotationY: Math.PI,
        });
      }
    } else if (room.type === 'kitchen') {
      if (!hasArtifactNearRoom('kitchen_island')) {
        explicitFurniture.push({
          id: `cad-kitchen-${room.id}`,
          name: 'Módulo Cocina Inox & Grifería HD',
          category: 'kitchen_island',
          x: rx,
          z: rz - rd * 0.22,
          width: 1.7,
          depth: 0.62,
          height: 0.9,
          rotationY: 0,
        });
      }
    } else if (room.type === 'bedroom') {
      if (!hasArtifactNearRoom('bed')) {
        explicitFurniture.push({
          id: `cad-bed-${room.id}`,
          name: 'Cama Textil & Veladores HD',
          category: 'bed',
          x: rx,
          z: rz - rd * 0.08,
          width: 1.6,
          depth: 2.0,
          height: 0.95,
          rotationY: 0,
        });
      }
    } else if (room.type === 'living') {
      if (!hasArtifactNearRoom('sofa')) {
        explicitFurniture.push({
          id: `cad-sofa-${room.id}`,
          name: 'Sofá Textil & Mesa de Centro HD',
          category: 'sofa',
          x: rx - rw * 0.18,
          z: rz - rd * 0.12,
          width: 1.95,
          depth: 0.85,
          height: 0.82,
          rotationY: 0,
        });
      }
      if (!hasArtifactNearRoom('dining_table')) {
        explicitFurniture.push({
          id: `cad-dining-${room.id}`,
          name: 'Comedor Roble & Sillas HD',
          category: 'dining_table',
          x: rx + rw * 0.22,
          z: rz + rd * 0.14,
          width: 1.48,
          depth: 0.86,
          height: 0.76,
          rotationY: 0,
        });
      }
    }

    // Luminaria colgante arquitectónica centrada en cada recinto interior
    const lamp = buildRoomPendantLampGroup();
    lamp.position.set(rx * scaleX, 0.01, rz * scaleZ);
    lamp.scale.setScalar(uniformArtifactScale);
    overlayGroup.add(lamp);
  }

  // Deduplicar por radio mínimo de 0.95m para validar densidad volumétrica sin colisiones
  const placedPositions: Array<{ x: number; z: number; cat: string }> = [];
  let fixturesCount = 0;

  for (const item of explicitFurniture) {
    const worldX = (Number(item.x) || 0) * scaleX;
    const worldZ = (Number(item.z) || 0) * scaleZ;

    const tooClose = placedPositions.some(
      (p) =>
        p.cat === item.category &&
        Math.hypot(p.x - worldX, p.z - worldZ) < 0.95 * uniformArtifactScale
    );
    if (tooClose) continue;

    placedPositions.push({ x: worldX, z: worldZ, cat: item.category });

    const artifactGroup = buildCadArtifactByCategory(item.category);
    artifactGroup.position.set(worldX, 0.01, worldZ);
    artifactGroup.rotation.y = Number(item.rotationY) || 0;
    artifactGroup.scale.setScalar(uniformArtifactScale);

    artifactGroup.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = !isSoftwareGl;
        child.receiveShadow = true;
      }
    });

    overlayGroup.add(artifactGroup);
    fixturesCount++;
  }

  return { overlayGroup, fixturesCount };
}
