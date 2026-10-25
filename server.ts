import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '25mb' }));

function getGenAIClient() {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function handleImageToImageFloorPlanRender(
  req: express.Request,
  res: express.Response
) {
  try {
    const { renderType, stylePrompt, imageDataUrl, currentBlueprint } = req.body;

    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({
        code: 'SERVICE_UNAVAILABLE',
        userMessage:
          'Los servidores de Gemini están experimentando alta demanda momentánea',
      });
    }

    const ai = getGenAIClient();

    const parts: any[] = [];
    if (
      imageDataUrl &&
      typeof imageDataUrl === 'string' &&
      imageDataUrl.includes('base64,')
    ) {
      const [header, base64Data] = imageDataUrl.split('base64,');
      const mimeMatch = header.match(/data:(.*?);/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
      parts.push({
        inlineData: {
          mimeType,
          data: base64Data,
        },
      });
    } else {
      return res.status(400).json({
        code: 'MISSING_BLUEPRINT_IMAGE',
        userMessage:
          'No se recibió la imagen limpia del plano 2D desde el Paso 1 para generar el render CGI.',
      });
    }

    const technicalPrompt = [
      'Transforma este plano arquitectónico 2D en una imagen CGI de alta resolución respetando estrictamente la geometría, proporción y distribución exacta de los muros y recintos del plano adjunto:',
      '• Genera un render de planta arquitectónica 3D cenital (90° top-down / aerial floor plan render) de estilo comercial inmobiliario fotorrealista.',
      '• Estructura: Muros cortados a media altura en tono negro mate con espesor realista. En los muros perimetrales/fachada representa ventanas y ventanales correderos con antepecho y cristal, reservando únicamente 1 o 2 puertas exteriores reales para el acceso peatonal principal y/o de servicio.',
      '• Materiales: Suelos de parquet de roble cálido en salones y dormitorios; porcelanato o cerámico blanco reticulado en baños y cocina; terraza exterior de deck de madera o piedra natural.',
      '• Amoblado 3D realista sin duplicados: Muebles y sanitarios de alta calidad vistos desde arriba (camas con ropa de cama adosadas al muro cabecero, sofás textiles, mesa de comedor amoblada, cocina equipada). En cada baño estándar coloca exactamente 1 WC (con estanque adosado al muro), 1 vanitorio lavamanos adosado al muro y 1 ducha/tina (PROHIBIDO duplicar WCs, vanitorios o camas dentro de un mismo recinto).',
      '• Iluminación y Sombras: Iluminación ambiental uniforme de 90° con sombras suaves arrojadas (soft ambient occlusion) debajo de muros y muebles que aporten tridimensionalidad real sobre el suelo.',
      '• Perímetro: Césped verde natural, senderos de piedra y vegetación 3D en las zonas exteriores.',
      stylePrompt ? `• Directrices adicionales de estilo: ${stylePrompt}` : '',
      'No incluyas textos superpuestos distorsionados ni marcas de diagnóstico de colores; entrega exclusivamente el render arquitectónico 3D cenital fotorrealista.',
    ]
      .filter(Boolean)
      .join('\n');

    parts.push({ text: technicalPrompt });

    let renderedImageUrl: string | null = null;
    let modelTextNote = '';
    let lastError: any = null;

    // Match the generated CGI image aspect ratio to the uploaded blueprint's real Width / Height ratio
    const bpW = Number(currentBlueprint?.totalWidth) || 12;
    const bpD = Number(currentBlueprint?.totalDepth) || 9;
    const bpRatio = bpW / Math.max(0.1, bpD);
    const supportedRatios: Array<{ label: string; value: number }> = [
      { label: '1:1', value: 1.0 },
      { label: '4:3', value: 4 / 3 },
      { label: '3:4', value: 3 / 4 },
      { label: '16:9', value: 16 / 9 },
      { label: '9:16', value: 9 / 16 },
    ];
    let bestAspectRatio = '4:3';
    let minRatioDiff = Infinity;
    for (const candidate of supportedRatios) {
      const diff = Math.abs(candidate.value - bpRatio);
      if (diff < minRatioDiff) {
        minRatioDiff = diff;
        bestAspectRatio = candidate.label;
      }
    }

    // Primary high-resolution Image-to-Image model ('gemini-nano-banana-2.1') with automatic fallback to 'gemini-3.1-flash-lite-image'
    const modelsToTry: Array<{
      name: string;
      imageConfig: { aspectRatio: string; imageSize?: string };
    }> = [
      {
        name: 'gemini-nano-banana-2.1',
        imageConfig: { aspectRatio: bestAspectRatio, imageSize: '2K' },
      },
      {
        name: 'gemini-3.1-flash-lite-image',
        imageConfig: { aspectRatio: bestAspectRatio },
      },
    ];

    for (const modelSpec of modelsToTry) {
      try {
        const response = await ai.models.generateContent({
          model: modelSpec.name,
          contents: { parts },
          config: {
            imageConfig: modelSpec.imageConfig,
          },
        });

        const candidateParts =
          response.candidates?.[0]?.content?.parts || [];
        for (const part of candidateParts) {
          if (part.inlineData?.data) {
            const outMime = part.inlineData.mimeType || 'image/png';
            renderedImageUrl = `data:${outMime};base64,${part.inlineData.data}`;
          } else if (part.text) {
            modelTextNote += part.text + ' ';
          }
        }

        if (renderedImageUrl) {
          break;
        }
      } catch (err: any) {
        lastError = err;
      }
    }

    if (!renderedImageUrl) {
      throw (
        lastError ||
        new Error('El modelo de IA no devolvió una imagen CGI renderizada.')
      );
    }

    const updatedBlueprint = currentBlueprint
      ? {
          ...currentBlueprint,
          renderType: renderType || currentBlueprint.renderType || 'interior',
        }
      : undefined;

    return res.json({
      renderedImageUrl,
      blueprint: updatedBlueprint,
      summary:
        modelTextNote.trim() ||
        'Render CGI de Planta Arquitectónica 3D Cenital (90° Top-Down) generado en alta resolución.',
    });
  } catch (error: any) {
    console.error('Gemini Image-to-Image CGI error:', error);
    const rawMsg = String(error?.message || error || '');
    const isOverloaded =
      error?.status === 503 ||
      error?.status === 429 ||
      /503|429|overloaded|unavailable|quota|resource_exhausted|high demand/i.test(
        rawMsg
      );

    return res.status(isOverloaded ? 503 : 500).json({
      code: isOverloaded ? 'MODEL_OVERLOADED' : 'AI_PROCESSING_ERROR',
      userMessage:
        'Los servidores de Gemini están experimentando alta demanda momentánea',
    });
  }
}

/**
 * Converts Step 1 structural blueprint walls into the normalized 0..1000 integer grid
 * where (0,0) is top-left and (1000,1000) is bottom-right.
 */
function buildLockedStep1GridWalls(
  currentBlueprint: any,
  slabWidth: number,
  slabDepth: number
) {
  const bpW = Math.max(0.1, Number(currentBlueprint?.totalWidth) || slabWidth || 12);
  const bpD = Math.max(0.1, Number(currentBlueprint?.totalDepth) || slabDepth || 9);

  const toGrid1000X = (xMeters: number) =>
    Math.max(
      0,
      Math.min(1000, Math.round(((Number(xMeters) || 0) / bpW + 0.5) * 1000))
    );
  const toGrid1000Z = (zMeters: number) =>
    Math.max(
      0,
      Math.min(1000, Math.round(((Number(zMeters) || 0) / bpD + 0.5) * 1000))
    );

  const rawWalls = Array.isArray(currentBlueprint?.walls)
    ? currentBlueprint.walls
    : [];

  const mappedWalls = rawWalls.map((w: any, idx: number) => ({
    id: String(w.id || `step1-wall-${idx}`),
    x1: toGrid1000X(w.x1),
    z1: toGrid1000Z(w.z1),
    x2: toGrid1000X(w.x2),
    z2: toGrid1000Z(w.z2),
    height: Number(w.height) || 2.6,
    thickness: 0.15,
    isExterior: Boolean(w.isExterior),
    zoneType: (w.zoneType === 'outdoor' ? 'outdoor' : 'indoor') as
      | 'indoor'
      | 'outdoor',
    openings: Array.isArray(w.openings)
      ? w.openings.map((op: any, opIdx: number) => ({
          id: String(op.id || `step1-op-${idx}-${opIdx}`),
          wallId: String(w.id || `step1-wall-${idx}`),
          type:
            op.type === 'window'
              ? 'window'
              : op.type === 'passage'
                ? 'passage'
                : 'door',
          offsetRatio: Number(
            Math.max(0.12, Math.min(0.88, Number(op.offsetRatio) || 0.5)).toFixed(3)
          ),
          width: Number(op.width) || (op.type === 'window' ? 1.35 : 0.85),
          height: Number(op.height) || (op.type === 'window' ? 1.2 : 2.05),
          sillHeight:
            op.type === 'window'
              ? Math.max(0.9, Math.min(1.0, Number(op.sillHeight) || 0.95))
              : 0,
        }))
      : [],
  }));

  let exteriorDoorCount = 0;
  for (const w of mappedWalls) {
    if (!w.isExterior || !Array.isArray(w.openings)) continue;
    for (const op of w.openings) {
      if (op.type === 'window') {
        op.sillHeight = Math.max(0.9, Math.min(1.0, Number(op.sillHeight) || 0.95));
        op.height = Number(Math.max(1.05, Math.min(1.35, Number(op.height) || 1.2)).toFixed(2));
      } else {
        const isReasonableDoorW = Number(op.width) >= 0.75 && Number(op.width) <= 0.96;
        // Strict Exterior Opening Correction: Only 1 main entrance door on the perimeter; all other exterior openings become windows with sillHeight: 0.95
        if (exteriorDoorCount < 1 && isReasonableDoorW) {
          exteriorDoorCount++;
          op.type = 'door';
          op.width = Number(Math.max(0.8, Math.min(0.9, Number(op.width) || 0.88)).toFixed(2));
          op.height = 2.05;
          op.sillHeight = 0;
        } else {
          op.type = 'window';
          op.width = Number(Math.max(1.1, Math.min(1.65, Number(op.width) || 1.35)).toFixed(2));
          op.height = 1.2;
          op.sillHeight = 0.95;
        }
      }
    }
  }

  return mappedWalls;
}

function isOutdoorKeyword(text: string): boolean {
  return /outdoor|exterior|terraza|terrace|patio|deck|jardin|garden|quincho|parrilla|bbq|pergola|balcon|solarium|piscina|pool|reposera|lounger/i.test(
    text
  );
}

/**
 * Builds normalized 0..1000 zones from Step 1 rooms + AI-detected zones,
 * classifying each zone as "indoor" or "outdoor".
 */
function buildNormalizedZones(
  rawZones: any[],
  currentBlueprint: any,
  slabWidth: number,
  slabDepth: number,
  clampGrid1000: (val: any, fallback?: number) => number
): Array<{
  id: string;
  name: string;
  zoneType: 'indoor' | 'outdoor';
  surfaceMaterial: 'deck' | 'grass' | 'stone' | 'wood' | 'porcelain';
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}> {
  const bpW = Math.max(0.1, Number(currentBlueprint?.totalWidth) || slabWidth || 12);
  const bpD = Math.max(0.1, Number(currentBlueprint?.totalDepth) || slabDepth || 9);

  const toGrid1000X = (xMeters: number) =>
    Math.max(
      0,
      Math.min(1000, Math.round(((Number(xMeters) || 0) / bpW + 0.5) * 1000))
    );
  const toGrid1000Z = (zMeters: number) =>
    Math.max(
      0,
      Math.min(1000, Math.round(((Number(zMeters) || 0) / bpD + 0.5) * 1000))
    );

  if (Array.isArray(rawZones) && rawZones.length > 0) {
    return rawZones.map((z: any, idx: number) => {
      const name = String(z.name || `Zona ${idx + 1}`);
      const rawZoneType = String(z.zoneType || '').toLowerCase();
      const zoneType: 'indoor' | 'outdoor' =
        rawZoneType === 'outdoor' || isOutdoorKeyword(name)
          ? 'outdoor'
          : 'indoor';

      const x1 = clampGrid1000(z.minX ?? z.x1, 100);
      const z1 = clampGrid1000(z.minZ ?? z.z1, 100);
      const x2 = clampGrid1000(z.maxX ?? z.x2, 900);
      const z2 = clampGrid1000(z.maxZ ?? z.z2, 900);

      const rawSurf = String(z.surfaceMaterial || '').toLowerCase();
      let surfaceMaterial: 'deck' | 'grass' | 'stone' | 'wood' | 'porcelain' =
        zoneType === 'outdoor' ? 'deck' : 'wood';
      if (/grass|cesped|jardin|pasto/.test(rawSurf + ' ' + name)) {
        surfaceMaterial = 'grass';
      } else if (/stone|piedra|adocreto/.test(rawSurf + ' ' + name)) {
        surfaceMaterial = 'stone';
      } else if (/deck|terraza/.test(rawSurf + ' ' + name)) {
        surfaceMaterial = 'deck';
      } else if (/porcelain|porcelanato|ceramico|tile|baño|cocina/.test(rawSurf + ' ' + name)) {
        surfaceMaterial = 'porcelain';
      }

      return {
        id: String(z.id || `zone-${idx}`),
        name,
        zoneType,
        surfaceMaterial,
        minX: Math.min(x1, x2),
        minZ: Math.min(z1, z2),
        maxX: Math.max(x1, x2),
        maxZ: Math.max(z1, z2),
      };
    });
  }

  const bpRooms = Array.isArray(currentBlueprint?.rooms)
    ? currentBlueprint.rooms
    : [];

  return bpRooms.map((r: any, idx: number) => {
    const name = String(r.name || `Recinto ${idx + 1}`);
    const zoneType: 'indoor' | 'outdoor' =
      r.zoneType === 'outdoor' ||
      r.type === 'terrace' ||
      isOutdoorKeyword(name)
        ? 'outdoor'
        : 'indoor';

    const cx = Number(r.x) || 0;
    const cz = Number(r.z) || 0;
    const hw = (Number(r.width) || 3) / 2;
    const hd = (Number(r.depth) || 3) / 2;

    return {
      id: String(r.id || `room-zone-${idx}`),
      name,
      zoneType,
      surfaceMaterial: (zoneType === 'outdoor'
        ? /jardin|cesped|pasto/i.test(name)
          ? 'grass'
          : 'deck'
        : r.floorMaterial === 'porcelain'
          ? 'porcelain'
          : 'wood') as 'deck' | 'grass' | 'stone' | 'wood' | 'porcelain',
      minX: toGrid1000X(cx - hw),
      minZ: toGrid1000Z(cz - hd),
      maxX: toGrid1000X(cx + hw),
      maxZ: toGrid1000Z(cz + hd),
    };
  });
}

/**
 * Normalizes Gemini Vision (T=0.0) output strictly onto the 0..1000 Integer Grid
 * and enforces Geometry Lock + Indoor/Outdoor Zoning:
 * - Prohibits inventing random new walls: locks the 3D wall skeleton 100% to Step 1's validated walls.
 * - Classifies each room/zone and furniture item with `zoneType: "indoor" | "outdoor"`.
 * - Marks perimeter walls that exclusively enclose an "outdoor" zone as `zoneType: "outdoor"` so
 *   Interior3DViewer suppresses raising enclosing walls around outdoor terraces/patios/gardens.
 */
function normalizeSpatialReconstructionCoordinates(
  rawJson: any,
  slabWidth: number,
  slabDepth: number,
  currentBlueprint: any
) {
  const lockedWalls = buildLockedStep1GridWalls(
    currentBlueprint,
    slabWidth,
    slabDepth
  );

  const aiWalls: any[] = Array.isArray(rawJson?.walls) ? rawJson.walls : [];
  const aiZones: any[] = Array.isArray(rawJson?.zones)
    ? rawJson.zones
    : Array.isArray(rawJson?.rooms)
      ? rawJson.rooms
      : [];
  const aiOpeningsFlat: any[] = Array.isArray(rawJson?.openings)
    ? rawJson.openings
    : [];
  const furniture: any[] = Array.isArray(rawJson?.furniture)
    ? rawJson.furniture
    : [];

  const clampGrid1000 = (val: any, fallback = 500): number => {
    const n = Number(val);
    if (!Number.isFinite(n)) return fallback;
    // If Gemini returned 0..1 float, scale to 0..1000 integer
    if (Math.abs(n) <= 1.05 && n >= 0 && fallback !== 0) {
      return Math.max(0, Math.min(1000, Math.round(n * 1000)));
    }
    return Math.max(0, Math.min(1000, Math.round(n)));
  };

  const normalizedZones = buildNormalizedZones(
    aiZones,
    currentBlueprint,
    slabWidth,
    slabDepth,
    clampGrid1000
  );

  // Propagate AI wall zoneType ('outdoor') onto matching locked Step 1 walls
  for (const aw of aiWalls) {
    if (!aw) continue;
    const isAiOutdoor =
      String(aw.zoneType || '').toLowerCase() === 'outdoor';
    if (!isAiOutdoor) continue;

    const target = lockedWalls.find((lw: any) => lw.id === String(aw.id || ''));
    if (target) {
      target.zoneType = 'outdoor';
    }
  }

  // Collect all candidate openings detected by Gemini Vision (from walls[].openings or top-level openings[])
  interface CandidateOpening {
    wallId?: string;
    type: 'door' | 'window' | 'passage';
    x?: number;
    z?: number;
    offsetRatio?: number;
    width?: number;
    height?: number;
    sillHeight?: number;
  }

  const detectedOpenings: CandidateOpening[] = [];

  for (const op of aiOpeningsFlat) {
    if (!op) continue;
    detectedOpenings.push({
      wallId: op.wallId ? String(op.wallId) : undefined,
      type:
        op.type === 'window'
          ? 'window'
          : op.type === 'passage'
            ? 'passage'
            : 'door',
      x: op.x !== undefined ? clampGrid1000(op.x) : undefined,
      z: op.z !== undefined ? clampGrid1000(op.z) : undefined,
      offsetRatio:
        op.offsetRatio !== undefined ? Number(op.offsetRatio) : undefined,
      width: op.width !== undefined ? Number(op.width) : undefined,
      height: op.height !== undefined ? Number(op.height) : undefined,
      sillHeight:
        op.sillHeight !== undefined ? Number(op.sillHeight) : undefined,
    });
  }

  for (const aw of aiWalls) {
    if (!aw || !Array.isArray(aw.openings)) continue;
    const wx1 = clampGrid1000(aw.x1, 0);
    const wz1 = clampGrid1000(aw.z1, 0);
    const wx2 = clampGrid1000(aw.x2, 0);
    const wz2 = clampGrid1000(aw.z2, 0);

    for (const op of aw.openings) {
      if (!op) continue;
      const rawRatio = Number(op.offsetRatio);
      const ratio = Number.isFinite(rawRatio)
        ? Math.max(0.12, Math.min(0.88, rawRatio > 1 ? rawRatio / 1000 : rawRatio))
        : 0.5;
      const opX =
        op.x !== undefined
          ? clampGrid1000(op.x)
          : Math.round(wx1 + (wx2 - wx1) * ratio);
      const opZ =
        op.z !== undefined
          ? clampGrid1000(op.z)
          : Math.round(wz1 + (wz2 - wz1) * ratio);

      detectedOpenings.push({
        wallId: op.wallId || aw.id ? String(op.wallId || aw.id) : undefined,
        type:
          op.type === 'window'
            ? 'window'
            : op.type === 'passage'
              ? 'passage'
              : 'door',
        x: opX,
        z: opZ,
        offsetRatio: ratio,
        width: op.width !== undefined ? Number(op.width) : undefined,
        height: op.height !== undefined ? Number(op.height) : undefined,
        sillHeight:
          op.sillHeight !== undefined ? Number(op.sillHeight) : undefined,
      });
    }
  }

  // Project detected openings strictly onto the locked Step 1 walls (Geometry Lock)
  if (lockedWalls.length > 0 && detectedOpenings.length > 0) {
    const calibratedByWall = new Map<string, any[]>();

    for (let opIdx = 0; opIdx < detectedOpenings.length; opIdx++) {
      const cand = detectedOpenings[opIdx];
      let targetWall = cand.wallId
        ? lockedWalls.find((lw: any) => lw.id === cand.wallId)
        : undefined;
      let bestRatio = cand.offsetRatio ?? 0.5;

      if (!targetWall && cand.x !== undefined && cand.z !== undefined) {
        let bestDist = Infinity;
        for (const lw of lockedWalls) {
          const dx = lw.x2 - lw.x1;
          const dz = lw.z2 - lw.z1;
          const lenSq = dx * dx + dz * dz;
          if (lenSq < 100) continue;
          const t = Math.max(
            0.14,
            Math.min(0.86, ((cand.x - lw.x1) * dx + (cand.z - lw.z1) * dz) / lenSq)
          );
          const projX = lw.x1 + t * dx;
          const projZ = lw.z1 + t * dz;
          const dist = Math.hypot(cand.x - projX, cand.z - projZ);
          if (dist < bestDist && dist <= 95) {
            bestDist = dist;
            targetWall = lw;
            bestRatio = t;
          }
        }
      }

      if (targetWall) {
        const list = calibratedByWall.get(targetWall.id) || [];
        const normRatio = Number(
          Math.max(0.14, Math.min(0.86, bestRatio)).toFixed(3)
        );
        // Avoid duplicate openings at the same offset on the same wall
        if (list.every((existing) => Math.abs(existing.offsetRatio - normRatio) >= 0.16)) {
          const isWin = cand.type === 'window';
          list.push({
            id: `ai-op-${targetWall.id}-${opIdx}`,
            wallId: targetWall.id,
            type: cand.type,
            x: Math.round(
              targetWall.x1 + (targetWall.x2 - targetWall.x1) * normRatio
            ),
            z: Math.round(
              targetWall.z1 + (targetWall.z2 - targetWall.z1) * normRatio
            ),
            offsetRatio: normRatio,
            width: Number(
              Math.max(
                0.55,
                Math.min(2.2, cand.width || (isWin ? 1.35 : 0.85))
              ).toFixed(2)
            ),
            height: Number(
              Math.max(
                0.6,
                Math.min(2.3, cand.height || (isWin ? 1.25 : 2.05))
              ).toFixed(2)
            ),
            sillHeight: Number(
              Math.max(
                0,
                Math.min(
                  1.2,
                  cand.sillHeight !== undefined
                    ? cand.sillHeight
                    : isWin
                      ? 0.9
                      : 0
                )
              ).toFixed(2)
            ),
          });
          calibratedByWall.set(targetWall.id, list);
        }
      }
    }

    for (const lw of lockedWalls) {
      const calibrated = calibratedByWall.get(lw.id);
      if (calibrated && calibrated.length > 0) {
        lw.openings = calibrated;
      }
    }
  }

  const validTypes = new Set([
    'sofa',
    'bed',
    'table',
    'wc',
    'vanity',
    'kitchen',
    'shower',
    'wardrobe',
    'desk',
    'patio_set',
    'lounger',
    'bbq_grill',
  ]);

  const normalizedFurniture = furniture.map((f, idx) => {
    const rawType = String(f.type || '').toLowerCase();
    let type = validTypes.has(rawType) ? rawType : 'desk';
    const label = `${rawType} ${f.name || ''} ${f.roomLabel || ''}`.toLowerCase();
    if (/patio_set|juego de terraza|mesa exterior|terraza|comedor exterior|outdoor table/.test(label))
      type = 'patio_set';
    else if (/lounger|reposera|tumbona|camastro|solarium/.test(label))
      type = 'lounger';
    else if (/bbq|grill|parrilla|quincho|asador/.test(label))
      type = 'bbq_grill';
    else if (/sofa|sillon|living|couch/.test(label)) type = 'sofa';
    else if (/bed|cama|dormitorio|colchon|mattress/.test(label)) type = 'bed';
    else if (/table|comedor|dining|mesa/.test(label)) type = 'table';
    else if (/wc|toilet|inodoro|sanitario|taza/.test(label)) type = 'wc';
    else if (/vanity|vanitorio|lavamanos|sink|lavabo/.test(label))
      type = 'vanity';
    else if (/kitchen|cocina|meson|counter|island|isla|stove/.test(label))
      type = 'kitchen';
    else if (/shower|ducha|bathtub|tina|bañera/.test(label)) type = 'shower';
    else if (/wardrobe|closet|armario|ropero/.test(label)) type = 'wardrobe';

    // Convert degrees to radians if Gemini returned degrees (> 2*PI)
    let rotY = Number(f.rotationY) || 0;
    if (Math.abs(rotY) > Math.PI * 2 + 0.01) {
      rotY = (rotY * Math.PI) / 180;
    }

    const gridX = clampGrid1000(f.x, 500);
    const gridZ = clampGrid1000(f.z, 500);

    // Determine if this furniture item is in an outdoor zone
    const inOutdoorZone = normalizedZones.some(
      (z) =>
        z.zoneType === 'outdoor' &&
        gridX >= z.minX - 25 &&
        gridX <= z.maxX + 25 &&
        gridZ >= z.minZ - 25 &&
        gridZ <= z.maxZ + 25
    );

    const rawZoneType = String(f.zoneType || '').toLowerCase();
    const zoneType: 'indoor' | 'outdoor' =
      rawZoneType === 'outdoor' ||
      type === 'patio_set' ||
      type === 'lounger' ||
      type === 'bbq_grill' ||
      inOutdoorZone ||
      isOutdoorKeyword(label)
        ? 'outdoor'
        : 'indoor';

    const rawW = Number(f.width) || 120;
    const rawD = Number(f.depth) || 95;
    const gridWidth =
      rawW > 10
        ? Math.max(30, Math.min(350, Math.round(rawW)))
        : Math.max(30, Math.min(350, Math.round((rawW / Math.max(1, slabWidth)) * 1000)));
    const gridDepth =
      rawD > 10
        ? Math.max(30, Math.min(350, Math.round(rawD)))
        : Math.max(30, Math.min(350, Math.round((rawD / Math.max(1, slabDepth)) * 1000)));

    return {
      id: String(f.id || `ai-furn-${idx}`),
      type,
      name: String(f.name || `Mobiliario ${type.toUpperCase()}`),
      zoneType,
      x: gridX,
      y: 0.03,
      z: gridZ,
      rotationY: Number(rotY.toFixed(4)),
      width: gridWidth,
      height: Number(
        Math.max(0.4, Math.min(2.2, Number(f.height) || 0.8)).toFixed(2)
      ),
      depth: gridDepth,
      roomLabel: f.roomLabel ? String(f.roomLabel) : undefined,
    };
  });

  // Strict Anti-Duplicate Filter (Centroid Fusion within < 1.2m or same standard room bounding box):
  // Prohibits placing 2 artifacts of the same type (e.g. 2 WCs, 2 vanities, 2 showers, 2 master beds)
  // in the same room or within a radius < 1.2m unless the zone is explicitly a double bathroom or shared twin bedroom.
  const findZoneForGridPoint = (gx: number, gz: number, roomLabel?: string) => {
    if (roomLabel) {
      const byLabel = normalizedZones.find(
        (z) => z.name.toLowerCase() === roomLabel.toLowerCase()
      );
      if (byLabel) return byLabel;
    }
    return normalizedZones.find(
      (z) =>
        gx >= z.minX - 25 &&
        gx <= z.maxX + 25 &&
        gz >= z.minZ - 25 &&
        gz <= z.maxZ + 25
    );
  };

  const allowsMultipleOfSameType = (
    type: string,
    zoneName: string,
    itemLabel: string
  ): boolean => {
    const combined = `${zoneName} ${itemLabel}`.toLowerCase();
    if (type === 'wc' || type === 'vanity' || type === 'shower') {
      return /(baño|bano|bath|tocador|vanitorio|suite).*(doble|double|dual)/i.test(
        combined
      );
    }
    if (type === 'bed') {
      return /(dormitorio|habitacion|bedroom|cuarto|cama).*(compartid|doble|twin|shared|gemel|dos camas|2 camas)/i.test(
        combined
      );
    }
    if (type === 'lounger') {
      return true; // Outdoor sun loungers can appear in pairs if >= 1.2m apart
    }
    return false;
  };

  interface MergedFurnitureCluster {
    item: (typeof normalizedFurniture)[number];
    sumX: number;
    sumZ: number;
    count: number;
    zoneId?: string;
    zoneName: string;
  }

  const deduplicatedClusters: MergedFurnitureCluster[] = [];

  for (const cand of normalizedFurniture) {
    const hostZone = findZoneForGridPoint(cand.x, cand.z, cand.roomLabel);
    const zoneId = hostZone?.id;
    const zoneName = hostZone?.name || cand.roomLabel || '';
    const canHaveMultiInRoom = allowsMultipleOfSameType(
      cand.type,
      zoneName,
      cand.name
    );

    let mergedIntoExisting = false;
    for (const cluster of deduplicatedClusters) {
      if (cluster.item.type !== cand.type) continue;

      const curX = cluster.sumX / cluster.count;
      const curZ = cluster.sumZ / cluster.count;
      const dxMeters = ((cand.x - curX) / 1000) * Math.max(1, slabWidth);
      const dzMeters = ((cand.z - curZ) / 1000) * Math.max(1, slabDepth);
      const distMeters = Math.hypot(dxMeters, dzMeters);

      const sameRoomBox =
        Boolean(zoneId && cluster.zoneId && zoneId === cluster.zoneId) ||
        Boolean(
          zoneName &&
            cluster.zoneName &&
            zoneName.toLowerCase() === cluster.zoneName.toLowerCase()
        );

      // Merge ONLY if same category within < 1.1m radius OR inside the same standard room bounding box (unless explicitly double/shared).
      // Recalibrate furniture scale (0.88x) when merging close items so adjacent room equipment fits cleanly without ever omitting base furniture.
      if (distMeters < 1.1 || (sameRoomBox && !canHaveMultiInRoom)) {
        cluster.sumX += cand.x;
        cluster.sumZ += cand.z;
        cluster.count += 1;
        cluster.item.x = Math.round(cluster.sumX / cluster.count);
        cluster.item.z = Math.round(cluster.sumZ / cluster.count);
        cluster.item.width = Math.max(
          32,
          Math.round(((cluster.item.width + cand.width) / 2) * 0.88)
        );
        cluster.item.depth = Math.max(
          32,
          Math.round(((cluster.item.depth + cand.depth) / 2) * 0.88)
        );
        mergedIntoExisting = true;
        break;
      }
    }

    if (!mergedIntoExisting) {
      deduplicatedClusters.push({
        item: { ...cand },
        sumX: cand.x,
        sumZ: cand.z,
        count: 1,
        zoneId,
        zoneName,
      });
    }
  }

  const deduplicatedFurniture = deduplicatedClusters.map((c) => c.item);

  // Guaranteed Base Equipment Mapping per Indoor Room Zone (Never leave a main room without its functional equipment):
  // - Dormitorios: 1 Bed (with integrated nightstand/velador) + 1 Wardrobe/Clóset
  // - Baños: 1 WC + 1 Vanity/Lavamanos + 1 Shower/Tina
  // - Estar/Comedor: Main Sofa + Coffee Table/Rack (desk) + Dining Table with chairs (table)
  // - Cocina: Counter with sink + Cooktop/Oven (kitchen)
  for (const iz of normalizedZones) {
    if (iz.zoneType === 'outdoor') continue;
    const zName = iz.name.toLowerCase();
    const zW = Math.max(80, iz.maxX - iz.minX);
    const zD = Math.max(80, iz.maxZ - iz.minZ);
    const zCx = Math.round((iz.minX + iz.maxX) / 2);
    const zCz = Math.round((iz.minZ + iz.maxZ) / 2);

    const itemsInZone = deduplicatedFurniture.filter(
      (f) =>
        (f.roomLabel && f.roomLabel.toLowerCase() === zName) ||
        (f.x >= iz.minX - 25 &&
          f.x <= iz.maxX + 25 &&
          f.z >= iz.minZ - 25 &&
          f.z <= iz.maxZ + 25)
    );

    const hasType = (t: string) => itemsInZone.some((f) => f.type === t);

    // Recalibrate scale of existing items if room has multiple pieces in a compact footprint
    if (itemsInZone.length >= 2 && (zW < 260 || zD < 260)) {
      for (const item of itemsInZone) {
        item.width = Math.max(32, Math.round(item.width * 0.86));
        item.depth = Math.max(32, Math.round(item.depth * 0.86));
      }
    }

    if (/dormitorio|habitacion|bedroom|suite|cuarto/i.test(zName)) {
      const isSingleBed = zW * zD < 52000 || /simple|individual|single|plaza/i.test(zName);
      if (!hasType('bed')) {
        deduplicatedFurniture.push({
          id: `req-bed-${iz.id}`,
          type: 'bed',
          name: isSingleBed ? 'Cama 1 Plaza + Velador' : 'Cama Matrimonial + Veladores',
          zoneType: 'indoor',
          x: zCx,
          y: 0.03,
          z: Math.round(iz.minZ + zD * 0.42),
          rotationY: 0,
          width: isSingleBed ? 95 : 135,
          height: 0.95,
          depth: 155,
          roomLabel: iz.name,
        });
      }
      if (!hasType('wardrobe')) {
        deduplicatedFurniture.push({
          id: `req-wardrobe-${iz.id}`,
          type: 'wardrobe',
          name: 'Clóset Empotrado',
          zoneType: 'indoor',
          x: Math.round(iz.maxX - Math.min(42, zW * 0.18)),
          y: 0.03,
          z: Math.round(iz.maxZ - zD * 0.28),
          rotationY: -Math.PI / 2,
          width: Math.min(115, Math.round(zD * 0.42)),
          height: 2.0,
          depth: 48,
          roomLabel: iz.name,
        });
      }
    } else if (/baño|bano|bath|wc|toilet|servicio higienico/i.test(zName)) {
      if (!hasType('wc')) {
        deduplicatedFurniture.push({
          id: `req-wc-${iz.id}`,
          type: 'wc',
          name: 'Inodoro WC',
          zoneType: 'indoor',
          x: Math.round(iz.minX + zW * 0.28),
          y: 0.03,
          z: Math.round(iz.minZ + zD * 0.26),
          rotationY: 0,
          width: 38,
          height: 0.78,
          depth: 52,
          roomLabel: iz.name,
        });
      }
      if (!hasType('vanity')) {
        deduplicatedFurniture.push({
          id: `req-vanity-${iz.id}`,
          type: 'vanity',
          name: 'Vanitorio con Lavamanos y Espejo',
          zoneType: 'indoor',
          x: Math.round(iz.maxX - zW * 0.28),
          y: 0.03,
          z: Math.round(iz.minZ + zD * 0.26),
          rotationY: 0,
          width: 62,
          height: 0.85,
          depth: 44,
          roomLabel: iz.name,
        });
      }
      if (!hasType('shower')) {
        deduplicatedFurniture.push({
          id: `req-shower-${iz.id}`,
          type: 'shower',
          name: 'Ducha Walk-In / Tina',
          zoneType: 'indoor',
          x: Math.round(iz.maxX - zW * 0.28),
          y: 0.03,
          z: Math.round(iz.maxZ - zD * 0.28),
          rotationY: Math.PI,
          width: 72,
          height: 2.0,
          depth: 72,
          roomLabel: iz.name,
        });
      }
    } else if (/living|estar|comedor|salon|dining/i.test(zName)) {
      const isDiningOnly = /comedor|dining/i.test(zName) && !/living|estar|salon/i.test(zName);
      const isLivingOnly = /living|estar|salon/i.test(zName) && !/comedor|dining/i.test(zName);
      if (!isDiningOnly && !hasType('sofa')) {
        deduplicatedFurniture.push({
          id: `req-sofa-${iz.id}`,
          type: 'sofa',
          name: 'Sofá Principal Estar',
          zoneType: 'indoor',
          x: Math.round(iz.minX + zW * 0.34),
          y: 0.03,
          z: Math.round(iz.minZ + zD * 0.34),
          rotationY: 0,
          width: 155,
          height: 0.82,
          depth: 78,
          roomLabel: iz.name,
        });
      }
      if (!isDiningOnly && !hasType('desk')) {
        deduplicatedFurniture.push({
          id: `req-coffeetable-${iz.id}`,
          type: 'desk',
          name: 'Mesa de Centro y Rack TV',
          zoneType: 'indoor',
          x: Math.round(iz.minX + zW * 0.34),
          y: 0.03,
          z: Math.round(iz.maxZ - zD * 0.24),
          rotationY: Math.PI,
          width: 105,
          height: 0.55,
          depth: 45,
          roomLabel: iz.name,
        });
      }
      if (!isLivingOnly && !hasType('table')) {
        deduplicatedFurniture.push({
          id: `req-dining-${iz.id}`,
          type: 'table',
          name: 'Comedor con Sillas',
          zoneType: 'indoor',
          x: Math.round(iz.maxX - zW * 0.32),
          y: 0.03,
          z: zCz,
          rotationY: 0,
          width: 125,
          height: 0.76,
          depth: 82,
          roomLabel: iz.name,
        });
      }
    } else if (/cocina|kitchen|kitchenette/i.test(zName)) {
      if (!hasType('kitchen')) {
        deduplicatedFurniture.push({
          id: `req-kitchen-${iz.id}`,
          type: 'kitchen',
          name: 'Mesón Cocina con Lavaplatos y Encimera/Horno',
          zoneType: 'indoor',
          x: zCx,
          y: 0.03,
          z: Math.round(iz.minZ + zD * 0.28),
          rotationY: 0,
          width: Math.min(165, Math.round(zW * 0.62)),
          height: 0.9,
          depth: 55,
          roomLabel: iz.name,
        });
      }
    }
  }

  // Classify locked walls that exclusively border outdoor zones (and do NOT border any indoor zone) as 'outdoor'
  const outdoorZones = normalizedZones.filter((z) => z.zoneType === 'outdoor');
  const indoorZones = normalizedZones.filter((z) => z.zoneType === 'indoor');

  if (outdoorZones.length > 0) {
    for (const lw of lockedWalls) {
      const mx = (lw.x1 + lw.x2) / 2;
      const mz = (lw.z1 + lw.z2) / 2;

      const touchesOutdoor = outdoorZones.some(
        (oz) =>
          mx >= oz.minX - 45 &&
          mx <= oz.maxX + 45 &&
          mz >= oz.minZ - 45 &&
          mz <= oz.maxZ + 45
      );
      const touchesIndoor = indoorZones.some(
        (iz) =>
          mx >= iz.minX - 35 &&
          mx <= iz.maxX + 35 &&
          mz >= iz.minZ - 35 &&
          mz <= iz.maxZ + 35
      );

      if (touchesOutdoor && !touchesIndoor) {
        lw.zoneType = 'outdoor';
      }
    }
  }

  // Enforce Smart Differentiation of Exterior Openings & Main Entrance Cap (max 1–2 exterior doors):
  // Any opening on a perimeter wall (isExterior) or a facade wall bordering an "outdoor" zone
  // that is NOT one of the 1–2 main pedestrian/service entrances is classified as 'window'
  // with a solid lower sill wall (sillHeight: 0.90m–1.00m, default 0.95m).
  const isFacadeOrPerimeterWall = (lw: any): boolean => {
    if (lw.isExterior) return true;
    const mx = (lw.x1 + lw.x2) / 2;
    const mz = (lw.z1 + lw.z2) / 2;
    if (mx <= 115 || mx >= 885 || mz <= 115 || mz >= 885) return true;
    if (outdoorZones.length > 0) {
      return outdoorZones.some(
        (oz) =>
          mx >= oz.minX - 55 &&
          mx <= oz.maxX + 55 &&
          mz >= oz.minZ - 55 &&
          mz <= oz.maxZ + 55
      );
    }
    return false;
  };

  interface ExteriorDoorCandidate {
    wall: any;
    op: any;
    score: number;
  }
  const exteriorDoorCandidates: ExteriorDoorCandidate[] = [];

  for (const lw of lockedWalls) {
    if (!Array.isArray(lw.openings) || lw.openings.length === 0) continue;
    const isPerim = isFacadeOrPerimeterWall(lw);

    for (const op of lw.openings) {
      if (op.type === 'window') {
        op.sillHeight = Number(
          Math.max(0.9, Math.min(1.0, Number(op.sillHeight) || 0.95)).toFixed(2)
        );
        op.height = Number(
          Math.max(1.05, Math.min(1.35, Number(op.height) || 1.2)).toFixed(2)
        );
        continue;
      }

      if (isPerim) {
        const rawW = Number(op.width) || 0.85;
        // Wide facade openings (> 1.05m) are sliding windows / ventanales correderos with sill
        if (rawW > 1.05) {
          op.type = 'window';
          op.width = Number(Math.min(1.85, Math.max(1.2, rawW)).toFixed(2));
          op.height = 1.2;
          op.sillHeight = 0.95;
        } else {
          const opX =
            op.x ?? Math.round(lw.x1 + (lw.x2 - lw.x1) * (op.offsetRatio || 0.5));
          const opZ =
            op.z ?? Math.round(lw.z1 + (lw.z2 - lw.z1) * (op.offsetRatio || 0.5));
          // Score candidate pedestrian entrance by proximity to entry/hall/living/kitchen zones
          let score = 10;
          if (rawW >= 0.78 && rawW <= 0.95) score += 25;
          for (const iz of indoorZones) {
            const nearZone =
              opX >= iz.minX - 65 &&
              opX <= iz.maxX + 65 &&
              opZ >= iz.minZ - 65 &&
              opZ <= iz.maxZ + 65;
            if (!nearZone) continue;
            if (/acceso|entrada|hall|recibidor|estar|living|salon|cocina|servicio/i.test(iz.name)) {
              score += 35;
            } else if (/bano|baño|wc|toilet/i.test(iz.name)) {
              score -= 60; // Bathrooms never have exterior pedestrian entrance doors
            } else if (/dormitorio|habitacion|bedroom/i.test(iz.name)) {
              score -= 25; // Bedroom facade openings are windows/ventanales, not main entrances
            }
          }
          exteriorDoorCandidates.push({ wall: lw, op, score });
        }
      }
    }
  }

  // Sort exterior door candidates by score and allow at most 1 main pedestrian entrance on the exterior perimeter;
  // EVERY other exterior/perimeter opening is strictly elevated as a window with sillHeight: 0.95 (no floating exterior doors).
  exteriorDoorCandidates.sort((a, b) => b.score - a.score);
  const allowedExteriorDoorWalls = new Set<string>();
  let keptExteriorDoors = 0;

  for (const cand of exteriorDoorCandidates) {
    if (
      keptExteriorDoors < 1 &&
      cand.score > 0 &&
      !allowedExteriorDoorWalls.has(cand.wall.id)
    ) {
      keptExteriorDoors++;
      allowedExteriorDoorWalls.add(cand.wall.id);
      cand.op.type = 'door';
      cand.op.width = Number(
        Math.max(0.8, Math.min(0.9, Number(cand.op.width) || 0.88)).toFixed(2)
      );
      cand.op.height = 2.05;
      cand.op.sillHeight = 0;
    } else {
      // Elevate all non-main-entrance perimeter openings as exterior windows with 0.95m solid sill
      cand.op.type = 'window';
      cand.op.width = Number(
        Math.max(1.1, Math.min(1.65, Number(cand.op.width) || 1.35)).toFixed(2)
      );
      cand.op.height = 1.2;
      cand.op.sillHeight = 0.95;
    }
  }

  // Priority ranking for the 10 key furniture objects (beds, sofas, dining table, sanitary fixtures)
  const keyPriority: Record<string, number> = {
    bed: 1,
    sofa: 2,
    table: 3,
    wc: 4,
    vanity: 5,
    shower: 6,
    kitchen: 7,
    patio_set: 8,
    wardrobe: 9,
    desk: 10,
    lounger: 11,
    bbq_grill: 12,
  };

  const cappedKeyFurniture = [...deduplicatedFurniture]
    .sort((a, b) => (keyPriority[a.type] ?? 99) - (keyPriority[b.type] ?? 99))
    .slice(0, 10);

  return {
    coordinateSystem: 'grid_1000' as const,
    slabWidth,
    slabDepth,
    zones: normalizedZones,
    walls: lockedWalls,
    furniture: cappedKeyFurniture,
    analysisSummary: String(
      rawJson?.analysisSummary ||
        `Reconstrucción espacial 3D ágil v1.5 (T=0.0, Grid 0-1000): ${lockedWalls.length} políneas reales del Paso 1 y ${cappedKeyFurniture.length} objetos clave 3D (máx. 10).`
    ),
  };
}

/**
 * Fallback deterministic spatial reconstruction from currentBlueprint when the API is unavailable,
 * returning all coordinates in the normalized 0..1000 Integer Grid with Step 1 Geometry Lock and Indoor/Outdoor Zoning.
 */
function buildFallbackSpatialAnalysis(
  slabWidth: number,
  slabDepth: number,
  currentBlueprint: any
) {
  const bpW = Math.max(0.1, Number(currentBlueprint?.totalWidth) || slabWidth);
  const bpD = Math.max(0.1, Number(currentBlueprint?.totalDepth) || slabDepth);

  const toGrid1000X = (xMeters: number) =>
    Math.max(
      0,
      Math.min(1000, Math.round(((Number(xMeters) || 0) / bpW + 0.5) * 1000))
    );
  const toGrid1000Z = (zMeters: number) =>
    Math.max(
      0,
      Math.min(1000, Math.round(((Number(zMeters) || 0) / bpD + 0.5) * 1000))
    );

  const clampGrid1000 = (val: any, fallback = 500) =>
    Math.max(0, Math.min(1000, Math.round(Number(val) || fallback)));

  const zones = buildNormalizedZones(
    [],
    currentBlueprint,
    slabWidth,
    slabDepth,
    clampGrid1000
  );

  const walls = buildLockedStep1GridWalls(
    currentBlueprint,
    slabWidth,
    slabDepth
  );

  const categoryToType: Record<string, string> = {
    sofa: 'sofa',
    bed: 'bed',
    dining_table: 'table',
    wc: 'wc',
    vanity: 'vanity',
    kitchen_island: 'kitchen',
    shower: 'shower',
    wardrobe: 'wardrobe',
    desk: 'desk',
    patio_set: 'patio_set',
    lounger: 'lounger',
    bbq_grill: 'bbq_grill',
  };

  const keyPriority: Record<string, number> = {
    bed: 1,
    sofa: 2,
    table: 3,
    wc: 4,
    vanity: 5,
    shower: 6,
    kitchen: 7,
    patio_set: 8,
    wardrobe: 9,
    desk: 10,
    lounger: 11,
    bbq_grill: 12,
  };

  const furniture = Array.isArray(currentBlueprint?.furniture)
    ? currentBlueprint.furniture
        .map((f: any, idx: number) => {
          const label = `${f.name || ''} ${f.roomLabel || ''}`;
          const zoneType: 'indoor' | 'outdoor' =
            f.zoneType === 'outdoor' || isOutdoorKeyword(label)
              ? 'outdoor'
              : 'indoor';
          return {
            id: String(f.id || `furn-${idx}`),
            type:
              zoneType === 'outdoor' && !categoryToType[f.category]
                ? 'patio_set'
                : categoryToType[f.category] || 'desk',
            name: String(f.name || 'Artefacto 3D'),
            zoneType,
            x: toGrid1000X(f.x),
            y: 0.03,
            z: toGrid1000Z(f.z),
            rotationY: Number(f.rotationY) || 0,
            width: Math.max(
              35,
              Math.min(320, Math.round(((Number(f.width) || 1.4) / bpW) * 1000))
            ),
            height: Number(f.height) || 0.8,
            depth: Math.max(
              35,
              Math.min(320, Math.round(((Number(f.depth) || 0.85) / bpD) * 1000))
            ),
            roomLabel: f.roomLabel,
          };
        })
        .sort(
          (a: any, b: any) =>
            (keyPriority[a.type] ?? 99) - (keyPriority[b.type] ?? 99)
        )
        .slice(0, 10)
    : [];

  return {
    coordinateSystem: 'grid_1000' as const,
    slabWidth,
    slabDepth,
    zones,
    walls,
    furniture,
    analysisSummary: `Reconstrucción espacial 3D v1.5 con políneas reales Paso 1 (${walls.length} muros, ${zones.length} zonas y ${furniture.length} objetos clave 3D).`,
    modelUsed: 'gemini-3-flash-preview',
  };
}

/**
 * POST /api/gemini/analyze-3d-spatial
 * Receives the high-resolution Step 2 CGI floor plan image and uses Gemini Vision
 * with strict temperature: 0.0 and 0..1000 normalized integer coordinates:
 * - Limits furniture detection to a maximum of 10 key objects (beds, sofas, dining table, sanitary fixtures).
 * - Detects Indoor vs Outdoor zones (`zoneType: "indoor" | "outdoor"`) so patios/terraces have no enclosing walls.
 * - Uses Step 1 real wall polylines directly without blocking loops.
 */
async function handleAnalyze3DSpatial(
  req: express.Request,
  res: express.Response
) {
  const { imageDataUrl, slabWidth: rawSlabW, slabDepth: rawSlabD, currentBlueprint } =
    req.body || {};

  const slabWidth = Number(rawSlabW) || Number(currentBlueprint?.totalWidth) || 12.0;
  const slabDepth = Number(rawSlabD) || Number(currentBlueprint?.totalDepth) || 9.0;

  try {
    if (
      !process.env.GEMINI_API_KEY ||
      !imageDataUrl ||
      typeof imageDataUrl !== 'string' ||
      !imageDataUrl.includes('base64,')
    ) {
      return res.json(
        buildFallbackSpatialAnalysis(slabWidth, slabDepth, currentBlueprint)
      );
    }

    const ai = getGenAIClient();
    const [header, base64Data] = imageDataUrl.split('base64,');
    const mimeMatch = header.match(/data:(.*?);/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';

    const spatialPrompt = [
      'Realiza un análisis espacial 3D ágil y determinista (temperature = 0.0) sobre esta imagen CGI de planta arquitectónica 3D cenital (90° top-down) en grilla entera normalizada de 0 a 1000.',
      '1. ZONIFICACIÓN INDOOR / OUTDOOR (`zones`):',
      '   • Clasifica cada recinto con `zoneType`: `"indoor"` (habitaciones techadas) o `"outdoor"` (patios, terrazas, decks, jardines abiertos sin muros perimetrales).',
      '2. MÁXIMO 10 OBJETOS CLAVE DE MOBILIARIO (`furniture`):',
      '   • Detecta un MÁXIMO ESTRICTO de 10 objetos clave principales (priorizando: camas `"bed"`, sofás `"sofa"`, mesa de comedor `"table"`, sanitarios `"wc"`, `"vanity"`, `"shower"`, cocina `"kitchen"`, terraza `"patio_set"`).',
      '   • Devuelve su centro exacto (x, z) en grilla entera 0 a 1000, dimensiones (width, depth) y rotación en radianes (rotationY).',
      '   • Prohibido duplicar dos objetos del mismo tipo en un mismo recinto.',
    ].join('\n');

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        analysisSummary: {
          type: Type.STRING,
        },
        zones: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              name: { type: Type.STRING },
              zoneType: {
                type: Type.STRING,
                description: 'Must be "indoor" or "outdoor"',
              },
              surfaceMaterial: {
                type: Type.STRING,
                description: 'One of: deck, grass, stone, wood, porcelain',
              },
              minX: { type: Type.INTEGER },
              minZ: { type: Type.INTEGER },
              maxX: { type: Type.INTEGER },
              maxZ: { type: Type.INTEGER },
            },
            required: ['id', 'name', 'zoneType', 'minX', 'minZ', 'maxX', 'maxZ'],
          },
        },
        furniture: {
          type: Type.ARRAY,
          description:
            'Máximo 10 objetos clave principales (camas, sofás, mesa de comedor, sanitarios) en grilla 0 a 1000.',
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              type: {
                type: Type.STRING,
                description:
                  'One of: sofa, bed, table, wc, vanity, kitchen, shower, wardrobe, desk, patio_set, lounger, bbq_grill',
              },
              name: { type: Type.STRING },
              zoneType: {
                type: Type.STRING,
                description: 'Must be "indoor" or "outdoor"',
              },
              x: { type: Type.INTEGER },
              y: { type: Type.NUMBER },
              z: { type: Type.INTEGER },
              rotationY: { type: Type.NUMBER },
              width: { type: Type.INTEGER },
              height: { type: Type.NUMBER },
              depth: { type: Type.INTEGER },
              roomLabel: { type: Type.STRING },
            },
            required: [
              'type',
              'name',
              'zoneType',
              'x',
              'y',
              'z',
              'rotationY',
              'width',
              'height',
              'depth',
            ],
          },
        },
      },
      required: ['analysisSummary', 'zones', 'furniture'],
    };

    const modelsToTry = ['gemini-3-flash-preview', 'gemini-2.5-flash'];
    let parsedResult: any = null;
    let modelUsed = 'gemini-3-flash-preview';

    for (const modelName of modelsToTry) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: base64Data,
                },
              },
              {
                text: spatialPrompt,
              },
            ],
          },
          config: {
            temperature: 0.0,
            responseMimeType: 'application/json',
            responseSchema,
          },
        });

        const rawText = response.text;
        if (rawText) {
          const jsonCandidate = JSON.parse(rawText);
          if (
            Array.isArray(jsonCandidate?.furniture) ||
            Array.isArray(jsonCandidate?.zones)
          ) {
            parsedResult = jsonCandidate;
            modelUsed = modelName;
            break;
          }
        }
      } catch (err) {
        console.warn(`Spatial 3D analysis attempt with ${modelName} failed:`, err);
      }
    }

    if (!parsedResult) {
      return res.json(
        buildFallbackSpatialAnalysis(slabWidth, slabDepth, currentBlueprint)
      );
    }

    const normalized = normalizeSpatialReconstructionCoordinates(
      parsedResult,
      slabWidth,
      slabDepth,
      currentBlueprint
    );

    return res.json({
      ...normalized,
      modelUsed,
    });
  } catch (error) {
    console.error('Error in /api/gemini/analyze-3d-spatial:', error);
    return res.json(
      buildFallbackSpatialAnalysis(slabWidth, slabDepth, currentBlueprint)
    );
  }
}

/**
 * PIPELINE DE 3 PASOS IDÉNTICO AL SITIO WEB DE TRIPO3D API v2 (v3.3):
 * - Sin fallbacks silenciosos: cualquier error devuelve el JSON exacto del servidor Tripo3D para depuración.
 * - PASO A (UPLOAD FILE): POST https://api.tripo3d.ai/v2/openapi/upload -> image_token
 * - PASO B (CREATE TASK): POST https://api.tripo3d.ai/v2/openapi/task -> task_id
 * - PASO C (POLLING Y DESCARGA): GET https://api.tripo3d.ai/v2/openapi/task/{task_id} -> output.model / result.model.url
 */
function getSanitizedTripoApiKey(): string {
  const raw = (process.env.TRIPO3D_API_KEY || '').trim();
  return raw.replace(/^["']|["']$/g, '').replace(/^Bearer\s+/i, '').trim();
}

async function handleCreateTripo3DTask(
  req: express.Request,
  res: express.Response
) {
  const apiKey = getSanitizedTripoApiKey();
  if (!apiKey) {
    return res.status(401).json({
      error: true,
      step: 'AUTH_CHECK',
      message:
        'TRIPO3D_API_KEY no está configurada en las variables de entorno del servidor (.env).',
      serverEnvConfigured: false,
    });
  }

  const { imageDataUrl } = req.body || {};
  if (
    !imageDataUrl ||
    typeof imageDataUrl !== 'string' ||
    !imageDataUrl.includes('base64,')
  ) {
    return res.status(400).json({
      error: true,
      step: 'INPUT_VALIDATION',
      message:
        'No se recibió una imagen válida en base64 desde el Paso 2 (imageDataUrl requerido).',
    });
  }

  try {
    const [, b64Data] = imageDataUrl.split('base64,');
    const imgBuffer = Buffer.from(b64Data, 'base64');

    const authHeader = `Bearer ${apiKey}`;

    // =========================================================================
    // PASO A (UPLOAD FILE): POST https://api.tripo3d.ai/v2/openapi/upload
    // =========================================================================
    const formData = new FormData();
    const blob = new Blob([imgBuffer], { type: 'image/png' });
    formData.append('file', blob, 'step2-render.png');

    const uploadRes = await fetch('https://api.tripo3d.ai/v2/openapi/upload', {
      method: 'POST',
      headers: {
        Authorization: authHeader,
      },
      body: formData,
    });

    const uploadRawText = await uploadRes.text();
    let uploadJson: any = null;
    try {
      uploadJson = JSON.parse(uploadRawText);
    } catch {
      uploadJson = { rawResponse: uploadRawText };
    }

    if (!uploadRes.ok || (uploadJson?.code !== undefined && uploadJson.code !== 0)) {
      return res.status(uploadRes.ok ? 400 : uploadRes.status).json({
        error: true,
        step: 'PASO_A_UPLOAD_FILE',
        endpoint: 'https://api.tripo3d.ai/v2/openapi/upload',
        httpStatus: uploadRes.status,
        tripoResponse: uploadJson,
      });
    }

    const imageToken =
      uploadJson?.data?.image_token || uploadJson?.data?.file_token;

    if (!imageToken) {
      return res.status(502).json({
        error: true,
        step: 'PASO_A_UPLOAD_FILE',
        endpoint: 'https://api.tripo3d.ai/v2/openapi/upload',
        message: 'La respuesta de Tripo3D upload no incluyó image_token.',
        tripoResponse: uploadJson,
      });
    }

    // =========================================================================
    // PASO B (CREATE TASK): POST https://api.tripo3d.ai/v2/openapi/task
    // =========================================================================
    const officialV2Payload = {
      type: 'image_to_model',
      file: {
        type: 'png',
        file_token: imageToken,
      },
      geometry_quality: 'detailed',
      texture_quality: 'detailed',
    };

    const taskRes = await fetch('https://api.tripo3d.ai/v2/openapi/task', {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(officialV2Payload),
    });

    const taskRawText = await taskRes.text();
    let taskJson: any = null;
    try {
      taskJson = JSON.parse(taskRawText);
    } catch {
      taskJson = { rawResponse: taskRawText };
    }

    if (!taskRes.ok || (taskJson?.code !== undefined && taskJson.code !== 0)) {
      return res.status(taskRes.ok ? 400 : taskRes.status).json({
        error: true,
        step: 'PASO_B_CREATE_TASK',
        endpoint: 'https://api.tripo3d.ai/v2/openapi/task',
        httpStatus: taskRes.status,
        requestPayloadSent: officialV2Payload,
        tripoResponse: taskJson,
      });
    }

    const taskId = taskJson?.data?.task_id;
    if (!taskId) {
      return res.status(502).json({
        error: true,
        step: 'PASO_B_CREATE_TASK',
        endpoint: 'https://api.tripo3d.ai/v2/openapi/task',
        message: 'La respuesta de Tripo3D task no incluyó data.task_id.',
        requestPayloadSent: officialV2Payload,
        tripoResponse: taskJson,
      });
    }

    return res.json({
      error: false,
      status: 'QUEUED',
      imageToken,
      taskId,
      payloadUsed: officialV2Payload,
      tripoUploadResponse: uploadJson,
      tripoTaskResponse: taskJson,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: true,
      step: 'SERVER_EXCEPTION_PASO_A_B',
      message: err?.message || String(err),
      stack: err?.stack,
    });
  }
}

function extractUrlString(candidate: any): string | null {
  if (!candidate) return null;
  if (typeof candidate === 'string' && /^https?:\/\//i.test(candidate.trim())) {
    return candidate.trim();
  }
  if (typeof candidate === 'object' && typeof candidate.url === 'string') {
    return candidate.url.trim();
  }
  return null;
}

async function handlePollTripo3DTask(
  req: express.Request,
  res: express.Response
) {
  const apiKey = getSanitizedTripoApiKey();
  if (!apiKey) {
    return res.status(401).json({
      error: true,
      step: 'PASO_C_POLLING_AUTH',
      message: 'TRIPO3D_API_KEY no está configurada en el servidor.',
    });
  }

  const taskId = String(req.params.taskId || '').trim();
  if (!taskId) {
    return res.status(400).json({
      error: true,
      step: 'PASO_C_POLLING_VALIDATION',
      message: 'task_id es requerido para consultar el estado en Tripo3D.',
    });
  }

  try {
    const endpoint = `https://api.tripo3d.ai/v2/openapi/task/${encodeURIComponent(taskId)}`;
    const pollRes = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    const pollRawText = await pollRes.text();
    let pollJson: any = null;
    try {
      pollJson = JSON.parse(pollRawText);
    } catch {
      pollJson = { rawResponse: pollRawText };
    }

    if (!pollRes.ok || (pollJson?.code !== undefined && pollJson.code !== 0)) {
      return res.status(pollRes.ok ? 400 : pollRes.status).json({
        error: true,
        step: 'PASO_C_POLLING',
        endpoint,
        httpStatus: pollRes.status,
        tripoResponse: pollJson,
      });
    }

    const taskData = pollJson?.data || {};
    const rawStatus = String(taskData.status || '').toUpperCase();
    const progress = Number(taskData.progress) || 0;

    const glbRemoteUrl =
      extractUrlString(taskData.output?.model) ||
      extractUrlString(taskData.output?.pbr_model) ||
      extractUrlString(taskData.output?.base_model) ||
      extractUrlString(taskData.result?.pbr_model) ||
      extractUrlString(taskData.result?.model) ||
      extractUrlString(taskData.result?.base_model) ||
      null;

    return res.json({
      error: false,
      taskId,
      status: rawStatus,
      progress,
      remoteGlbUrl: glbRemoteUrl,
      glbUrl: glbRemoteUrl
        ? `/api/tripo3d/download?url=${encodeURIComponent(glbRemoteUrl)}`
        : null,
      tripoResponse: pollJson,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: true,
      step: 'SERVER_EXCEPTION_PASO_C',
      message: err?.message || String(err),
    });
  }
}

async function handleDownloadTripo3DGlb(
  req: express.Request,
  res: express.Response
) {
  const targetUrl = String(req.query.url || '').trim();
  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
    return res.status(400).json({
      error: true,
      step: 'PASO_C_DOWNLOAD_GLB',
      message: 'URL de modelo .GLB inválida.',
      targetUrl,
    });
  }

  try {
    const dlRes = await fetch(targetUrl);
    if (!dlRes.ok) {
      const errText = await dlRes.text().catch(() => '');
      return res.status(dlRes.status).json({
        error: true,
        step: 'PASO_C_DOWNLOAD_GLB',
        httpStatus: dlRes.status,
        targetUrl,
        responseBody: errText,
      });
    }
    const arrayBuffer = await dlRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    res.setHeader('Content-Type', 'model/gltf-binary');
    res.setHeader('Content-Length', String(buffer.length));
    return res.send(buffer);
  } catch (err: any) {
    return res.status(502).json({
      error: true,
      step: 'PASO_C_DOWNLOAD_GLB_EXCEPTION',
      message: err?.message || 'Error descargando archivo .GLB de Tripo3D',
    });
  }
}

app.get('/api/tripo3d/status', (_req, res) => {
  const apiKey = getSanitizedTripoApiKey();
  res.json({
    configured: Boolean(apiKey),
  });
});
app.post('/api/gemini/render-floorplan-cgi', handleImageToImageFloorPlanRender);
app.post('/api/gemini/analyze-blueprint', handleImageToImageFloorPlanRender);
app.post('/api/gemini/analyze-3d-spatial', handleAnalyze3DSpatial);
app.post('/api/tripo3d/task', handleCreateTripo3DTask);
app.get('/api/tripo3d/task/:taskId', handlePollTripo3DTask);
app.get('/api/tripo3d/download', handleDownloadTripo3DGlb);
app.post('/api/cad-3d-engine/generate-glb', handleCreateTripo3DTask);

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `Prodalam Render Pro server listening on http://localhost:${PORT}`
    );
  });
}

startServer();

