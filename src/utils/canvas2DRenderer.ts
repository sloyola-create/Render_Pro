import { BlueprintData, Controls2DState, ThemeMode } from '../types/render';
import { renderTopDown3DFloorPlan } from './topDown3DRenderer';

/**
 * Renders the user's uploaded 2D Plan (Image or DXF Vector) onto a 2D Canvas:
 * - 'drafting' mode (Paso 1):
 *   • Before vector extraction (`showExtractedVectorsOverlay = false`): Shows the uploaded plan/DXF
 *     with live calibration controls (Grid, Grayscale, Invert Colors, Line Thickness).
 *   • After vector extraction (`showExtractedVectorsOverlay = true`): Highlights the detected
 *     wall segments, vector lines, and corner vertices directly over the 2D canvas so the user
 *     can visually validate the extracted geometry before advancing to Paso 2.
 * - 'enhanced' mode (Paso 2 - Motor de Render 3D Cenital de Alta Gama):
 *   Delegates to the Three.js Orthographic 90° Top-Down 3D Architectural Renderer (`renderTopDown3DFloorPlan`).
 */
export function renderBlueprint2DCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  blueprint: BlueprintData,
  controls: Controls2DState,
  uploadedImage: HTMLImageElement | null,
  mode: 'drafting' | 'enhanced' = 'drafting',
  theme: ThemeMode = 'dark',
  showExtractedVectorsOverlay: boolean = false
) {
  if (mode === 'enhanced') {
    renderTopDown3DFloorPlan(
      ctx,
      width,
      height,
      blueprint,
      controls,
      uploadedImage,
      theme
    );
    return;
  }

  ctx.save();

  const isLightSurface =
    (theme === 'light' && !controls.invertColors) ||
    (theme === 'dark' && controls.invertColors);

  const bgHex = isLightSurface ? '#f4f7fb' : '#0b0f19';

  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, width, height);

  // Technical Grid
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
          ? 'rgba(0, 71, 186, 0.15)'
          : 'rgba(4, 11, 41, 0.05)'
        : isMajor
          ? 'rgba(166, 200, 255, 0.14)'
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
          ? 'rgba(0, 71, 186, 0.15)'
          : 'rgba(4, 11, 41, 0.05)'
        : isMajor
          ? 'rgba(166, 200, 255, 0.14)'
          : 'rgba(148, 163, 184, 0.04)';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }

  // Transform origin to center with pan and zoom
  ctx.save();
  ctx.translate(width / 2 + controls.panX, height / 2 + controls.panY);

  const baseScale =
    Math.min(width, height) /
    Math.max(blueprint.totalWidth * 1.45, blueprint.totalDepth * 1.45, 8);
  const pxPerMeter = baseScale * controls.zoom;

  const planW = blueprint.totalWidth * pxPerMeter;
  const planH = blueprint.totalDepth * pxPerMeter;

  // =========================================================================
  // MODO 'DRAFTING' (PASO 1): MESA DE TRABAJO TÉCNICA 2D + OVERLAY VECTORIAL
  // =========================================================================
  const filters: string[] = [];
  if (controls.grayscale) filters.push('grayscale(100%)');
  if (controls.invertColors && uploadedImage) filters.push('invert(100%)');
  ctx.filter = filters.length > 0 ? filters.join(' ') : 'none';

  const lineMul = controls.lineThickness;
  const fgPrimary = isLightSurface ? '#040B29' : '#f1f5f9';

  // 1. Base Layer: Uploaded Image, DXF Polylines, or PDF Outline
  if (uploadedImage) {
    ctx.save();
    if (showExtractedVectorsOverlay) {
      // Slightly dim the raw bitmap when highlighting extracted vector walls on top
      ctx.globalAlpha = 0.65;
    }
    ctx.drawImage(uploadedImage, -planW / 2, -planH / 2, planW, planH);

    ctx.strokeStyle = isLightSurface ? '#0047BA' : '#A6C8FF';
    ctx.lineWidth = Math.max(1.2, controls.lineThickness * 0.65);
    ctx.strokeRect(-planW / 2, -planH / 2, planW, planH);
    ctx.restore();
  } else if (blueprint.rawPolylines && blueprint.rawPolylines.length > 0) {
    ctx.strokeStyle = fgPrimary;
    ctx.lineWidth = Math.max(1, lineMul);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const poly of blueprint.rawPolylines) {
      if (poly.points.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(poly.points[0].x * pxPerMeter, poly.points[0].y * pxPerMeter);
      for (let i = 1; i < poly.points.length; i++) {
        ctx.lineTo(
          poly.points[i].x * pxPerMeter,
          poly.points[i].y * pxPerMeter
        );
      }
      if (poly.closed) ctx.closePath();
      ctx.stroke();
    }
  } else {
    for (const wall of blueprint.walls) {
      const x1 = wall.x1 * pxPerMeter;
      const z1 = wall.z1 * pxPerMeter;
      const x2 = wall.x2 * pxPerMeter;
      const z2 = wall.z2 * pxPerMeter;

      ctx.strokeStyle = fgPrimary;
      ctx.lineWidth = Math.max(1.5, lineMul);
      ctx.lineCap = 'square';

      ctx.beginPath();
      ctx.moveTo(x1, z1);
      ctx.lineTo(x2, z2);
      ctx.stroke();
    }
  }

  // 2. Highlighted Vector Overlay after clicking "⚙️ Procesar y Extraer Vectores 2D"
  if (showExtractedVectorsOverlay) {
    ctx.save();
    ctx.filter = 'none';

    for (const wall of blueprint.walls) {
      const x1 = wall.x1 * pxPerMeter;
      const z1 = wall.z1 * pxPerMeter;
      const x2 = wall.x2 * pxPerMeter;
      const z2 = wall.z2 * pxPerMeter;

      // Outer vector glow
      ctx.strokeStyle = wall.isExterior
        ? 'rgba(255, 122, 0, 0.38)'
        : 'rgba(0, 71, 186, 0.38)';
      ctx.lineWidth = Math.max(5, lineMul * 2.6);
      ctx.lineCap = 'square';
      ctx.beginPath();
      ctx.moveTo(x1, z1);
      ctx.lineTo(x2, z2);
      ctx.stroke();

      // Core extracted structural vector line
      ctx.strokeStyle = wall.isExterior ? '#FF7A00' : '#0047BA';
      ctx.lineWidth = Math.max(2.2, lineMul * 1.15);
      ctx.beginPath();
      ctx.moveTo(x1, z1);
      ctx.lineTo(x2, z2);
      ctx.stroke();

      // Vertex node markers at wall endpoints
      ctx.fillStyle = '#10b981';
      ctx.strokeStyle = '#040B29';
      ctx.lineWidth = 1;
      for (const [vx, vz] of [
        [x1, z1],
        [x2, z2],
      ]) {
        ctx.beginPath();
        ctx.arc(vx, vz, 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  ctx.restore();
  ctx.restore();
}
