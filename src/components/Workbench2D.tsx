import React, { useEffect, useRef, useState } from 'react';
import { BlueprintData, Controls2DState, ThemeMode } from '../types/render';
import { renderBlueprint2DCanvas } from '../utils/canvas2DRenderer';
import {
  CheckCircle2,
  Cog,
  Contrast,
  Eye,
  EyeOff,
  FileCheck2,
  FileUp,
  Grid,
  Loader2,
  Palette,
  RotateCcw,
  Sliders,
  Trash2,
  UploadCloud,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

interface Workbench2DProps {
  blueprint: BlueprintData | null;
  controls: Controls2DState;
  theme: ThemeMode;
  uploadedFileName: string | null;
  uploadedFileSize: string | null;
  uploadedImage: HTMLImageElement | null;
  step1Completed: boolean;
  onProcessStep1Vectors: () => void | Promise<void>;
  onUpdateControls: (patch: Partial<Controls2DState>) => void;
  onFileDrop: (file: File) => void;
  onClearFile: () => void;
  onProceedToPhase2: () => void;
}

export const Workbench2D: React.FC<Workbench2DProps> = ({
  blueprint,
  controls,
  theme,
  uploadedFileName,
  uploadedFileSize,
  uploadedImage,
  step1Completed,
  onProcessStep1Vectors,
  onUpdateControls,
  onFileDrop,
  onClearFile,
  onProceedToPhase2,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  // By default, the colored diagnostic vector overlay is HIDDEN so the enhanced blueprint stays 100% clean
  const [showVectorOverlay, setShowVectorOverlay] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, origX: 0, origY: 0 });

  const hasLoadedFile = Boolean(blueprint && uploadedFileName);
  const isLight = theme === 'light';

  // Ensure overlay resets to hidden whenever step1Completed resets
  useEffect(() => {
    if (!step1Completed) {
      setShowVectorOverlay(false);
    }
  }, [step1Completed]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const draw = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(300, Math.floor(rect.width * dpr));
      canvas.height = Math.max(300, Math.floor(rect.height * dpr));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      if (!blueprint) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      renderBlueprint2DCanvas(
        ctx,
        rect.width,
        rect.height,
        blueprint,
        controls,
        uploadedImage,
        'drafting',
        theme,
        step1Completed && showVectorOverlay
      );
      ctx.restore();
    };

    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [blueprint, controls, uploadedImage, theme, step1Completed, showVectorOverlay]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFileDrop(file);
  };

  const handleTriggerVectorExtraction = async () => {
    if (!hasLoadedFile || isExtracting) return;
    setIsExtracting(true);
    // Keep colored overlay off by default so the user sees the clean, sharpened HD blueprint
    setShowVectorOverlay(false);
    await new Promise((resolve) => setTimeout(resolve, 380));
    await onProcessStep1Vectors();
    setIsExtracting(false);
  };

  const handleAdvanceToStep2 = () => {
    // Automatically hide the diagnostic vector overlay before advancing to Step 2
    setShowVectorOverlay(false);
    onProceedToPhase2();
  };

  return (
    <div
      className={`flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0 transition-colors ${
        isLight ? 'bg-[#F4F7FB] text-[#040B29]' : 'bg-[#0b0f19] text-slate-100'
      }`}
    >
      {/* Left Column: Clean 2D Controls & Conscious Calibration + Vector Extraction Flow */}
      <aside
        className={`lg:col-span-4 xl:col-span-3 border-r p-6 flex flex-col justify-between overflow-y-auto transition-colors ${
          isLight
            ? 'bg-white border-slate-200'
            : 'bg-[#111827] border-slate-800/90'
        }`}
      >
        <div className="space-y-5">
          {/* Header & Step Status Badge */}
          <div>
            <div className="flex items-center justify-between gap-2">
              <div
                className={`flex items-center gap-2 text-xs font-mono ${
                  isLight ? 'text-[#0047BA]' : 'text-[#A6C8FF]'
                }`}
              >
                <span className="text-[#FF7A00] font-semibold">v1.0</span>
                <span aria-hidden="true">·</span>
                <span>PASO 1 DE 3</span>
              </div>

              {hasLoadedFile && !step1Completed && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-[#FF7A00]/15 text-[#FF7A00] border border-[#FF7A00]/40">
                  Paso 1: En Calibración
                </span>
              )}
              {step1Completed && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-emerald-500/15 text-emerald-500 border border-emerald-500/40">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Paso 1 Completado ✓
                </span>
              )}
            </div>

            <h1
              className={`text-xl font-bold mt-1.5 text-balance ${
                isLight ? 'text-[#040B29]' : 'text-slate-100'
              }`}
            >
              Mesa 2D y Pre-procesamiento Vectorial
            </h1>
            <p
              className={`text-xs mt-1.5 leading-relaxed ${
                isLight ? 'text-slate-600' : 'text-slate-400'
              }`}
            >
              Carga tu archivo, calibra el lienzo y presiona «Procesar y Extraer Vectores 2D» para limpiar el ruido de fondo, definir trazos en HD y extraer los vectores en segundo plano.
            </p>
          </div>

          {/* File Status Card (Only shows real uploaded file info) */}
          <div
            className={`rounded-xl border p-4 transition-colors ${
              isLight
                ? 'bg-[#F8FAFC] border-slate-200'
                : 'bg-[#0b0f19] border-slate-800'
            }`}
          >
            {hasLoadedFile ? (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FileCheck2 className="w-5 h-5 text-[#FF7A00] shrink-0" />
                    <div className="min-w-0">
                      <p
                        className={`text-xs font-semibold truncate ${
                          isLight ? 'text-[#040B29]' : 'text-slate-100'
                        }`}
                      >
                        {uploadedFileName}
                      </p>
                      {uploadedFileSize && (
                        <p className="text-[11px] font-mono text-slate-400 mt-0.5">
                          {uploadedFileSize}
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={onClearFile}
                    className={`p-1.5 rounded-lg transition-colors shrink-0 cursor-pointer ${
                      isLight
                        ? 'text-slate-500 hover:text-red-600 hover:bg-slate-200/60'
                        : 'text-slate-400 hover:text-red-400 hover:bg-slate-800'
                    }`}
                    title="Quitar archivo"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className={`w-full py-1.5 px-3 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                    isLight
                      ? 'text-[#0047BA] bg-[#EBF3FF] hover:bg-[#A6C8FF]/40 border-[#A6C8FF]'
                      : 'text-[#A6C8FF] bg-[#0047BA]/20 hover:bg-[#0047BA]/30 border-[#0047BA]/50'
                  }`}
                >
                  Reemplazar archivo 2D
                </button>
              </div>
            ) : (
              <div
                className={`flex items-center gap-3 ${
                  isLight ? 'text-slate-600' : 'text-slate-400'
                }`}
              >
                <FileUp className="w-5 h-5 text-[#0047BA] shrink-0" />
                <div className="text-xs leading-relaxed">
                  Sin archivo cargado. Utiliza la zona central para arrastrar o seleccionar tu plano.
                </div>
              </div>
            )}
          </div>

          {/* 2D Visualization & Calibration Controls */}
          <div
            className={`space-y-3 pt-4 border-t transition-opacity ${
              isLight ? 'border-slate-200' : 'border-slate-800'
            } ${hasLoadedFile ? 'opacity-100' : 'opacity-45 pointer-events-none'}`}
          >
            <div className="flex items-center justify-between">
              <span
                className={`text-xs font-semibold ${
                  isLight ? 'text-[#040B29]' : 'text-slate-300'
                }`}
              >
                Controles de Visualización y Calibración 2D
              </span>
              {hasLoadedFile ? (
                <span className="text-[11px] font-mono text-[#FF7A00] font-semibold">
                  Activo
                </span>
              ) : (
                <span className="text-[11px] font-mono text-slate-400">
                  Requiere plano
                </span>
              )}
            </div>

            {/* Switch: Technical Grid */}
            <label className="flex items-center justify-between py-1.5 cursor-pointer">
              <span
                className={`flex items-center gap-2 text-xs ${
                  isLight ? 'text-slate-700' : 'text-slate-300'
                }`}
              >
                <Grid className="w-3.5 h-3.5 text-[#0047BA] dark:text-[#A6C8FF]" />
                Cuadrícula Técnica (Grid)
              </span>
              <input
                type="checkbox"
                disabled={!hasLoadedFile}
                checked={controls.showGrid}
                onChange={(e) => onUpdateControls({ showGrid: e.target.checked })}
                className="w-4 h-4 accent-[#0047BA] rounded cursor-pointer disabled:cursor-not-allowed"
              />
            </label>

            {/* Switch: Grayscale */}
            <label className="flex items-center justify-between py-1.5 cursor-pointer">
              <span
                className={`flex items-center gap-2 text-xs ${
                  isLight ? 'text-slate-700' : 'text-slate-300'
                }`}
              >
                <Contrast className="w-3.5 h-3.5 text-[#0047BA] dark:text-[#A6C8FF]" />
                Filtro Escala de Grises
              </span>
              <input
                type="checkbox"
                disabled={!hasLoadedFile}
                checked={controls.grayscale}
                onChange={(e) => onUpdateControls({ grayscale: e.target.checked })}
                className="w-4 h-4 accent-[#0047BA] rounded cursor-pointer disabled:cursor-not-allowed"
              />
            </label>

            {/* Switch: Color Inversion */}
            <label className="flex items-center justify-between py-1.5 cursor-pointer">
              <span
                className={`flex items-center gap-2 text-xs ${
                  isLight ? 'text-slate-700' : 'text-slate-300'
                }`}
              >
                <Palette className="w-3.5 h-3.5 text-[#0047BA] dark:text-[#A6C8FF]" />
                Inversión de Colores
              </span>
              <input
                type="checkbox"
                disabled={!hasLoadedFile}
                checked={controls.invertColors}
                onChange={(e) => onUpdateControls({ invertColors: e.target.checked })}
                className="w-4 h-4 accent-[#0047BA] rounded cursor-pointer disabled:cursor-not-allowed"
              />
            </label>

            {/* Slider: Line Thickness */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-xs">
                <span
                  className={`flex items-center gap-2 ${
                    isLight ? 'text-slate-700' : 'text-slate-300'
                  }`}
                >
                  <Sliders className="w-3.5 h-3.5 text-[#0047BA] dark:text-[#A6C8FF]" />
                  Grosor de Líneas (DXF / Vector)
                </span>
                <span className="font-mono text-[#FF7A00] font-semibold tabular-nums">
                  {controls.lineThickness.toFixed(1)} px
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={5}
                step={0.5}
                disabled={!hasLoadedFile}
                value={controls.lineThickness}
                onChange={(e) => onUpdateControls({ lineThickness: parseFloat(e.target.value) })}
                className="w-full accent-[#0047BA] cursor-pointer disabled:cursor-not-allowed"
              />
            </div>
          </div>
        </div>

        {/* Conscious Vector Extraction Action -> Sequential Unlock of Paso 2 */}
        <div
          className={`space-y-3 pt-5 border-t mt-6 ${
            isLight ? 'border-slate-200' : 'border-slate-800'
          }`}
        >
          {/* Status Indicator before vs after extraction */}
          {!hasLoadedFile && (
            <div className="text-[11px] font-mono text-slate-400 text-center">
              Carga un archivo para iniciar la calibración del Paso 1
            </div>
          )}

          {hasLoadedFile && !step1Completed && (
            <div
              className={`rounded-lg border px-3 py-2 text-xs font-mono flex items-center justify-between ${
                isLight
                  ? 'bg-amber-50 border-amber-300 text-[#040B29]'
                  : 'bg-[#1c1613] border-[#FF7A00]/50 text-slate-200'
              }`}
            >
              <span className="text-[#FF7A00] font-semibold">
                Paso 1: En Calibración
              </span>
              <span className="text-[11px] text-slate-400">
                Listo para extraer
              </span>
            </div>
          )}

          {/* Primary Action Button: ⚙️ Procesar y Extraer Vectores 2D */}
          <button
            type="button"
            disabled={!hasLoadedFile || isExtracting}
            onClick={handleTriggerVectorExtraction}
            className={`w-full flex items-center justify-center gap-2 py-3 px-4 text-xs font-bold rounded-lg transition-all whitespace-nowrap cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-md ${
              step1Completed
                ? isLight
                  ? 'bg-[#EBF3FF] hover:bg-[#dbeafe] text-[#0047BA] border border-[#0047BA]'
                  : 'bg-[#161f30] hover:bg-[#1e293b] text-[#A6C8FF] border border-[#0047BA]'
                : 'bg-[#0047BA] hover:bg-[#002068] text-white'
            }`}
          >
            {isExtracting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-[#FF7A00] shrink-0" />
                <span>Mejorando trazos HD y extrayendo vectores...</span>
              </>
            ) : (
              <>
                <Cog className="w-4 h-4 text-[#FF7A00] shrink-0" />
                <span>⚙️ Procesar y Extraer Vectores 2D</span>
              </>
            )}
          </button>

          {/* Post-Extraction Result Metric & Unlocked Paso 2 Button (ONLY shown after step1Completed) */}
          {step1Completed && blueprint && (
            <div className="space-y-3 pt-1">
              <div
                className={`rounded-lg border px-3.5 py-2.5 text-xs space-y-1 ${
                  isLight
                    ? 'bg-emerald-50 border-emerald-300 text-[#040B29]'
                    : 'bg-emerald-950/30 border-emerald-500/40 text-slate-100'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span className="font-semibold text-emerald-500">
                      Paso 1 Completado ✓
                    </span>
                  </div>
                  <span className="font-mono font-bold">
                    {blueprint.walls.length} muros extraídos con éxito
                  </span>
                </div>
                <p
                  className={`text-[11px] font-mono ${
                    isLight ? 'text-slate-600' : 'text-slate-400'
                  }`}
                >
                  Imagen limpiada en HD · Vectores listos en segundo plano (JSON)
                </p>
              </div>

              <button
                type="button"
                onClick={handleAdvanceToStep2}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-[#FF7A00] hover:bg-[#e06900] text-[#040B29] text-xs font-bold rounded-lg transition-all whitespace-nowrap cursor-pointer shadow-lg"
              >
                <span>Continuar al Paso 2: Render 2D Cenital 3D →</span>
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Right Column: Main 2D Canvas or Prominent Clean-Slate Empty State */}
      <section
        ref={containerRef}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDraggingOver(true);
        }}
        onDragLeave={() => setIsDraggingOver(false)}
        onDrop={handleDrop}
        onMouseDown={(e) => {
          if (!hasLoadedFile) return;
          setIsPanning(true);
          panStartRef.current = {
            x: e.clientX,
            y: e.clientY,
            origX: controls.panX,
            origY: controls.panY,
          };
        }}
        onMouseMove={(e) => {
          if (!isPanning || !hasLoadedFile) return;
          onUpdateControls({
            panX: panStartRef.current.origX + (e.clientX - panStartRef.current.x),
            panY: panStartRef.current.origY + (e.clientY - panStartRef.current.y),
          });
        }}
        onMouseUp={() => setIsPanning(false)}
        onMouseLeave={() => setIsPanning(false)}
        className={`lg:col-span-8 xl:col-span-9 relative overflow-hidden select-none min-h-[520px] transition-colors ${
          isLight ? 'bg-[#F4F7FB]' : 'bg-[#0b0f19]'
        } ${hasLoadedFile ? 'cursor-grab active:cursor-grabbing' : ''}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.pdf,.dxf"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFileDrop(f);
            e.target.value = '';
          }}
          className="hidden"
        />

        {/* Underlying 2D Canvas (Initialized completely blank until a file is loaded) */}
        <canvas ref={canvasRef} className="w-full h-full block" />

        {/* Prominent Empty State when no file is loaded */}
        {!hasLoadedFile && (
          <div className="absolute inset-0 flex items-center justify-center p-8">
            <div
              onClick={() => fileInputRef.current?.click()}
              className={`max-w-xl w-full rounded-2xl border-2 border-dashed p-10 text-center transition-all cursor-pointer ${
                isDraggingOver
                  ? 'border-[#FF7A00] bg-[#0047BA]/10'
                  : isLight
                    ? 'border-[#A6C8FF] bg-white hover:border-[#0047BA] shadow-lg'
                    : 'border-slate-700/90 bg-[#111827]/95 hover:border-[#0047BA] shadow-2xl'
              }`}
            >
              <div
                className={`w-14 h-14 rounded-2xl border flex items-center justify-center mx-auto mb-5 ${
                  isLight
                    ? 'bg-[#EBF3FF] border-[#A6C8FF]'
                    : 'bg-[#040B29] border-[#002068]'
                }`}
              >
                <UploadCloud className="w-7 h-7 text-[#FF7A00]" />
              </div>

              <h2
                className={`text-lg font-bold text-balance ${
                  isLight ? 'text-[#040B29]' : 'text-slate-100'
                }`}
              >
                Esperando plano 2D: Arrastra o selecciona un archivo para comenzar
              </h2>

              <p
                className={`text-xs mt-2 max-w-md mx-auto leading-relaxed ${
                  isLight ? 'text-slate-600' : 'text-slate-400'
                }`}
              >
                Sube una lámina arquitectónica, plano de distribución, elevación de fachada o dibujo técnico de ingeniería para iniciar el pre-procesamiento en el Paso 1.
              </p>

              <div className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#0047BA] hover:bg-[#002068] text-xs font-semibold text-white transition-colors shadow-sm">
                Seleccionar Archivo desde el Equipo
              </div>

              <div
                className={`mt-6 pt-5 border-t flex items-center justify-center gap-3 text-xs font-mono ${
                  isLight
                    ? 'border-slate-200 text-[#0047BA]'
                    : 'border-slate-800/90 text-[#A6C8FF]'
                }`}
              >
                <span>PNG</span>
                <span aria-hidden="true">·</span>
                <span>JPG</span>
                <span aria-hidden="true">·</span>
                <span>WEBP</span>
                <span aria-hidden="true">·</span>
                <span>PDF</span>
                <span aria-hidden="true">·</span>
                <span>DXF</span>
              </div>
            </div>
          </div>
        )}

        {/* Active File Top-Left Badge, Top-Right Optional Vector Diagnostic Toggle & Bottom-Right Zoom Controls */}
        {hasLoadedFile && blueprint && (
          <>
            <div
              className={`absolute top-4 left-5 border rounded-lg px-4 py-2.5 pointer-events-none shadow-md ${
                isLight
                  ? 'bg-white/95 border-slate-200 text-[#040B29]'
                  : 'bg-[#111827]/95 border-slate-800 text-slate-100'
              }`}
            >
              <div className="flex items-center gap-2 text-xs font-mono font-semibold">
                {step1Completed ? (
                  <span className="text-emerald-500">
                    PASO 1 COMPLETADO ✓ · PLANO HD LIMPIO ({blueprint.walls.length} MUROS EN JSON)
                  </span>
                ) : (
                  <span className="text-[#FF7A00]">
                    PASO 1: EN CALIBRACIÓN · AJUSTA CONTROLES Y EXTRAE VECTORES
                  </span>
                )}
                {uploadedFileSize && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className={isLight ? 'text-[#0047BA]' : 'text-[#A6C8FF]'}>
                      {uploadedFileSize}
                    </span>
                  </>
                )}
              </div>
              <div className="text-sm font-semibold mt-0.5">{uploadedFileName}</div>
              {step1Completed && showVectorOverlay && (
                <div className="flex items-center gap-3 mt-1 text-[11px] font-mono text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-xs bg-[#FF7A00] inline-block" />
                    Muros Perimetrales
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-xs bg-[#0047BA] inline-block" />
                    Tabiquería Interior
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                    Nodos Vectoriales
                  </span>
                </div>
              )}
            </div>

            {/* Top-Right Optional Diagnostic Overlay Toggle (Hidden by default so image stays clean) */}
            {step1Completed && (
              <div className="absolute top-4 right-5 z-10">
                <button
                  type="button"
                  onClick={() => setShowVectorOverlay((prev) => !prev)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-lg border text-xs font-semibold shadow-lg transition-colors cursor-pointer ${
                    showVectorOverlay
                      ? 'bg-[#0047BA] border-[#0047BA] text-white'
                      : isLight
                        ? 'bg-white/95 border-slate-300 text-[#040B29] hover:border-[#0047BA]'
                        : 'bg-[#111827]/95 border-slate-700 text-slate-200 hover:border-[#0047BA]'
                  }`}
                >
                  {showVectorOverlay ? (
                    <EyeOff className="w-3.5 h-3.5 text-[#FF7A00]" />
                  ) : (
                    <Eye className="w-3.5 h-3.5 text-[#FF7A00]" />
                  )}
                  <span>👁️ Mostrar / Ocultar Capa Vectorial</span>
                </button>
              </div>
            )}

            <div
              className={`absolute bottom-5 right-5 flex items-center gap-1.5 border rounded-lg p-1.5 shadow-xl ${
                isLight
                  ? 'bg-white border-slate-300 text-[#040B29]'
                  : 'bg-[#111827] border-slate-700 text-slate-200'
              }`}
            >
              <button
                type="button"
                onClick={() => onUpdateControls({ zoom: Math.max(0.5, controls.zoom - 0.15) })}
                className="p-1.5 hover:bg-[#0047BA]/10 rounded transition-colors cursor-pointer"
                title="Alejar"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-xs font-mono px-2 tabular-nums font-semibold">
                {Math.round(controls.zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => onUpdateControls({ zoom: Math.min(2.5, controls.zoom + 0.15) })}
                className="p-1.5 hover:bg-[#0047BA]/10 rounded transition-colors cursor-pointer"
                title="Acercar"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => onUpdateControls({ zoom: 1, panX: 0, panY: 0 })}
                className={`p-1.5 hover:bg-[#0047BA]/10 rounded transition-colors border-l pl-2 cursor-pointer ${
                  isLight ? 'border-slate-200' : 'border-slate-700'
                }`}
                title="Centrar Plano"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
};
