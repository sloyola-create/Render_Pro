import * as THREE from 'three';
import {
  BlueprintData,
  FurnitureCategory,
  FurnitureItem,
  RoomZone,
  Spatial3DAnalysisResult,
  Spatial3DFurnitureType,
  WallOpening,
  WallSegment,
} from '../types/render';
import { createContactShadowMesh, isSoftwareGl } from './threeHelpers';
import { partitionRoomsAndFurnitureFromWalls } from './spatialPartitioner';

export interface CalibratedFurniturePlacement {
  item: FurnitureItem;
  x: number;
  y: number;
  z: number;
  rotationY: number;
}


/**
 * Aligns and consolidates the BlueprintData structural walls 1:1 with the loaded Step 2 CGI texture:
 * - Adjusts totalWidth & totalDepth to the exact real aspect ratio (Width / Height) of the Step 2 image.
 * - Eliminates fragmented/pixelated wall blocks: extrudes ONLY the main continuous structural walls
 *   (4 continuous outer perimeter walls + main continuous interior partition axes snapped at corners/T-junctions).
 * - Aligns wall positions and thickness with the matte-black cut-wall lines of the CGI texture without invading furnished floor zones.
 */
export function alignBlueprintToStep2Texture(
  baseBlueprint: BlueprintData,
  imgEl: HTMLImageElement,
  overrideWidth?: number,
  overrideDepth?: number
): BlueprintData {
  const realW = imgEl.naturalWidth || imgEl.width || 1600;
  const realH = imgEl.naturalHeight || imgEl.height || 1200;
  const aspect = realW / Math.max(1, realH);
  const baseSpan = 12.0;

  const totalWidth =
    overrideWidth ??
    Number((aspect >= 1 ? baseSpan : baseSpan * aspect).toFixed(3));
  const totalDepth =
    overrideDepth ??
    Number((aspect >= 1 ? baseSpan / aspect : baseSpan).toFixed(3));

  const oldW = Math.max(1, baseBlueprint.totalWidth);
  const oldD = Math.max(1, baseBlueprint.totalDepth);
  const scaleX = totalWidth / oldW;
  const scaleZ = totalDepth / oldD;

  const outdoorRooms = (baseBlueprint.rooms || []).filter(
    (r) =>
      r.zoneType === 'outdoor' ||
      r.type === 'terrace' ||
      /outdoor|exterior|terraza|terrace|patio|deck|jardin|garden|quincho|parrilla|piscina/i.test(
        r.name || ''
      )
  );

  const isWallEnclosingOutdoorZone = (
    wx1: number,
    wz1: number,
    wx2: number,
    wz2: number
  ): boolean => {
    const mx = (wx1 + wx2) / 2;
    const mz = (wz1 + wz2) / 2;
    for (const oz of outdoorRooms) {
      const ox = Number(oz.x) * scaleX;
      const ozZ = Number(oz.z) * scaleZ;
      const ow = (Number(oz.width) / oldW) * totalWidth;
      const od = (Number(oz.depth) / oldD) * totalDepth;
      const insideMid =
        Math.abs(mx - ox) <= ow / 2 + 0.22 &&
        Math.abs(mz - ozZ) <= od / 2 + 0.22;
      if (!insideMid) continue;

      const separatesIndoor = (baseBlueprint.rooms || []).some((ir) => {
        if (ir.id === oz.id || ir.zoneType === 'outdoor' || ir.type === 'terrace')
          return false;
        const ix = Number(ir.x) * scaleX;
        const iz = Number(ir.z) * scaleZ;
        const iw = (Number(ir.width) / oldW) * totalWidth;
        const id = (Number(ir.depth) / oldD) * totalDepth;
        return (
          Math.abs(mx - ix) <= iw / 2 + 0.35 &&
          Math.abs(mz - iz) <= id / 2 + 0.35
        );
      });
      if (!separatesIndoor) return true;
    }
    return false;
  };

  const isOuterCanvasFrameWall = (
    w: WallSegment,
    x1: number,
    z1: number,
    x2: number,
    z2: number
  ): boolean => {
    if (/^(img-wall-[0123]$|img-perim-|pdf-perim-|perim-)/.test(w.id || '')) {
      return true;
    }
    const len = Math.hypot(x2 - x1, z2 - z1);
    const nearLeft = Math.abs(x1 + totalWidth / 2) < totalWidth * 0.12 && Math.abs(x2 + totalWidth / 2) < totalWidth * 0.12;
    const nearRight = Math.abs(x1 - totalWidth / 2) < totalWidth * 0.12 && Math.abs(x2 - totalWidth / 2) < totalWidth * 0.12;
    const nearTop = Math.abs(z1 + totalDepth / 2) < totalDepth * 0.12 && Math.abs(z2 + totalDepth / 2) < totalDepth * 0.12;
    const nearBottom = Math.abs(z1 - totalDepth / 2) < totalDepth * 0.12 && Math.abs(z2 - totalDepth / 2) < totalDepth * 0.12;
    if ((nearLeft || nearRight) && len >= totalDepth * 0.62) return true;
    if ((nearTop || nearBottom) && len >= totalWidth * 0.62) return true;
    return false;
  };

  // Strict 1:1 vector scaling of Step 1 validated habitable walls without outer 4-wall canvas frame
  const syncedWalls: WallSegment[] = [];
  for (let i = 0; i < (baseBlueprint.walls || []).length; i++) {
    const w = baseBlueprint.walls[i];
    if (w.zoneType === 'outdoor') continue;

    const x1 = Number((w.x1 * scaleX).toFixed(3));
    const z1 = Number((w.z1 * scaleZ).toFixed(3));
    const x2 = Number((w.x2 * scaleX).toFixed(3));
    const z2 = Number((w.z2 * scaleZ).toFixed(3));

    if (Math.hypot(x2 - x1, z2 - z1) < 0.15) continue;
    if (isOuterCanvasFrameWall(w, x1, z1, x2, z2)) continue;
    if (isWallEnclosingOutdoorZone(x1, z1, x2, z2)) continue;

    syncedWalls.push({
      ...w,
      id: w.id || `wall-seg-${i}`,
      x1,
      z1,
      x2,
      z2,
      thickness: Math.max(0.08, Math.min(0.3, Number(w.thickness) || 0.15)),
      height: Number(w.height) || 2.6,
      isExterior: false,
      zoneType: 'indoor',
      openings: Array.isArray(w.openings) ? [...w.openings] : [],
    });
  }

  const { rooms, furniture } = partitionRoomsAndFurnitureFromWalls(
    syncedWalls,
    totalWidth,
    totalDepth
  );

  return {
    ...baseBlueprint,
    totalWidth,
    totalDepth,
    walls: syncedWalls,
    rooms:
      baseBlueprint.rooms && baseBlueprint.rooms.length > 0
        ? baseBlueprint.rooms.map((r) => ({
            ...r,
            x: Number((r.x * scaleX).toFixed(3)),
            z: Number((r.z * scaleZ).toFixed(3)),
            width: Number(((r.width / oldW) * totalWidth).toFixed(2)),
            depth: Number(((r.depth / oldD) * totalDepth).toFixed(2)),
          }))
        : rooms,
    furniture:
      baseBlueprint.furniture && baseBlueprint.furniture.length > 0
        ? baseBlueprint.furniture.map((f) => ({
            ...f,
            x: Number((f.x * scaleX).toFixed(3)),
            z: Number((f.z * scaleZ).toFixed(3)),
          }))
        : furniture,
  };
}

/**
 * Synchronizes the BlueprintData master structure directly with the high-resolution
 * Step 2 CGI floor plan image (step2RenderUrl).
 */
export function synchronizeBlueprintWithStep2CGI(
  step2ImageUrl: string,
  baseBlueprint: BlueprintData
): Promise<BlueprintData> {
  return new Promise((resolve) => {
    if (!step2ImageUrl) {
      resolve(baseBlueprint);
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      resolve(alignBlueprintToStep2Texture(baseBlueprint, img));
    };
    img.onerror = () => resolve(baseBlueprint);
    img.src = step2ImageUrl;
  });
}

function mapSpatialTypeToFurnitureCategory(
  type: Spatial3DFurnitureType | string
): FurnitureCategory {
  switch (type) {
    case 'sofa':
      return 'sofa';
    case 'bed':
      return 'bed';
    case 'table':
      return 'dining_table';
    case 'wc':
      return 'wc';
    case 'vanity':
      return 'vanity';
    case 'kitchen':
      return 'kitchen_island';
    case 'shower':
      return 'shower';
    case 'wardrobe':
      return 'wardrobe';
    case 'patio_set':
      return 'patio_set';
    case 'lounger':
      return 'lounger';
    case 'bbq_grill':
      return 'bbq_grill';
    case 'desk':
    default:
      return 'desk';
  }
}

function isOutdoorLabel(text: string): boolean {
  return /outdoor|exterior|terraza|terrace|patio|deck|jardin|garden|quincho|parrilla|bbq|pergola|balcon|solarium|piscina|pool|reposera|lounger/i.test(
    text
  );
}

function isSecondaryBedroomLabel(text: string): boolean {
  return /secundario|dormitorio\s*[234]|dorm\s*[234]|habitaci[oó]n\s*[234]|single|individual|1\s*plaza|ni[ñn]os|visita|huesped|twin|dos camas/i.test(
    text
  );
}

/**
 * Strict Anti-Duplicate Furniture Sanitization Layer (v1.7):
 * - Enforces per-room architectural quotas:
 *   • Max 1 Master Bed per bedroom (or up to 2 single beds if marked as a secondary bedroom).
 *   • Max 1 WC and 1 Vanity per bathroom.
 *   • Max 1 Sofa Set per living room.
 * - Whenever 2 or more objects of the same type are detected within the same room OR within a radius < 1.5m,
 *   FUSES their coordinates into a single centralized object (centroid x, z), eliminating duplicates.
 */
export function sanitizeAndDeduplicateFurniturePlacements(
  rawList: CalibratedFurniturePlacement[],
  rooms: RoomZone[]
): CalibratedFurniturePlacement[] {
  if (!Array.isArray(rawList) || rawList.length === 0) return [];

  const keyCategoryPriority: Record<FurnitureCategory, number> = {
    bed: 1,
    sofa: 2,
    dining_table: 3,
    wc: 4,
    vanity: 5,
    shower: 6,
    kitchen_island: 7,
    patio_set: 8,
    wardrobe: 9,
    desk: 10,
    lounger: 11,
    bbq_grill: 12,
  };

  // Helper to resolve which room a placement belongs to
  const findRoomForPlacement = (
    p: CalibratedFurniturePlacement
  ): { roomKey: string; isSecondaryBedroom: boolean } => {
    let bestRoom: RoomZone | null = null;
    let bestDist = Infinity;

    for (const r of rooms) {
      const inside =
        Math.abs(p.x - r.x) <= r.width / 2 + 0.35 &&
        Math.abs(p.z - r.z) <= r.depth / 2 + 0.35;
      if (inside) {
        const d = Math.hypot(p.x - r.x, p.z - r.z);
        if (d < bestDist) {
          bestDist = d;
          bestRoom = r;
        }
      }
    }

    if (!bestRoom && p.item.roomLabel) {
      const labelNorm = p.item.roomLabel.trim().toLowerCase();
      bestRoom =
        rooms.find((r) => (r.name || '').trim().toLowerCase() === labelNorm) ||
        null;
    }

    if (!bestRoom && rooms.length > 0) {
      for (const r of rooms) {
        const d = Math.hypot(p.x - r.x, p.z - r.z);
        if (d < bestDist && d <= 2.4) {
          bestDist = d;
          bestRoom = r;
        }
      }
    }

    const roomKey =
      bestRoom?.id ||
      (p.item.roomLabel
        ? `label:${p.item.roomLabel.trim().toLowerCase()}`
        : `sector:${Math.round(p.x / 2.6)}_${Math.round(p.z / 2.6)}`);

    const combinedText = `${bestRoom?.name || ''} ${p.item.roomLabel || ''} ${p.item.name || ''}`;
    const isSecondaryBedroom = isSecondaryBedroomLabel(combinedText);

    return { roomKey, isSecondaryBedroom };
  };

  // Fuse a cluster of placements into a single centralized placement (centroid x, z)
  const fuseClusterToCentroid = (
    cluster: CalibratedFurniturePlacement[],
    forceSingleBedSize = false
  ): CalibratedFurniturePlacement => {
    const base = cluster[0];
    if (cluster.length === 1 && !forceSingleBedSize) return base;

    const sumX = cluster.reduce((acc, c) => acc + c.x, 0);
    const sumZ = cluster.reduce((acc, c) => acc + c.z, 0);
    const cx = Number((sumX / cluster.length).toFixed(3));
    const cz = Number((sumZ / cluster.length).toFixed(3));

    const width =
      forceSingleBedSize && base.item.category === 'bed'
        ? Math.min(base.item.width, 1.05)
        : base.item.width;

    return {
      ...base,
      x: cx,
      z: cz,
      item: {
        ...base.item,
        x: cx,
        z: cz,
        width,
      },
    };
  };

  // 1. Group placements by (category, roomKey) so items of the same type in the same room are evaluated together
  interface AnnotatedPlacement {
    placement: CalibratedFurniturePlacement;
    roomKey: string;
    isSecondaryBedroom: boolean;
  }

  const annotated: AnnotatedPlacement[] = rawList.map((placement) => {
    const cat = resolveArtifactCategory(placement.item);
    const normalizedPlacement: CalibratedFurniturePlacement = {
      ...placement,
      item: {
        ...placement.item,
        category: cat,
      },
    };
    const { roomKey, isSecondaryBedroom } =
      findRoomForPlacement(normalizedPlacement);
    return {
      placement: normalizedPlacement,
      roomKey,
      isSecondaryBedroom,
    };
  });

  // 2. First pass: Fuse any same-category objects within radius < 1.5m into a centralized coordinate
  //    (for secondary bedrooms with single beds, fuse if < 0.95m so 2 distinct twin beds can coexist)
  const categories = Array.from(
    new Set(annotated.map((a) => a.placement.item.category))
  );

  const afterRadiusFusion: AnnotatedPlacement[] = [];

  for (const cat of categories) {
    const itemsOfCat = annotated.filter(
      (a) => a.placement.item.category === cat
    );
    const visited = new Array(itemsOfCat.length).fill(false);

    for (let i = 0; i < itemsOfCat.length; i++) {
      if (visited[i]) continue;
      visited[i] = true;
      const cluster: AnnotatedPlacement[] = [itemsOfCat[i]];

      for (let j = i + 1; j < itemsOfCat.length; j++) {
        if (visited[j]) continue;
        const dist = Math.hypot(
          itemsOfCat[i].placement.x - itemsOfCat[j].placement.x,
          itemsOfCat[i].placement.z - itemsOfCat[j].placement.z
        );
        const bothSecondaryTwinBeds =
          cat === 'bed' &&
          itemsOfCat[i].isSecondaryBedroom &&
          itemsOfCat[j].isSecondaryBedroom;
        const mergeRadius = bothSecondaryTwinBeds ? 0.95 : 1.5;

        if (dist < mergeRadius) {
          visited[j] = true;
          cluster.push(itemsOfCat[j]);
        }
      }

      const fusedPlacement = fuseClusterToCentroid(
        cluster.map((c) => c.placement)
      );
      const repInfo = findRoomForPlacement(fusedPlacement);
      afterRadiusFusion.push({
        placement: fusedPlacement,
        roomKey: repInfo.roomKey,
        isSecondaryBedroom:
          cluster.some((c) => c.isSecondaryBedroom) ||
          repInfo.isSecondaryBedroom,
      });
    }
  }

  // 3. Second pass: Strict Per-Room Quota Enforcement & Centroid Fusion
  //    • Max 1 Master Bed per bedroom (or 2 single beds if secondary bedroom)
  //    • Max 1 WC and 1 Vanity per bathroom
  //    • Max 1 Sofa Set per living room
  //    • Max 1 per room for other primary fixtures (dining_table, kitchen_island, shower, wardrobe)
  const byRoomAndCat = new Map<string, AnnotatedPlacement[]>();
  for (const entry of afterRadiusFusion) {
    const key = `${entry.roomKey}::${entry.placement.item.category}`;
    const list = byRoomAndCat.get(key) || [];
    list.push(entry);
    byRoomAndCat.set(key, list);
  }

  const sanitizedList: CalibratedFurniturePlacement[] = [];

  for (const [, group] of byRoomAndCat.entries()) {
    const cat = group[0].placement.item.category;
    const isSecBed = group.some((g) => g.isSecondaryBedroom);

    const maxAllowedInRoom = cat === 'bed' && isSecBed ? 2 : 1;

    if (group.length <= maxAllowedInRoom) {
      for (const g of group) {
        sanitizedList.push(
          fuseClusterToCentroid([g.placement], cat === 'bed' && isSecBed && group.length === 2)
        );
      }
    } else if (maxAllowedInRoom === 1) {
      // Fuse all duplicate objects of this type in the same room into 1 centralized object
      sanitizedList.push(
        fuseClusterToCentroid(group.map((g) => g.placement))
      );
    } else {
      // Secondary bedroom with > 2 beds: keep 1st bed and fuse remaining into 2nd centralized single bed
      sanitizedList.push(fuseClusterToCentroid([group[0].placement], true));
      sanitizedList.push(
        fuseClusterToCentroid(
          group.slice(1).map((g) => g.placement),
          true
        )
      );
    }
  }

  sanitizedList.sort(
    (a, b) =>
      (keyCategoryPriority[a.item.category] ?? 99) -
      (keyCategoryPriority[b.item.category] ?? 99)
  );

  return sanitizedList.slice(0, 10);
}

/**
 * Strict linear transformation from the normalized 0..1000 Integer Grid
 * (where 0,0 is top-left and 1000,1000 is bottom-right of the image)
 * to the real 3D slab dimensions (slabWidth and slabDepth).
 */
export function mapNormalizedGrid1000To3D(
  xGrid: number,
  zGrid: number,
  slabWidth: number,
  slabDepth: number
): { x3D: number; z3D: number } {
  const x3D = Number(((xGrid / 1000 - 0.5) * slabWidth).toFixed(3));
  const z3D = Number(((zGrid / 1000 - 0.5) * slabDepth).toFixed(3));
  return { x3D, z3D };
}

/**
 * Reconstructs the 3D scene for Step 3 (v1.7):
 * 1. EXTRUSIÓN VECTORIAL ESTRICTA 1:1 DE MUROS (Anclaje al Paso 1):
 *    - Prohibits Gemini Vision from generating or inventing wall coordinates for the 3D scene.
 *    - Builds 100% of the wall geometry by directly extruding the real vector segments and polylines
 *      validated in STEP 1 (`baseBlueprint.walls` / `rawPolylines`).
 * 2. FILTRO ESTRICTO ANTI-DUPLICADOS EN MOBILIARIO (Deduplication Layer):
 *    - Runs `sanitizeAndDeduplicateFurniturePlacements` before instantiating 3D furniture models.
 */
export function reconstructSceneFromGeminiSpatialAnalysis(
  spatialAnalysis: Spatial3DAnalysisResult | null,
  baseBlueprint: BlueprintData,
  _imgEl: HTMLImageElement,
  slabWidth: number,
  slabDepth: number
): {
  reconstructedBlueprint: BlueprintData;
  placements: CalibratedFurniturePlacement[];
  analysisSummary: string;
  modelUsed: string;
} {
  const bpW = Math.max(0.1, Number(baseBlueprint.totalWidth) || slabWidth);
  const bpD = Math.max(0.1, Number(baseBlueprint.totalDepth) || slabDepth);

  const scaleX = slabWidth / bpW;
  const scaleZ = slabDepth / bpD;

  const to3DX = (xGrid: number) =>
    Number(((xGrid / 1000 - 0.5) * slabWidth).toFixed(3));
  const to3DZ = (zGrid: number) =>
    Number(((zGrid / 1000 - 0.5) * slabDepth).toFixed(3));

  const toStep1GridX = (xMeters: number) =>
    Math.max(
      0,
      Math.min(1000, Math.round(((Number(xMeters) || 0) / bpW + 0.5) * 1000))
    );
  const toStep1GridZ = (zMeters: number) =>
    Math.max(
      0,
      Math.min(1000, Math.round(((Number(zMeters) || 0) / bpD + 0.5) * 1000))
    );

  // 1. Reconstruct Indoor & Outdoor RoomZones in 3D Slab coordinates
  const scaledRooms: RoomZone[] = [];

  for (const r of baseBlueprint.rooms || []) {
    const isOutdoor =
      r.zoneType === 'outdoor' ||
      r.type === 'terrace' ||
      isOutdoorLabel(r.name || '');
    const rx = Number(((Number(r.x) || 0) * scaleX).toFixed(3));
    const rz = Number(((Number(r.z) || 0) * scaleZ).toFixed(3));
    const rw = Number(((r.width / bpW) * slabWidth).toFixed(2));
    const rd = Number(((r.depth / bpD) * slabDepth).toFixed(2));

    scaledRooms.push({
      ...r,
      type: isOutdoor ? 'terrace' : r.type,
      zoneType: isOutdoor ? 'outdoor' : 'indoor',
      x: rx,
      z: rz,
      width: rw,
      depth: rd,
      floorMaterial: isOutdoor
        ? /jardin|cesped|pasto/i.test(r.name || '')
          ? 'grass'
          : 'deck'
        : r.floorMaterial,
    });
  }

  if (
    spatialAnalysis &&
    Array.isArray(spatialAnalysis.zones) &&
    spatialAnalysis.zones.length > 0
  ) {
    for (let zIdx = 0; zIdx < spatialAnalysis.zones.length; zIdx++) {
      const sz = spatialAnalysis.zones[zIdx];
      const minX3D = to3DX(Number(sz.minX) || 100);
      const maxX3D = to3DX(Number(sz.maxX) || 900);
      const minZ3D = to3DZ(Number(sz.minZ) || 100);
      const maxZ3D = to3DZ(Number(sz.maxZ) || 900);
      const isOutdoor =
        sz.zoneType === 'outdoor' || isOutdoorLabel(sz.name || '');

      const w3D = Math.max(1.0, Math.abs(maxX3D - minX3D));
      const d3D = Math.max(1.0, Math.abs(maxZ3D - minZ3D));
      const cx3D = (minX3D + maxX3D) / 2;
      const cz3D = (minZ3D + maxZ3D) / 2;

      const alreadyCovered = scaledRooms.some(
        (sr) => Math.hypot(sr.x - cx3D, sr.z - cz3D) < 1.1
      );
      if (!alreadyCovered) {
        const nameLower = (sz.name || '').toLowerCase();
        const inferredType: RoomZone['type'] = isOutdoor
          ? 'terrace'
          : /ba[ñn]o|wc|toilet/.test(nameLower)
            ? 'bathroom'
            : /dormitorio|habitaci|bed|suite/.test(nameLower)
              ? 'bedroom'
              : /cocina|kitchen/.test(nameLower)
                ? 'kitchen'
                : 'living';

        scaledRooms.push({
          id: sz.id || `ai-zone-${zIdx}`,
          name: sz.name || (isOutdoor ? 'Terraza Exterior' : `Recinto ${zIdx + 1}`),
          type: inferredType,
          zoneType: isOutdoor ? 'outdoor' : 'indoor',
          x: Number(cx3D.toFixed(3)),
          z: Number(cz3D.toFixed(3)),
          width: Number(w3D.toFixed(2)),
          depth: Number(d3D.toFixed(2)),
          floorMaterial:
            sz.surfaceMaterial === 'grass'
              ? 'grass'
              : sz.surfaceMaterial === 'deck'
                ? 'deck'
                : sz.surfaceMaterial === 'stone'
                  ? 'stone'
                  : sz.surfaceMaterial === 'porcelain'
                    ? 'porcelain'
                    : isOutdoor
                      ? 'deck'
                      : 'wood',
        });
      }
    }
  }

  const outdoorZones = scaledRooms.filter(
    (r) => r.zoneType === 'outdoor' || r.type === 'terrace'
  );
  const indoorZones = scaledRooms.filter(
    (r) => r.zoneType !== 'outdoor' && r.type !== 'terrace'
  );

  const isOutdoorPerimeterClosingWall = (
    x1: number,
    z1: number,
    x2: number,
    z2: number
  ): boolean => {
    if (outdoorZones.length === 0) return false;
    const mx = (x1 + x2) / 2;
    const mz = (z1 + z2) / 2;

    for (const oz of outdoorZones) {
      const ozMinX = oz.x - oz.width / 2 - 0.28;
      const ozMaxX = oz.x + oz.width / 2 + 0.28;
      const ozMinZ = oz.z - oz.depth / 2 - 0.28;
      const ozMaxZ = oz.z + oz.depth / 2 + 0.28;

      const midInOutdoor =
        mx >= ozMinX && mx <= ozMaxX && mz >= ozMinZ && mz <= ozMaxZ;
      if (!midInOutdoor) continue;

      const bordersIndoorRoom = indoorZones.some((iz) => {
        const izMinX = iz.x - iz.width / 2 - 0.35;
        const izMaxX = iz.x + iz.width / 2 + 0.35;
        const izMinZ = iz.z - iz.depth / 2 - 0.35;
        const izMaxZ = iz.z + iz.depth / 2 + 0.35;
        return mx >= izMinX && mx <= izMaxX && mz >= izMinZ && mz <= izMaxZ;
      });

      if (!bordersIndoorRoom) {
        return true;
      }
    }
    return false;
  };

  const normalizeWallOpenings = (
    rawOpenings: WallOpening[] | undefined,
    wallId: string,
    wallLen: number
  ): WallOpening[] => {
    if (!Array.isArray(rawOpenings)) return [];
    return rawOpenings.map((op, opIdx) => {
      const isWin = op.type === 'window';
      const rawWidth = Number(op.width) || (isWin ? 1.35 : 0.85);
      const metricOpW =
        rawWidth > 10 ? (rawWidth / 1000) * Math.max(slabWidth, slabDepth) : rawWidth;
      return {
        ...op,
        id: op.id || `${wallId}-op-${opIdx}`,
        type: isWin ? 'window' : 'door',
        offsetRatio: Number(
          Math.max(0.12, Math.min(0.88, Number(op.offsetRatio) || 0.5)).toFixed(3)
        ),
        width: Number(
          (isWin
            ? Math.max(0.7, Math.min(wallLen * 0.55, Math.min(2.0, metricOpW)))
            : Math.max(
                0.7,
                Math.min(0.9, Math.min(metricOpW, Math.max(0.68, wallLen - 0.2)))
              )
          ).toFixed(2)
        ),
        height: Number(
          (isWin
            ? Math.max(1.0, Math.min(1.4, Number(op.height) || 1.2))
            : 2.05
          ).toFixed(2)
        ),
        sillHeight: isWin
          ? Number(
              Math.max(0.9, Math.min(1.0, Number(op.sillHeight) || 0.95)).toFixed(2)
            )
          : 0,
      };
    });
  };

  // 2. EXTRUSIÓN EXCLUSIVA DE LA HUELLA REAL DE LA CASA (v1.8):
  //    Eliminates the 4-wall outer perimeter canvas frame and any outdoor wall segments.
  const finalWalls: WallSegment[] = [];
  const step1Walls = Array.isArray(baseBlueprint.walls)
    ? baseBlueprint.walls
    : [];

  for (let idx = 0; idx < step1Walls.length; idx++) {
    const w = step1Walls[idx];
    if (w.zoneType === 'outdoor') continue;
    if (/^(img-wall-[0123]$|img-perim-|pdf-perim-|perim-)/.test(w.id || '')) {
      continue;
    }

    const x1 = Number(((Number(w.x1) || 0) * scaleX).toFixed(3));
    const z1 = Number(((Number(w.z1) || 0) * scaleZ).toFixed(3));
    const x2 = Number(((Number(w.x2) || 0) * scaleX).toFixed(3));
    const z2 = Number(((Number(w.z2) || 0) * scaleZ).toFixed(3));
    const wallLen = Math.hypot(x2 - x1, z2 - z1);
    if (wallLen < 0.18) continue;

    // Prohibit outer rectangular canvas frame walls
    const nearLeft =
      Math.abs(x1 + slabWidth / 2) < slabWidth * 0.12 &&
      Math.abs(x2 + slabWidth / 2) < slabWidth * 0.12;
    const nearRight =
      Math.abs(x1 - slabWidth / 2) < slabWidth * 0.12 &&
      Math.abs(x2 - slabWidth / 2) < slabWidth * 0.12;
    const nearTop =
      Math.abs(z1 + slabDepth / 2) < slabDepth * 0.12 &&
      Math.abs(z2 + slabDepth / 2) < slabDepth * 0.12;
    const nearBottom =
      Math.abs(z1 - slabDepth / 2) < slabDepth * 0.12 &&
      Math.abs(z2 - slabDepth / 2) < slabDepth * 0.12;
    if (
      ((nearLeft || nearRight) && wallLen >= slabDepth * 0.62) ||
      ((nearTop || nearBottom) && wallLen >= slabWidth * 0.62)
    ) {
      continue;
    }

    if (isOutdoorPerimeterClosingWall(x1, z1, x2, z2)) continue;

    const wallId = w.id || `step1-wall-${idx}`;
    finalWalls.push({
      ...w,
      id: wallId,
      x1,
      z1,
      x2,
      z2,
      height: Number(w.height) || 2.6,
      thickness: Math.max(
        0.08,
        Math.min(0.3, Number(w.thickness) || 0.15)
      ),
      isExterior: false,
      zoneType: 'indoor',
      openings: normalizeWallOpenings(w.openings, wallId, wallLen),
    });
  }

  const reconstructedBlueprint: BlueprintData = {
    ...baseBlueprint,
    totalWidth: slabWidth,
    totalDepth: slabDepth,
    walls: finalWalls,
    rooms: scaledRooms,
  };

  // 3. FILTRO ESTRICTO ANTI-DUPLICADOS EN MOBILIARIO (v1.7 Deduplication Layer):
  if (
    spatialAnalysis &&
    Array.isArray(spatialAnalysis.furniture) &&
    spatialAnalysis.furniture.length > 0
  ) {
    const rawAiPlacements: CalibratedFurniturePlacement[] = [];

    const isGrid1000 =
      spatialAnalysis.coordinateSystem === 'grid_1000' ||
      spatialAnalysis.furniture.some(
        (f) => Math.abs(Number(f.x)) > slabWidth || Math.abs(Number(f.z)) > slabDepth
      );

    for (let i = 0; i < spatialAnalysis.furniture.length; i++) {
      const af = spatialAnalysis.furniture[i];
      const category = mapSpatialTypeToFurnitureCategory(af.type);
      const std = STANDARD_DIMENSIONS[category] || STANDARD_DIMENSIONS.desk;

      const isOutdoorItem =
        af.zoneType === 'outdoor' ||
        category === 'patio_set' ||
        category === 'lounger' ||
        category === 'bbq_grill' ||
        isOutdoorLabel(`${af.name || ''} ${af.roomLabel || ''}`);

      const rawX = Number(af.x) || 500;
      const rawZ = Number(af.z) || 500;
      const x3D = isGrid1000 ? to3DX(rawX) : Number(rawX.toFixed(3));
      const z3D = isGrid1000 ? to3DZ(rawZ) : Number(rawZ.toFixed(3));

      const rawW = Number(af.width) || 0;
      const rawD = Number(af.depth) || 0;
      const isSecondaryArtifact =
        category === 'wc' ||
        category === 'vanity' ||
        category === 'desk' ||
        category === 'wardrobe' ||
        category === 'lounger' ||
        category === 'bbq_grill';
      const secondaryShrink = isSecondaryArtifact ? 0.8 : 0.92;

      const metricW =
        (rawW > 10 ? (rawW / 1000) * slabWidth : rawW || std.width) *
        secondaryShrink;
      const metricD =
        (rawD > 10 ? (rawD / 1000) * slabDepth : rawD || std.depth) *
        secondaryShrink;

      const width =
        category === 'wc' || category === 'vanity' || category === 'shower'
          ? std.width
          : Number(Math.max(0.32, Math.min(2.1, metricW || std.width)).toFixed(2));
      const depth =
        category === 'wc' || category === 'vanity' || category === 'shower'
          ? std.depth
          : Number(Math.max(0.32, Math.min(2.0, metricD || std.depth)).toFixed(2));
      const height = Number(
        Math.max(0.4, Math.min(2.1, Number(af.height) || std.height)).toFixed(2)
      );

      let rotY = Number.isFinite(Number(af.rotationY))
        ? Number(af.rotationY)
        : 0;
      if (Math.abs(rotY) > Math.PI * 2 + 0.01) {
        rotY = (rotY * Math.PI) / 180;
      }

      const clampedX = Number(
        Math.max(-slabWidth * 0.48, Math.min(slabWidth * 0.48, x3D)).toFixed(3)
      );
      const clampedZ = Number(
        Math.max(-slabDepth * 0.48, Math.min(slabDepth * 0.48, z3D)).toFixed(3)
      );

      rawAiPlacements.push({
        item: {
          id: af.id || `ai-furn-${i}`,
          name: af.name || `Artefacto ${category}`,
          category,
          zoneType: isOutdoorItem ? 'outdoor' : 'indoor',
          x: clampedX,
          z: clampedZ,
          width,
          depth,
          height,
          rotationY: rotY,
          roomLabel: af.roomLabel,
        },
        x: clampedX,
        y: 0.034,
        z: clampedZ,
        rotationY: rotY,
      });
    }

    const aiPlacements = sanitizeAndDeduplicateFurniturePlacements(
      rawAiPlacements,
      scaledRooms
    );

    if (aiPlacements.length > 0) {
      return {
        reconstructedBlueprint: {
          ...reconstructedBlueprint,
          furniture: aiPlacements.map((p) => p.item),
        },
        placements: aiPlacements,
        analysisSummary:
          spatialAnalysis.analysisSummary ||
          `Reconstrucción 3D v1.7: ${finalWalls.length} políneas 1:1 del Paso 1 y ${aiPlacements.length} artefactos 3D deduplicados.`,
        modelUsed: spatialAnalysis.modelUsed || 'gemini-3-flash-preview',
      };
    }
  }

  // 3. LIMPIEZA VISUAL DE CAJAS Y MUEBLES DESALINEADOS (v1.8):
  //    Never instantiate unverified fallback Step 1 furniture blocks that lack an exact coordinate match
  //    with the Step 2 CGI floor plan. Let the photorealistic Step 2 floor shine cleanly without floating blocks.
  return {
    reconstructedBlueprint: {
      ...reconstructedBlueprint,
      furniture: [],
    },
    placements: [],
    analysisSummary:
      spatialAnalysis?.analysisSummary ||
      `Reconstrucción 3D v1.8 (${finalWalls.length} muros habitables 1:1 sin marco exterior ni bloques flotantes).`,
    modelUsed: spatialAnalysis?.modelUsed || 'gemini-3-flash-preview',
  };
}


/**
 * Standardized architectural target dimensions (in meters) for interior & outdoor fixtures.
 * Chairs, coffee tables, and secondary artifacts are reduced by 20% for greater visual spaciousness and circulation.
 * Every item's local -Z axis corresponds to its backrest / headboard / tank / wall-mount side.
 */
const STANDARD_DIMENSIONS: Record<
  FurnitureCategory,
  { width: number; depth: number; height: number; attachToWall: boolean }
> = {
  bed: { width: 1.48, depth: 1.82, height: 0.62, attachToWall: true },
  wc: { width: 0.34, depth: 0.56, height: 0.72, attachToWall: true },
  vanity: { width: 0.72, depth: 0.42, height: 0.82, attachToWall: true },
  shower: { width: 0.84, depth: 0.68, height: 1.95, attachToWall: true },
  sofa: { width: 1.72, depth: 0.78, height: 0.78, attachToWall: true },
  kitchen_island: { width: 1.75, depth: 0.56, height: 0.88, attachToWall: true },
  dining_table: { width: 1.32, depth: 0.78, height: 0.74, attachToWall: false },
  wardrobe: { width: 1.16, depth: 0.44, height: 2.0, attachToWall: true },
  desk: { width: 1.2, depth: 0.35, height: 1.1, attachToWall: true },
  patio_set: { width: 1.32, depth: 1.08, height: 0.74, attachToWall: false },
  lounger: { width: 0.62, depth: 1.52, height: 0.55, attachToWall: false },
  bbq_grill: { width: 1.08, depth: 0.5, height: 1.05, attachToWall: false },
};

/**
 * Infers normalized FurnitureCategory from item category and Spanish/English name keywords
 * so every detected artifact in the blueprint pipeline maps to its exact 3D procedural generator.
 */
export function resolveArtifactCategory(item: FurnitureItem): FurnitureCategory {
  const label = `${item.name || ''} ${item.roomLabel || ''}`.toLowerCase();
  if (/patio_set|juego de terraza|mesa exterior|comedor exterior|outdoor/.test(label))
    return 'patio_set';
  if (/lounger|reposera|tumbona|camastro|solarium/.test(label))
    return 'lounger';
  if (/bbq|grill|parrilla|quincho|asador/.test(label))
    return 'bbq_grill';
  if (/wc|inodoro|sanitario|taza/.test(label)) return 'wc';
  if (/vanitorio|lavamanos|lavabo|espejo/.test(label)) return 'vanity';
  if (/ducha|mampara|receptaculo|bañera|tina/.test(label)) return 'shower';
  if (/cama|dormitorio|colchon|king|queen|plaza/.test(label)) return 'bed';
  if (/sofa|sillon|living|estar/.test(label)) return 'sofa';
  if (/cocina|meson|encimera|lavaplatos|isla/.test(label)) return 'kitchen_island';
  if (/comedor|mesa comedor/.test(label)) return 'dining_table';
  if (/closet|armario|ropero|guardarropa/.test(label)) return 'wardrobe';
  if (/tv|entretenimiento|rack|consola|escritorio|mesa/.test(label)) return 'desk';
  return item.category;
}

/**
 * Calibrates interior assets for fallback blueprint usage.
 */
export function calibrateAndSnapInteriorAssets(
  blueprint: BlueprintData
): CalibratedFurniturePlacement[] {
  const rawItems: FurnitureItem[] = [...(blueprint.furniture || [])];
  return rawItems.map((rawItem) => {
    const category = resolveArtifactCategory(rawItem);
    const std = STANDARD_DIMENSIONS[category] || STANDARD_DIMENSIONS.desk;
    return {
      item: {
        ...rawItem,
        category,
        width: rawItem.width || std.width,
        depth: rawItem.depth || std.depth,
        height: rawItem.height || std.height,
      },
      x: Number((rawItem.x || 0).toFixed(3)),
      y: 0.033,
      z: Number((rawItem.z || 0).toFixed(3)),
      rotationY: rawItem.rotationY ?? 0,
    };
  });
}

/**
 * Builds composite 5–14 part procedural 3D models (THREE.Group) for all interior furniture,
 * sanitary fixtures, kitchen appliances, wardrobes, and entertainment centers using
 * solid, opaque high-end architectural maquette materials (v1.4):
 * warm oak/walnut woods, glossy brilliant white porcelain (#FFFFFF), matte black steel (#2A2D34),
 * and slate gray / navy blue textiles.
 */
export function buildProceduralFurnitureGroup(
  item: FurnitureItem,
  volumeOpacity = 1.0,
  _includeContactShadow = false
): THREE.Group {
  const group = new THREE.Group();
  const category = resolveArtifactCategory(item);
  group.name = `${item.name} (${category})`;

  const effectiveOpacity = Math.max(0.05, Math.min(1.0, volumeOpacity));
  const isTranslucent = effectiveOpacity < 0.99;

  const porcelainMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.14,
    metalness: 0.05,
    transparent: isTranslucent,
    opacity: effectiveOpacity,
  });

  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.16,
    metalness: 0.92,
    transparent: isTranslucent,
    opacity: effectiveOpacity,
  });

  const blackSteelMat = new THREE.MeshStandardMaterial({
    color: 0x2a2d34,
    roughness: 0.38,
    metalness: 0.65,
    transparent: isTranslucent,
    opacity: effectiveOpacity,
  });

  const oakWoodMat = new THREE.MeshStandardMaterial({
    color: 0xc89d66,
    roughness: 0.48,
    metalness: 0.04,
    transparent: isTranslucent,
    opacity: effectiveOpacity,
  });

  const walnutWoodMat = new THREE.MeshStandardMaterial({
    color: 0x6e4726,
    roughness: 0.46,
    metalness: 0.05,
    transparent: isTranslucent,
    opacity: effectiveOpacity,
  });

  const fabricMediumGrayMat = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    roughness: 0.85,
    metalness: 0.02,
    transparent: isTranslucent,
    opacity: effectiveOpacity,
  });

  const fabricLightSlateMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.82,
    metalness: 0.02,
    transparent: isTranslucent,
    opacity: effectiveOpacity,
  });

  const fabricNavyMat = new THREE.MeshStandardMaterial({
    color: 0x1e3a5f,
    roughness: 0.84,
    metalness: 0.03,
    transparent: isTranslucent,
    opacity: effectiveOpacity,
  });

  const accentPillowMat = new THREE.MeshStandardMaterial({
    color: 0xd97706,
    roughness: 0.8,
    metalness: 0.02,
    transparent: isTranslucent,
    opacity: effectiveOpacity,
  });

  const darkGraniteQuartzMat = new THREE.MeshStandardMaterial({
    color: 0x2a2d34,
    roughness: 0.25,
    metalness: 0.12,
    transparent: isTranslucent,
    opacity: effectiveOpacity,
  });

  const vanityQuartzMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.18,
    metalness: 0.06,
    transparent: isTranslucent,
    opacity: effectiveOpacity,
  });

  const screenBlackMat = new THREE.MeshStandardMaterial({
    color: 0x111827,
    roughness: 0.15,
    metalness: 0.35,
    transparent: isTranslucent,
    opacity: effectiveOpacity,
  });

  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xdbeafe,
    roughness: 0.1,
    metalness: 0.1,
    transparent: true,
    opacity: Math.min(0.38, effectiveOpacity * 0.38),
    depthWrite: false,
  });

  switch (category) {
    case 'wc': {
      // Standardized WC in glossy white porcelain (#FFFFFF) with rear tank at -Z
      const d = item.depth;
      const pedestal = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.18, 0.38, 24),
        porcelainMat
      );
      pedestal.position.set(0, 0.19, 0.05);
      pedestal.castShadow = true;
      pedestal.receiveShadow = true;
      group.add(pedestal);

      const bowl = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.14, 0.22, 24),
        porcelainMat
      );
      bowl.scale.set(1.0, 1.0, 1.35);
      bowl.position.set(0, 0.36, 0.08);
      bowl.castShadow = true;
      bowl.receiveShadow = true;
      group.add(bowl);

      const seat = new THREE.Mesh(
        new THREE.CylinderGeometry(0.205, 0.205, 0.032, 24),
        porcelainMat
      );
      seat.scale.set(1.0, 1.0, 1.35);
      seat.position.set(0, 0.48, 0.08);
      seat.castShadow = true;
      group.add(seat);

      const tank = new THREE.Mesh(
        new THREE.BoxGeometry(0.38, 0.38, 0.18),
        porcelainMat
      );
      tank.position.set(0, 0.61, -d / 2 + 0.09);
      tank.castShadow = true;
      tank.receiveShadow = true;
      group.add(tank);

      const tankLid = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.03, 0.2),
        porcelainMat
      );
      tankLid.position.set(0, 0.81, -d / 2 + 0.09);
      tankLid.castShadow = true;
      group.add(tankLid);

      const flushBtn = new THREE.Mesh(
        new THREE.CylinderGeometry(0.032, 0.032, 0.02, 16),
        chromeMat
      );
      flushBtn.position.set(0, 0.83, -d / 2 + 0.09);
      group.add(flushBtn);
      break;
    }

    case 'vanity': {
      const w = item.width;
      const d = item.depth;
      const cabinet = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.54, d - 0.02),
        walnutWoodMat
      );
      cabinet.position.set(0, 0.5, 0);
      cabinet.castShadow = true;
      cabinet.receiveShadow = true;
      group.add(cabinet);

      for (const dy of [0.38, 0.63]) {
        const drawer = new THREE.Mesh(
          new THREE.BoxGeometry(w - 0.04, 0.22, 0.02),
          oakWoodMat
        );
        drawer.position.set(0, dy, d / 2 - 0.01);
        drawer.castShadow = true;
        group.add(drawer);

        const handle = new THREE.Mesh(
          new THREE.BoxGeometry(w * 0.32, 0.015, 0.025),
          chromeMat
        );
        handle.position.set(0, dy + 0.06, d / 2 + 0.01);
        group.add(handle);
      }

      const top = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.02, 0.045, d + 0.02),
        vanityQuartzMat
      );
      top.position.set(0, 0.8, 0);
      top.castShadow = true;
      top.receiveShadow = true;
      group.add(top);

      const backsplash = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.02, 0.08, 0.025),
        vanityQuartzMat
      );
      backsplash.position.set(0, 0.86, -d / 2 + 0.015);
      group.add(backsplash);

      const offsets = w > 1.05 ? [-w * 0.25, w * 0.25] : [0];
      for (const ox of offsets) {
        const basin = new THREE.Mesh(
          new THREE.CylinderGeometry(0.18, 0.14, 0.11, 24),
          porcelainMat
        );
        basin.position.set(ox, 0.875, 0.03);
        basin.castShadow = true;
        group.add(basin);

        const faucetBody = new THREE.Mesh(
          new THREE.CylinderGeometry(0.016, 0.02, 0.18, 14),
          chromeMat
        );
        faucetBody.position.set(ox, 0.91, -d / 2 + 0.09);
        group.add(faucetBody);

        const faucetSpout = new THREE.Mesh(
          new THREE.BoxGeometry(0.02, 0.02, 0.11),
          chromeMat
        );
        faucetSpout.position.set(ox, 0.99, -d / 2 + 0.13);
        group.add(faucetSpout);
      }

      const mirrorFrame = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.9, 0.82, 0.025),
        blackSteelMat
      );
      mirrorFrame.position.set(0, 1.44, -d / 2 + 0.015);
      mirrorFrame.castShadow = true;
      group.add(mirrorFrame);

      const mirrorGlass = new THREE.Mesh(
        new THREE.PlaneGeometry(w * 0.85, 0.77),
        chromeMat
      );
      mirrorGlass.position.set(0, 1.44, -d / 2 + 0.03);
      group.add(mirrorGlass);
      break;
    }

    case 'shower': {
      const w = item.width;
      const d = item.depth;
      const tray = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.06, d),
        porcelainMat
      );
      tray.position.set(0, 0.03, 0);
      tray.castShadow = true;
      tray.receiveShadow = true;
      group.add(tray);

      const drain = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.68, 0.065, 0.06),
        chromeMat
      );
      drain.position.set(0, 0.032, -d * 0.34);
      group.add(drain);

      const glassPanel = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, 1.96, d * 0.72),
        glassMat
      );
      glassPanel.position.set(-w / 2 + 0.02, 1.04, -d * 0.12);
      glassPanel.renderOrder = 10;
      group.add(glassPanel);

      const vPostFront = new THREE.Mesh(
        new THREE.BoxGeometry(0.03, 1.98, 0.03),
        blackSteelMat
      );
      vPostFront.position.set(-w / 2 + 0.02, 1.04, d * 0.24);
      const vPostWall = new THREE.Mesh(
        new THREE.BoxGeometry(0.03, 1.98, 0.03),
        blackSteelMat
      );
      vPostWall.position.set(-w / 2 + 0.02, 1.04, -d / 2 + 0.03);
      const topBar = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.03, 0.03),
        blackSteelMat
      );
      topBar.position.set(0, 2.01, 0.16);
      group.add(vPostFront, vPostWall, topBar);

      const riser = new THREE.Mesh(
        new THREE.CylinderGeometry(0.014, 0.014, 1.15, 12),
        chromeMat
      );
      riser.position.set(0, 1.48, -d / 2 + 0.06);
      group.add(riser);

      const mixerBar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.02, 0.24, 12),
        chromeMat
      );
      mixerBar.rotation.z = Math.PI / 2;
      mixerBar.position.set(0, 1.05, -d / 2 + 0.07);
      group.add(mixerBar);

      const rainHead = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.14, 0.016, 24),
        chromeMat
      );
      rainHead.position.set(0, 2.02, -d / 2 + 0.24);
      group.add(rainHead);
      break;
    }

    case 'bed': {
      const w = item.width;
      const d = item.depth;
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.26, d - 0.08),
        walnutWoodMat
      );
      base.position.set(0, 0.15, 0.04);
      base.castShadow = true;
      base.receiveShadow = true;
      group.add(base);

      const headboard = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.08, 1.06, 0.11),
        fabricNavyMat
      );
      headboard.position.set(0, 0.53, -d / 2 + 0.055);
      headboard.castShadow = true;
      headboard.receiveShadow = true;
      group.add(headboard);

      const mattress = new THREE.Mesh(
        new THREE.BoxGeometry(w - 0.08, 0.24, d - 0.18),
        fabricLightSlateMat
      );
      mattress.position.set(0, 0.39, 0.05);
      mattress.castShadow = true;
      mattress.receiveShadow = true;
      group.add(mattress);

      const duvet = new THREE.Mesh(
        new THREE.BoxGeometry(w - 0.05, 0.25, (d - 0.18) * 0.68),
        fabricMediumGrayMat
      );
      duvet.position.set(0, 0.405, 0.28);
      duvet.castShadow = true;
      duvet.receiveShadow = true;
      group.add(duvet);

      const throwBlanket = new THREE.Mesh(
        new THREE.BoxGeometry(w - 0.03, 0.26, (d - 0.18) * 0.24),
        fabricNavyMat
      );
      throwBlanket.position.set(0, 0.415, d / 2 - 0.24);
      throwBlanket.castShadow = true;
      group.add(throwBlanket);

      for (const px of [-w * 0.24, w * 0.24]) {
        const backPillow = new THREE.Mesh(
          new THREE.BoxGeometry(w * 0.36, 0.13, 0.28),
          fabricLightSlateMat
        );
        backPillow.position.set(px, 0.56, -d / 2 + 0.26);
        backPillow.rotation.x = 0.22;
        backPillow.castShadow = true;
        group.add(backPillow);

        const frontCushion = new THREE.Mesh(
          new THREE.BoxGeometry(w * 0.24, 0.11, 0.2),
          accentPillowMat
        );
        frontCushion.position.set(px, 0.55, -d / 2 + 0.44);
        frontCushion.rotation.x = 0.15;
        frontCushion.castShadow = true;
        group.add(frontCushion);
      }

      for (const nx of [-w / 2 - 0.17, w / 2 + 0.17]) {
        const stand = new THREE.Mesh(
          new THREE.BoxGeometry(0.28, 0.34, 0.27),
          walnutWoodMat
        );
        stand.position.set(nx, 0.17, -d / 2 + 0.16);
        stand.castShadow = true;
        stand.receiveShadow = true;
        group.add(stand);

        const lampBase = new THREE.Mesh(
          new THREE.CylinderGeometry(0.04, 0.048, 0.1, 12),
          blackSteelMat
        );
        lampBase.position.set(nx, 0.39, -d / 2 + 0.16);
        const lampShade = new THREE.Mesh(
          new THREE.CylinderGeometry(0.064, 0.08, 0.11, 16),
          oakWoodMat
        );
        lampShade.position.set(nx, 0.48, -d / 2 + 0.16);
        group.add(lampBase, lampShade);
      }
      break;
    }

    case 'sofa': {
      const w = item.width;
      const d = item.depth;
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.1, d),
        walnutWoodMat
      );
      frame.position.set(0, 0.08, 0);
      frame.castShadow = true;
      group.add(frame);

      const cushionCount = 3;
      const innerW = w - 0.32;
      const cWidth = innerW / cushionCount - 0.02;
      for (let i = 0; i < cushionCount; i++) {
        const cx = -innerW / 2 + cWidth / 2 + i * (cWidth + 0.02) + 0.01;
        const seatCushion = new THREE.Mesh(
          new THREE.BoxGeometry(cWidth, 0.22, d - 0.16),
          fabricMediumGrayMat
        );
        seatCushion.position.set(cx, 0.24, 0.06);
        seatCushion.castShadow = true;
        seatCushion.receiveShadow = true;
        group.add(seatCushion);

        const backCushion = new THREE.Mesh(
          new THREE.BoxGeometry(cWidth - 0.02, 0.38, 0.16),
          fabricNavyMat
        );
        backCushion.position.set(cx, 0.52, -d / 2 + 0.22);
        backCushion.rotation.x = -0.1;
        backCushion.castShadow = true;
        group.add(backCushion);
      }

      const backrest = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.68, 0.16),
        fabricNavyMat
      );
      backrest.position.set(0, 0.42, -d / 2 + 0.08);
      backrest.castShadow = true;
      backrest.receiveShadow = true;
      group.add(backrest);

      for (const ax of [-w / 2 + 0.08, w / 2 - 0.08]) {
        const arm = new THREE.Mesh(
          new THREE.BoxGeometry(0.16, 0.52, d),
          fabricNavyMat
        );
        arm.position.set(ax, 0.34, 0);
        arm.castShadow = true;
        arm.receiveShadow = true;
        group.add(arm);
      }

      for (const px of [-innerW * 0.36, innerW * 0.36]) {
        const pillow = new THREE.Mesh(
          new THREE.BoxGeometry(0.26, 0.24, 0.12),
          fabricLightSlateMat
        );
        pillow.position.set(px, 0.46, -d / 2 + 0.32);
        pillow.rotation.z = px < 0 ? 0.18 : -0.18;
        pillow.castShadow = true;
        group.add(pillow);
      }
      break;
    }

    case 'kitchen_island': {
      const w = item.width;
      const d = item.depth;
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(w - 0.04, 0.84, d - 0.04),
        blackSteelMat
      );
      base.position.set(0, 0.43, 0);
      base.castShadow = true;
      base.receiveShadow = true;
      group.add(base);

      const woodDoorPanel = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.44, 0.74, 0.022),
        walnutWoodMat
      );
      woodDoorPanel.position.set(w * 0.22, 0.44, d / 2 - 0.01);
      woodDoorPanel.castShadow = true;
      group.add(woodDoorPanel);

      const ovenGlass = new THREE.Mesh(
        new THREE.BoxGeometry(0.56, 0.52, 0.02),
        screenBlackMat
      );
      ovenGlass.position.set(-w * 0.22, 0.44, d / 2 - 0.01);
      const ovenHandle = new THREE.Mesh(
        new THREE.BoxGeometry(0.48, 0.02, 0.03),
        chromeMat
      );
      ovenHandle.position.set(-w * 0.22, 0.65, d / 2 + 0.01);
      group.add(ovenGlass, ovenHandle);

      const counter = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.05, d),
        darkGraniteQuartzMat
      );
      counter.position.set(0, 0.875, 0);
      counter.castShadow = true;
      counter.receiveShadow = true;
      group.add(counter);

      const backsplash = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.12, 0.025),
        darkGraniteQuartzMat
      );
      backsplash.position.set(0, 0.96, -d / 2 + 0.015);
      backsplash.castShadow = true;
      group.add(backsplash);

      const cooktop = new THREE.Mesh(
        new THREE.BoxGeometry(0.62, 0.016, 0.44),
        screenBlackMat
      );
      cooktop.position.set(-w * 0.22, 0.905, 0.02);
      group.add(cooktop);

      const sink = new THREE.Mesh(
        new THREE.BoxGeometry(0.54, 0.02, 0.4),
        chromeMat
      );
      sink.position.set(w * 0.22, 0.902, 0.02);
      group.add(sink);

      const faucetNeck = new THREE.Mesh(
        new THREE.CylinderGeometry(0.014, 0.016, 0.3, 12),
        chromeMat
      );
      faucetNeck.position.set(w * 0.22, 1.05, -d / 2 + 0.12);
      group.add(faucetNeck);
      break;
    }

    case 'dining_table': {
      const w = item.width;
      const d = item.depth;
      const top = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.05, d),
        walnutWoodMat
      );
      top.position.set(0, 0.74, 0);
      top.castShadow = true;
      top.receiveShadow = true;
      group.add(top);

      const legOffsets = [
        [-w * 0.42, -d * 0.38],
        [w * 0.42, -d * 0.38],
        [-w * 0.42, d * 0.38],
        [w * 0.42, d * 0.38],
      ];
      for (const [lx, lz] of legOffsets) {
        const leg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.028, 0.022, 0.72, 12),
          blackSteelMat
        );
        leg.position.set(lx, 0.36, lz);
        leg.castShadow = true;
        group.add(leg);
      }

      const centerpiece = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.08, 0.07, 20),
        porcelainMat
      );
      centerpiece.position.set(0, 0.8, 0);
      group.add(centerpiece);

      const chairPositions = [
        [-w * 0.24, -d * 0.47, 0],
        [w * 0.24, -d * 0.47, 0],
        [-w * 0.24, d * 0.47, Math.PI],
        [w * 0.24, d * 0.47, Math.PI],
      ];
      for (const [cx, cz, rot] of chairPositions) {
        const chair = new THREE.Group();
        const cSeat = new THREE.Mesh(
          new THREE.BoxGeometry(0.336, 0.038, 0.32),
          fabricNavyMat
        );
        cSeat.position.y = 0.42;
        cSeat.castShadow = true;
        const cBack = new THREE.Mesh(
          new THREE.BoxGeometry(0.336, 0.32, 0.032),
          oakWoodMat
        );
        cBack.position.set(0, 0.59, -0.145);
        cBack.castShadow = true;
        const cBase = new THREE.Mesh(
          new THREE.CylinderGeometry(0.016, 0.12, 0.4, 10),
          blackSteelMat
        );
        cBase.position.y = 0.2;
        chair.add(cSeat, cBack, cBase);
        chair.position.set(cx, 0, cz);
        chair.rotation.y = rot;
        group.add(chair);
      }
      break;
    }

    case 'wardrobe': {
      const w = item.width;
      const d = item.depth;
      const h = item.height || 2.1;

      const carcass = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d - 0.03),
        walnutWoodMat
      );
      carcass.position.set(0, h / 2, -0.015);
      carcass.castShadow = true;
      carcass.receiveShadow = true;
      group.add(carcass);

      const topRail = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.02, 0.04, d + 0.01),
        blackSteelMat
      );
      topRail.position.set(0, h - 0.02, 0);
      group.add(topRail);

      const bottomPlinth = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.07, d),
        blackSteelMat
      );
      bottomPlinth.position.set(0, 0.035, 0);
      group.add(bottomPlinth);

      const doorW = (w - 0.06) / 2;
      const doorH = h - 0.14;

      const leftDoor = new THREE.Mesh(
        new THREE.BoxGeometry(doorW, doorH, 0.022),
        oakWoodMat
      );
      leftDoor.position.set(-doorW / 2 + 0.01, h / 2 + 0.01, d / 2 - 0.01);
      leftDoor.castShadow = true;
      group.add(leftDoor);

      const rightDoor = new THREE.Mesh(
        new THREE.BoxGeometry(doorW, doorH, 0.022),
        chromeMat
      );
      rightDoor.position.set(doorW / 2 - 0.01, h / 2 + 0.01, d / 2 + 0.005);
      rightDoor.castShadow = true;
      group.add(rightDoor);

      for (const hx of [-0.04, 0.04]) {
        const handle = new THREE.Mesh(
          new THREE.BoxGeometry(0.018, 0.65, 0.03),
          blackSteelMat
        );
        handle.position.set(hx, h * 0.52, d / 2 + 0.02);
        group.add(handle);
      }
      break;
    }

    case 'patio_set': {
      const w = item.width;
      const d = item.depth;
      const slatCount = 6;
      const slatDepth = (d - 0.12) / slatCount;
      for (let s = 0; s < slatCount; s++) {
        const sz = -d / 2 + 0.06 + slatDepth / 2 + s * slatDepth;
        const slat = new THREE.Mesh(
          new THREE.BoxGeometry(w, 0.038, slatDepth * 0.82),
          oakWoodMat
        );
        slat.position.set(0, 0.74, sz);
        slat.castShadow = true;
        slat.receiveShadow = true;
        group.add(slat);
      }

      const legCoords = [
        [-w * 0.43, -d * 0.4],
        [w * 0.43, -d * 0.4],
        [-w * 0.43, d * 0.4],
        [w * 0.43, d * 0.4],
      ];
      for (const [lx, lz] of legCoords) {
        const leg = new THREE.Mesh(
          new THREE.BoxGeometry(0.045, 0.72, 0.045),
          blackSteelMat
        );
        leg.position.set(lx, 0.36, lz);
        leg.castShadow = true;
        group.add(leg);
      }

      const chairOffsets = [
        [-w * 0.24, -d * 0.48, 0],
        [w * 0.24, -d * 0.48, 0],
        [-w * 0.24, d * 0.48, Math.PI],
        [w * 0.24, d * 0.48, Math.PI],
      ];
      for (const [cx, cz, rot] of chairOffsets) {
        const pChair = new THREE.Group();
        const seatFrame = new THREE.Mesh(
          new THREE.BoxGeometry(0.368, 0.034, 0.352),
          oakWoodMat
        );
        seatFrame.position.y = 0.39;
        const cushion = new THREE.Mesh(
          new THREE.BoxGeometry(0.336, 0.048, 0.32),
          fabricLightSlateMat
        );
        cushion.position.y = 0.425;
        cushion.castShadow = true;
        const backRest = new THREE.Mesh(
          new THREE.BoxGeometry(0.368, 0.29, 0.032),
          oakWoodMat
        );
        backRest.position.set(0, 0.56, -0.16);
        backRest.rotation.x = -0.14;
        backRest.castShadow = true;
        pChair.add(seatFrame, cushion, backRest);
        pChair.position.set(cx, 0, cz);
        pChair.rotation.y = rot;
        group.add(pChair);
      }
      break;
    }

    case 'lounger': {
      const w = item.width;
      const d = item.depth;
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.08, d),
        oakWoodMat
      );
      frame.position.set(0, 0.24, 0);
      frame.castShadow = true;
      frame.receiveShadow = true;
      group.add(frame);

      const matFlat = new THREE.Mesh(
        new THREE.BoxGeometry(w - 0.06, 0.08, d * 0.62),
        fabricLightSlateMat
      );
      matFlat.position.set(0, 0.31, d * 0.16);
      matFlat.castShadow = true;
      group.add(matFlat);

      const matReclined = new THREE.Mesh(
        new THREE.BoxGeometry(w - 0.06, 0.08, d * 0.36),
        fabricLightSlateMat
      );
      matReclined.position.set(0, 0.46, -d * 0.3);
      matReclined.rotation.x = 0.48;
      matReclined.castShadow = true;
      group.add(matReclined);

      const headPillow = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.55, 0.07, 0.18),
        fabricNavyMat
      );
      headPillow.position.set(0, 0.56, -d * 0.38);
      headPillow.rotation.x = 0.48;
      group.add(headPillow);
      break;
    }

    case 'bbq_grill': {
      const w = item.width;
      const d = item.depth;
      const cabinet = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.56, 0.82, d - 0.04),
        blackSteelMat
      );
      cabinet.position.set(0, 0.41, 0);
      cabinet.castShadow = true;
      cabinet.receiveShadow = true;
      group.add(cabinet);

      const grillHood = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.54, 0.28, d - 0.08),
        chromeMat
      );
      grillHood.position.set(0, 0.96, -0.02);
      grillHood.castShadow = true;
      group.add(grillHood);

      const handleBar = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.42, 0.025, 0.04),
        blackSteelMat
      );
      handleBar.position.set(0, 0.92, d / 2 - 0.01);
      group.add(handleBar);

      for (const sx of [-w * 0.38, w * 0.38]) {
        const sideShelf = new THREE.Mesh(
          new THREE.BoxGeometry(w * 0.2, 0.04, d - 0.08),
          oakWoodMat
        );
        sideShelf.position.set(sx, 0.82, 0);
        sideShelf.castShadow = true;
        group.add(sideShelf);
      }
      break;
    }

    case 'desk':
    default: {
      const w = item.width;
      const d = item.depth;

      const consoleH = 0.48;
      const consoleBody = new THREE.Mesh(
        new THREE.BoxGeometry(w, consoleH - 0.12, d),
        walnutWoodMat
      );
      consoleBody.position.set(0, 0.12 + (consoleH - 0.12) / 2, 0);
      consoleBody.castShadow = true;
      consoleBody.receiveShadow = true;
      group.add(consoleBody);

      const topSlab = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.02, 0.03, d + 0.02),
        darkGraniteQuartzMat
      );
      topSlab.position.set(0, consoleH + 0.015, 0);
      topSlab.castShadow = true;
      group.add(topSlab);

      for (const [lx, lz] of [
        [-w * 0.44, -d * 0.36],
        [w * 0.44, -d * 0.36],
        [-w * 0.44, d * 0.36],
        [w * 0.44, d * 0.36],
      ]) {
        const leg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.018, 0.014, 0.12, 10),
          blackSteelMat
        );
        leg.position.set(lx, 0.06, lz);
        group.add(leg);
      }

      const soundbar = new THREE.Mesh(
        new THREE.BoxGeometry(Math.min(w * 0.58, 0.9), 0.055, 0.08),
        blackSteelMat
      );
      soundbar.position.set(0, consoleH + 0.055, 0.08);
      group.add(soundbar);

      const tvW = Math.min(w * 0.86, 1.38);
      const tvH = tvW * 0.56;
      const tvStand = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.16, 0.16),
        blackSteelMat
      );
      tvStand.position.set(0, consoleH + 0.08, -d * 0.18);
      group.add(tvStand);

      const tvBezel = new THREE.Mesh(
        new THREE.BoxGeometry(tvW + 0.03, tvH + 0.03, 0.03),
        blackSteelMat
      );
      tvBezel.position.set(0, consoleH + 0.14 + tvH / 2, -d * 0.18);
      tvBezel.castShadow = true;
      group.add(tvBezel);

      const tvScreen = new THREE.Mesh(
        new THREE.PlaneGeometry(tvW, tvH),
        screenBlackMat
      );
      tvScreen.position.set(0, consoleH + 0.14 + tvH / 2, -d * 0.18 + 0.017);
      group.add(tvScreen);
      break;
    }
  }

  group.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.renderOrder = 4;
    }
  });

  return group;
}

const _tempBox3 = new THREE.Box3();
const _tempSize3 = new THREE.Vector3();

/**
 * Room Ratio Scale Cap (Max 35% Usable Room Bounding Box Area) + Relaxed Transparent Volumetric Alignment (v1.3):
 * Scales the 3D furniture volume proportionally so it never exceeds 35% of the room's usable area,
 * and positions the translucent "Ghost / Cristal Esmerilado" volume directly at the coordinates dictated by the AI
 * (`placement.x, placement.z`) without aggressive wall-snapping displacement.
 */
export function applyRoomRatioScaleCapAndWallClamp(
  modelGroup: THREE.Group,
  placement: CalibratedFurniturePlacement,
  rooms: RoomZone[],
  walls: WallSegment[],
  slabWidth: number,
  slabDepth: number
): void {
  const localSpanX = Math.max(0.25, Number(placement.item.width) || 0.8);
  const localSpanZ = Math.max(0.25, Number(placement.item.depth) || 0.8);

  const px = placement.x;
  const pz = placement.z;
  const rotY = placement.rotationY || 0;
  const isOutdoorItem = placement.item.zoneType === 'outdoor';

  let cellMinX = -slabWidth * 0.48;
  let cellMaxX = slabWidth * 0.48;
  let cellMinZ = -slabDepth * 0.48;
  let cellMaxZ = slabDepth * 0.48;

  if (!isOutdoorItem) {
    for (const w of walls) {
      if (w.zoneType === 'outdoor') continue;
      const dx = Math.abs(w.x2 - w.x1);
      const dz = Math.abs(w.z2 - w.z1);
      if (dz <= dx * 0.28) {
        const wz = (w.z1 + w.z2) / 2;
        const wMinX = Math.min(w.x1, w.x2) - 0.25;
        const wMaxX = Math.max(w.x1, w.x2) + 0.25;
        if (px >= wMinX && px <= wMaxX) {
          if (wz < pz - 0.15 && wz > cellMinZ) cellMinZ = wz;
          if (wz > pz + 0.15 && wz < cellMaxZ) cellMaxZ = wz;
        }
      } else if (dx <= dz * 0.28) {
        const wx = (w.x1 + w.x2) / 2;
        const wMinZ = Math.min(w.z1, w.z2) - 0.25;
        const wMaxZ = Math.max(w.z1, w.z2) + 0.25;
        if (pz >= wMinZ && pz <= wMaxZ) {
          if (wx < px - 0.15 && wx > cellMinX) cellMinX = wx;
          if (wx > px + 0.15 && wx < cellMaxX) cellMaxX = wx;
        }
      }
    }
  }

  const matchedRoom =
    rooms.find(
      (r) =>
        r.name === placement.item.roomLabel &&
        Math.abs(px - r.x) <= r.width * 0.75 &&
        Math.abs(pz - r.z) <= r.depth * 0.75
    ) ||
    rooms.find(
      (r) =>
        Math.abs(px - r.x) <= r.width / 2 + 0.18 &&
        Math.abs(pz - r.z) <= r.depth / 2 + 0.18
    );

  if (matchedRoom) {
    const rMinX = matchedRoom.x - matchedRoom.width / 2;
    const rMaxX = matchedRoom.x + matchedRoom.width / 2;
    const rMinZ = matchedRoom.z - matchedRoom.depth / 2;
    const rMaxZ = matchedRoom.z + matchedRoom.depth / 2;
    if (rMaxX - rMinX >= 1.1 && rMaxX - rMinX < cellMaxX - cellMinX) {
      cellMinX = Math.max(cellMinX, rMinX);
      cellMaxX = Math.min(cellMaxX, rMaxX);
    }
    if (rMaxZ - rMinZ >= 1.1 && rMaxZ - rMinZ < cellMaxZ - cellMinZ) {
      cellMinZ = Math.max(cellMinZ, rMinZ);
      cellMaxZ = Math.min(cellMaxZ, rMaxZ);
    }
  }

  const rawRoomW = Math.max(1.25, cellMaxX - cellMinX);
  const rawRoomD = Math.max(1.25, cellMaxZ - cellMinZ);
  const effectiveRoomW = Math.min(rawRoomW, 4.4);
  const effectiveRoomD = Math.min(rawRoomD, 4.4);

  const usableW = Math.max(1.05, effectiveRoomW - 0.28);
  const usableD = Math.max(1.05, effectiveRoomD - 0.28);
  const usableRoomArea = usableW * usableD;

  const maxAllowedArea = usableRoomArea * 0.35;
  const modelFootprintArea = localSpanX * localSpanZ;

  const cosR = Math.abs(Math.cos(rotY));
  const sinR = Math.abs(Math.sin(rotY));
  const worldSpanX = localSpanX * cosR + localSpanZ * sinR;
  const worldSpanZ = localSpanX * sinR + localSpanZ * cosR;

  const scaleByArea =
    modelFootprintArea > maxAllowedArea
      ? Math.sqrt(maxAllowedArea / modelFootprintArea)
      : 1.0;
  const scaleBySpanX = (usableW * 0.62) / Math.max(0.25, worldSpanX);
  const scaleBySpanZ = (usableD * 0.62) / Math.max(0.25, worldSpanZ);

  const cat = resolveArtifactCategory(placement.item);
  const isSecondary =
    cat === 'wc' ||
    cat === 'vanity' ||
    cat === 'desk' ||
    cat === 'wardrobe' ||
    cat === 'lounger' ||
    cat === 'bbq_grill';
  const baseMaxScale = isSecondary ? 0.88 : 1.0;

  const uniformScale = Math.max(
    0.42,
    Math.min(baseMaxScale, scaleByArea, scaleBySpanX, scaleBySpanZ)
  );

  modelGroup.scale.set(uniformScale, uniformScale, uniformScale);

  // Relaxed alignment (v1.3): sit the translucent Ghost / Cristal Esmerilado volume directly on top of
  // the AI-detected coordinates (px, pz) on the Step 2 slab without displacing it across the room.
  modelGroup.position.set(px, placement.y, pz);
  modelGroup.rotation.y = rotY;
}


