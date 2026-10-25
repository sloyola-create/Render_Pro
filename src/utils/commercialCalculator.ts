import { BlueprintData } from '../types/render';

export type MetalconProfileSeries = '38R' | '60R' | '90R';
export type StripLengthOption = 3 | 6;

export interface ProdalamMaterialItem {
  code: string;
  family:
    | 'Perfiles Metalcon / Estructurales'
    | 'Mallas y Radier'
    | 'Techumbre y Revestimientos'
    | 'Cierres Perimetrales'
    | 'Fijaciones y Anclajes';
  description: string;
  quantity: number;
  unit: string;
  notes: string;
}

export interface CommercialMetricsResult {
  habitableAreaM2: number;
  slabFootprintAreaM2: number;
  roofAreaM2: number;
  totalWallsLinearM: number;
  exteriorWallsLinearM: number;
  interiorWallsLinearM: number;
  perimeterClosureLinearM: number;
  wallCount: number;
  roomCount: number;
  openingsCount: number;
  profileSeries: MetalconProfileSeries;
  stripLengthMeters: StripLengthOption;
  materials: ProdalamMaterialItem[];
}

/**
 * Analiza dinámicamente `blueprint.walls` y `blueprint.rooms` normalizando cualquier
 * sistema de coordenadas (píxeles o metros) a dimensiones arquitectónicas reales.
 */
export function calculateProdalamCommercialMetrics(
  blueprint: BlueprintData | null,
  options?: {
    profileSeries?: MetalconProfileSeries;
    stripLengthMeters?: StripLengthOption;
    wallHeightMeters?: number;
  }
): CommercialMetricsResult {
  const profileSeries: MetalconProfileSeries = options?.profileSeries || '90R';
  const stripLengthMeters: StripLengthOption = options?.stripLengthMeters || 6;
  const wallHeightMeters = Math.max(
    1.8,
    Math.min(4.0, Number(options?.wallHeightMeters) || 2.4)
  );

  if (!blueprint) {
    return {
      habitableAreaM2: 0,
      slabFootprintAreaM2: 0,
      roofAreaM2: 0,
      totalWallsLinearM: 0,
      exteriorWallsLinearM: 0,
      interiorWallsLinearM: 0,
      perimeterClosureLinearM: 0,
      wallCount: 0,
      roomCount: 0,
      openingsCount: 0,
      profileSeries,
      stripLengthMeters,
      materials: [],
    };
  }

  const bpWidthM = Math.max(4.0, Number(blueprint.totalWidth) || 12.0);
  const bpDepthM = Math.max(4.0, Number(blueprint.totalDepth) || 9.5);
  const slabFootprintAreaM2 = Number((bpWidthM * bpDepthM).toFixed(1));

  // 1. Calcular Bounding Box de los muros para normalizar a metros reales si vienen en píxeles
  const rawWalls = Array.isArray(blueprint.walls) ? blueprint.walls : [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const w of rawWalls) {
    if (w.x1 < minX) minX = w.x1;
    if (w.x1 > maxX) maxX = w.x1;
    if (w.x2 < minX) minX = w.x2;
    if (w.x2 > maxX) maxX = w.x2;
    if (w.z1 < minZ) minZ = w.z1;
    if (w.z1 > maxZ) maxZ = w.z1;
    if (w.z2 < minZ) minZ = w.z2;
    if (w.z2 > maxZ) maxZ = w.z2;
  }

  const rawSpanX =
    Number.isFinite(minX) && Number.isFinite(maxX) && maxX > minX
      ? maxX - minX
      : bpWidthM;
  const rawSpanZ =
    Number.isFinite(minZ) && Number.isFinite(maxZ) && maxZ > minZ
      ? maxZ - minZ
      : bpDepthM;

  // Si el span de coordenadas excede 45 unidades, está en píxeles/grid y se escala a bpWidthM × bpDepthM
  const scaleX = rawSpanX > 45 ? bpWidthM / rawSpanX : 1;
  const scaleZ = rawSpanZ > 45 ? bpDepthM / rawSpanZ : 1;

  let exteriorWallsLinearM = 0;
  let interiorWallsLinearM = 0;
  let openingsCount = 0;

  for (const w of rawWalls) {
    const dx = (w.x2 - w.x1) * scaleX;
    const dz = (w.z2 - w.z1) * scaleZ;
    const lenM = Math.hypot(dx, dz);
    if (lenM < 0.05) continue;

    if (Array.isArray(w.openings)) {
      openingsCount += w.openings.length;
    }

    if (w.isExterior) {
      exteriorWallsLinearM += lenM;
    } else {
      interiorWallsLinearM += lenM;
    }
  }

  // Si ningún muro venía marcado explícitamente como isExterior, estimar el perímetro exterior vs tabiquería interior
  const rawTotalWallsM = exteriorWallsLinearM + interiorWallsLinearM;
  const geometricPerimeterM = 2 * (bpWidthM + bpDepthM);

  if (exteriorWallsLinearM < 1.0 && rawTotalWallsM > 0) {
    exteriorWallsLinearM = Math.min(rawTotalWallsM * 0.52, geometricPerimeterM);
    interiorWallsLinearM = Math.max(0, rawTotalWallsM - exteriorWallsLinearM);
  }

  const totalWallsLinearM = Number(
    (exteriorWallsLinearM + interiorWallsLinearM).toFixed(1)
  );
  exteriorWallsLinearM = Number(exteriorWallsLinearM.toFixed(1));
  interiorWallsLinearM = Number(interiorWallsLinearM.toFixed(1));

  // 2. Superficie Habitable (m²): suma de áreas de habitaciones e interior construido
  const rawRooms = Array.isArray(blueprint.rooms) ? blueprint.rooms : [];
  let sumRoomsAreaM2 = 0;
  for (const room of rawRooms) {
    const rw = Math.max(0, Number(room.width) || 0);
    const rd = Math.max(0, Number(room.depth) || 0);
    // Si las dimensiones de la habitación están en píxeles (> 35), escalarlas
    const rwMeters = rw > 35 ? rw * scaleX : rw;
    const rdMeters = rd > 35 ? rd * scaleZ : rd;
    const area = rwMeters * rdMeters;
    if (room.zoneType === 'outdoor' || room.type === 'terrace') {
      // Las terrazas cubiertas computan al 50% en superficie habitable útil
      sumRoomsAreaM2 += area * 0.5;
    } else {
      sumRoomsAreaM2 += area;
    }
  }

  // Si la suma de habitaciones es coherente la usamos; de lo contrario usamos el factor útil de la huella (86%)
  const habitableAreaM2 = Number(
    (sumRoomsAreaM2 >= slabFootprintAreaM2 * 0.35 &&
    sumRoomsAreaM2 <= slabFootprintAreaM2 * 1.15
      ? sumRoomsAreaM2
      : slabFootprintAreaM2 * 0.86
    ).toFixed(1)
  );

  // Superficie de cubierta / techumbre considerando pendiente y aleros (factor 1.18)
  const roofAreaM2 = Number((habitableAreaM2 * 1.18).toFixed(1));

  // Perímetro de Cierre Exterior del terreno/lote (con holgura perimetral de emplazamiento)
  const perimeterClosureLinearM = Number(
    Math.max(geometricPerimeterM * 1.25, exteriorWallsLinearM * 1.15).toFixed(1)
  );

  // =========================================================================
  // 2. ALGORITMO DE CUBICACIÓN ESTIMADA PRODALAM
  // =========================================================================

  // A) Perfiles Metalcon / Estructurales (38R / 60R / 90R)
  // - Montantes cada 0.40m (1 / 0.40 = 2.5 montantes por metro lineal) + 12% refuerzos de vanos/encuentros
  const studCount = Math.max(
    1,
    Math.ceil(totalWallsLinearM / 0.4 + openingsCount * 2 + 6)
  );
  // Si se elige tira de 6m y la altura de muro es <= 2.95m, de 1 tira de 6m salen 2 montantes; de tira de 3m sale 1 montante
  const studsPerStrip =
    stripLengthMeters === 6 && wallHeightMeters <= 2.95 ? 2 : 1;
  const studStripsNeeded = Math.ceil((studCount / studsPerStrip) * 1.05);

  // - Canales Superiores e Inferiores (Solera inferior + Solera superior = 2 * metros lineales de muro + 8% traslape)
  const trackLinearMeters = totalWallsLinearM * 2 * 1.08;
  const trackStripsNeeded = Math.max(
    1,
    Math.ceil(trackLinearMeters / stripLengthMeters)
  );

  // - Perfiles Omega / Costanera para Estructura de Techumbre (1 línea cada 0.60m sobre el área de cubierta)
  const roofOmegaLinearMeters = roofAreaM2 * 1.75;
  const roofOmegaStrips = Math.max(
    1,
    Math.ceil(roofOmegaLinearMeters / stripLengthMeters)
  );

  const profileSpecLabel =
    profileSeries === '90R'
      ? '90R Estructural (90×38×0.85mm Galv.)'
      : profileSeries === '60R'
        ? '60R Tabique (60×38×0.50mm Galv.)'
        : '38R Divisorio (38×38×0.50mm Galv.)';

  const trackSpecLabel =
    profileSeries === '90R'
      ? 'Canal U 92×30×0.85mm Galv.'
      : profileSeries === '60R'
        ? 'Canal U 62×25×0.50mm Galv.'
        : 'Canal U 40×25×0.50mm Galv.';

  // B) Mallas Electrosoldadas para Losa / Radier (Paño estándar Acma 2.40m x 5.00m = 12 m², con 12% traslape)
  const meshEffectiveAreaM2 = Number((habitableAreaM2 * 1.12).toFixed(1));
  const meshSheetsCount = Math.max(1, Math.ceil(meshEffectiveAreaM2 / 12.0));

  // C) Cubierta y Revestimientos
  const roofSheetEffectiveM2 = Number((roofAreaM2 * 1.1).toFixed(1));

  // D) Cierres Perimetrales Prodalam (Paneles Acmafor 3D de 2.50m ancho ó Rollos de 25m)
  const acmaforPanelsCount = Math.max(
    1,
    Math.ceil(perimeterClosureLinearM / 2.5)
  );
  const acmaforPostsCount = acmaforPanelsCount + 1;
  const wireMeshRolls25m = Math.max(
    1,
    Math.ceil(perimeterClosureLinearM / 25.0)
  );

  // E) Fijaciones y Anclajes
  const selfDrillingScrewsBoxes = Math.max(
    1,
    Math.ceil((studCount * 14 + roofOmegaStrips * 12) / 500)
  );

  const materials: ProdalamMaterialItem[] = [
    {
      code: `PRD-MTL-${profileSeries}-M`,
      family: 'Perfiles Metalcon / Estructurales',
      description: `Montante Metalcon ${profileSpecLabel} · Tira ${stripLengthMeters}.0m`,
      quantity: studStripsNeeded,
      unit: `tiras (${stripLengthMeters}m)`,
      notes: `Paso cada 40 cm (${studCount} montantes verticales + refuerzos de vanos)`,
    },
    {
      code: `PRD-MTL-${profileSeries}-C`,
      family: 'Perfiles Metalcon / Estructurales',
      description: `Solera / ${trackSpecLabel} · Tira ${stripLengthMeters}.0m`,
      quantity: trackStripsNeeded,
      unit: `tiras (${stripLengthMeters}m)`,
      notes: `Solera inferior y superior continua (${trackLinearMeters.toFixed(1)} m lineales)`,
    },
    {
      code: 'PRD-MTL-OMG-35',
      family: 'Perfiles Metalcon / Estructurales',
      description: `Perfil Omega / Costanera Techumbre 35×0.85mm Galv. · Tira ${stripLengthMeters}.0m`,
      quantity: roofOmegaStrips,
      unit: `tiras (${stripLengthMeters}m)`,
      notes: `Estructura portante de cubierta cada 0.60m`,
    },
    {
      code: 'PRD-MLL-C92',
      family: 'Mallas y Radier',
      description:
        'Malla Electrosoldada Acma C-92 Prodalam (Paño 2.40m × 5.00m · 12 m²)',
      quantity: meshSheetsCount,
      unit: 'paños (12 m²)',
      notes: `Cubre ${meshEffectiveAreaM2} m² de losa/radier (incluye 12% traslape)`,
    },
    {
      code: 'PRD-CUB-PV4',
      family: 'Techumbre y Revestimientos',
      description:
        'Plancha Cubierta Acero Prepintado / Zincalum PV4 Prodalam (Esp. 0.40mm)',
      quantity: roofSheetEffectiveM2,
      unit: 'm²',
      notes: `Cubierta de techumbre para ${roofAreaM2} m² en planta + traslape`,
    },
    {
      code: 'PRD-ACM-3D-180',
      family: 'Cierres Perimetrales',
      description:
        'Panel Cerco Acmafor 3D Galvanizado / Verde Prodalam (2.50m × 1.80m)',
      quantity: acmaforPanelsCount,
      unit: 'paneles (2.5m)',
      notes: `Cierre perimetral para ${perimeterClosureLinearM} m (${acmaforPostsCount} postes 60×60mm ó ${wireMeshRolls25m} rollos malla 25m)`,
    },
    {
      code: 'PRD-PST-6060',
      family: 'Cierres Perimetrales',
      description:
        'Poste Metálico Acmafor 60×60×1.5mm con Abrazaderas y Tapa UV',
      quantity: acmaforPostsCount,
      unit: 'unidades',
      notes: '1 poste cada 2.50m de tramo perimetral',
    },
    {
      code: 'PRD-FIJ-autoperf',
      family: 'Fijaciones y Anclajes',
      description:
        'Tornillo Autoperforante Cabeza Lenteja #8×1/2" + Anclajes Losa (Caja 500 u.)',
      quantity: selfDrillingScrewsBoxes,
      unit: 'cajas (500 u.)',
      notes: 'Uniones estructurales Metalcon y fijación a radier',
    },
  ];

  return {
    habitableAreaM2,
    slabFootprintAreaM2,
    roofAreaM2,
    totalWallsLinearM,
    exteriorWallsLinearM,
    interiorWallsLinearM,
    perimeterClosureLinearM,
    wallCount: rawWalls.length,
    roomCount: rawRooms.length,
    openingsCount,
    profileSeries,
    stripLengthMeters,
    materials,
  };
}

/**
 * Genera el texto estructurado listo para copiar al portapapeles o exportar como Ficha Técnica Prodalam.
 */
export function formatProdalamQuoteSummaryText(
  blueprintTitle: string,
  metrics: CommercialMetricsResult
): string {
  const dateStr = new Date().toLocaleDateString('es-CL', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const lines = [
    '========================================================================',
    'PRODALAM RENDER PRO v10.0 · FICHA TÉCNICA Y CUBICACIÓN ESTIMADA',
    '========================================================================',
    `Proyecto / Plano : ${blueprintTitle}`,
    `Fecha Emisión    : ${dateStr}`,
    `Serie Estructural: Metalcon ${metrics.profileSeries} (Tiras de ${metrics.stripLengthMeters}.0m)`,
    '',
    '1. RESUMEN DE MÉTRICAS ARQUITECTÓNICAS',
    '------------------------------------------------------------------------',
    `• Superficie Habitable Construida : ${metrics.habitableAreaM2.toFixed(1)} m²`,
    `• Superficie Losa / Huella Planta : ${metrics.slabFootprintAreaM2.toFixed(1)} m²`,
    `• Superficie Cubierta Techumbre   : ${metrics.roofAreaM2.toFixed(1)} m²`,
    `• Metros Lineales Muros Totales   : ${metrics.totalWallsLinearM.toFixed(1)} m (${metrics.exteriorWallsLinearM.toFixed(1)} m ext. / ${metrics.interiorWallsLinearM.toFixed(1)} m int.)`,
    `• Perímetro de Cierre Exterior    : ${metrics.perimeterClosureLinearM.toFixed(1)} m`,
    `• Vanos Detectados (Puertas/Vent.): ${metrics.openingsCount} unidades`,
    '',
    '2. DESGLOSE ESTIMADO DE MATERIALES PRODALAM',
    '------------------------------------------------------------------------',
    ...metrics.materials.map(
      (item, idx) =>
        `${String(idx + 1).padStart(2, '0')}. [${item.code}] ${item.description}\n    Cantidad: ${item.quantity} ${item.unit} — (${item.notes})`
    ),
    '------------------------------------------------------------------------',
    '* Nota Técnica: Cubicación referencial generada automáticamente a partir',
    '  de los vectores CAD del plano. Sujeta a verificación de cálculo estructural.',
    '========================================================================',
  ];

  return lines.join('\n');
}
