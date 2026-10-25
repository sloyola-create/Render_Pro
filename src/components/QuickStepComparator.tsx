import React, { useState } from 'react';
import {
  AppPhase,
  BlueprintData,
  Spatial3DAnalysisResult,
  ThemeMode,
} from '../types/render';
import { StepComparisonSlider } from './StepComparisonSlider';
import {
  Columns3,
  Eye,
  Layers,
  Maximize2,
  Search,
  SlidersHorizontal,
  Sparkles,
  Sun,
  X,
} from 'lucide-react';

interface QuickStepComparatorProps {
  activePhase: AppPhase;
  theme: ThemeMode;
  blueprint: BlueprintData | null;
  step1Completed: boolean;
  step2Completed: boolean;
  step1CleanImageUrl: string | null;
  step2CgiImageUrl: string | null;
  step3SpatialData: Spatial3DAnalysisResult | null;
  onSelectPhase: (phase: AppPhase) => void;
}

export const QuickStepComparator: React.FC<QuickStepComparatorProps> = ({
  activePhase,
  theme,
  blueprint,
  step1Completed,
  step2Completed,
  step1CleanImageUrl,
  step2CgiImageUrl,
  step3SpatialData,
  onSelectPhase,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [compareMode, setCompareMode] = useState<
    'split' | 'curtain_1_2' | 'overlay_on_3d'
  >('split');
  const [curtainPosition, setCurtainPosition] = useState<number>(50);
  const [overlaySource, setOverlaySource] = useState<'step1' | 'step2'>('step2');
  const [overlayOpacity, setOverlayOpacity] = useState<number>(45);

  const isLight = theme === 'light';

  if (!blueprint || !step1Completed) {
    return null;
  }

  const outdoorZonesCount =
    step3SpatialData?.zones?.filter((z) => z.zoneType === 'outdoor').length ??
    blueprint.rooms.filter(
      (r) => r.zoneType === 'outdoor' || r.type === 'terrace'
    ).length;

  return (
    <>
      {/* Floating Quick-Switch & Comparator Trigger Bar */}
      <div className="fixed top-16 right-5 z-30 flex items-center gap-2">
        {/* 1-Click Instant Step Switcher Pills (Zero Reload via Global State Cache) */}
        <div
          className={`hidden sm:flex items-center gap-1 p-1 rounded-xl border shadow-lg backdrop-blur-md transition-colors ${
            isLight
              ? 'bg-white/95 border-slate-300 text-[#040B29]'
              : 'bg-[#111827]/95 border-slate-700 text-slate-100'
          }`}
        >
          <button
            type="button"
            onClick={() => onSelectPhase('workbench2d')}
            className={`px-2.5 py-1 rounded-lg text-xs font-mono font-semibold transition-colors cursor-pointer ${
              activePhase === 'workbench2d'
                ? 'bg-[#0047BA] text-white'
                : isLight
                  ? 'text-slate-600 hover:bg-slate-100 hover:text-[#040B29]'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
            title="Alternar instantáneamente al Paso 1 (Plano 2D Limpio)"
          >
            1 · Plano 2D
          </button>

          <button
            type="button"
            disabled={!step1Completed}
            onClick={() => {
              if (step1Completed) onSelectPhase('ai2d');
            }}
            className={`px-2.5 py-1 rounded-lg text-xs font-mono font-semibold transition-colors cursor-pointer disabled:opacity-40 ${
              activePhase === 'ai2d'
                ? 'bg-[#0047BA] text-white'
                : isLight
                  ? 'text-slate-600 hover:bg-slate-100 hover:text-[#040B29]'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
            title="Alternar instantáneamente al Paso 2 (Render CGI 2D)"
          >
            2 · Render CGI
          </button>

          <button
            type="button"
            disabled={!step1Completed || !step2Completed}
            onClick={() => {
              if (step1Completed && step2Completed) onSelectPhase('viewer3d');
            }}
            className={`px-2.5 py-1 rounded-lg text-xs font-mono font-semibold transition-colors cursor-pointer disabled:opacity-40 ${
              activePhase === 'viewer3d'
                ? 'bg-[#0047BA] text-white'
                : isLight
                  ? 'text-slate-600 hover:bg-slate-100 hover:text-[#040B29]'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
            title="Alternar instantáneamente al Paso 3 (Entorno 3D con Caché Activa)"
          >
            3 · Visor 3D
            {step3SpatialData && (
              <span className="ml-1 text-[10px] text-emerald-400">●</span>
            )}
          </button>
        </div>

        {/* Primary Floating Button: "🔍 Comparar Pasos 1 · 2 · 3" */}
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-bold shadow-xl transition-all cursor-pointer ${
            isOpen
              ? 'bg-[#FF7A00] text-[#040B29] border-[#FF7A00]'
              : isLight
                ? 'bg-white/95 hover:bg-[#EBF3FF] text-[#040B29] border-[#0047BA]'
                : 'bg-[#040B29]/95 hover:bg-[#002068] text-white border-[#0047BA]'
          }`}
        >
          <Search
            className={`w-3.5 h-3.5 ${
              isOpen ? 'text-[#040B29]' : 'text-[#FF7A00]'
            }`}
          />
          <span>Comparar Pasos 1 · 2 · 3</span>
        </button>
      </div>

      {/* Live Transparent 2D-over-3D Registration Overlay (when compareMode === 'overlay_on_3d' & open in Step 3) */}
      {isOpen &&
        compareMode === 'overlay_on_3d' &&
        activePhase === 'viewer3d' && (
          <div className="fixed inset-x-0 top-14 bottom-20 z-20 pointer-events-none flex items-center justify-center p-8">
            {(overlaySource === 'step2' ? step2CgiImageUrl : step1CleanImageUrl) && (
              <img
                src={
                  (overlaySource === 'step2'
                    ? step2CgiImageUrl
                    : step1CleanImageUrl) || ''
                }
                alt="Superposición de referencia sobre escena 3D"
                referrerPolicy="no-referrer"
                className="max-h-[72vh] max-w-[82vw] object-contain rounded-xl border-2 border-[#FF7A00] shadow-2xl transition-opacity duration-150"
                style={{ opacity: overlayOpacity / 100 }}
              />
            )}
          </div>
        )}

      {/* Split-View / Overlay Comparator Panel */}
      {isOpen && (
        <div
          className={`fixed z-30 transition-all ${
            compareMode === 'overlay_on_3d' && activePhase === 'viewer3d'
              ? 'top-28 right-5 w-[min(460px,94vw)]'
              : 'inset-x-4 top-28 bottom-6 md:inset-x-8 lg:inset-x-12'
          } flex flex-col rounded-2xl border shadow-2xl overflow-hidden ${
            isLight
              ? 'bg-white/98 border-slate-300 text-[#040B29]'
              : 'bg-[#0b111e]/98 border-[#0047BA] text-slate-100'
          }`}
        >
          {/* Comparator Header */}
          <div
            className={`flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b shrink-0 ${
              isLight
                ? 'bg-[#F4F7FB] border-slate-200'
                : 'bg-[#111827] border-slate-800'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#0047BA]/15 border border-[#0047BA]/40 flex items-center justify-center">
                <Columns3 className="w-4 h-4 text-[#FF7A00]" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider">
                    Comparador Rápido de Flujo · Pasos 1 · 2 · 3
                  </h3>
                  {step3SpatialData && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                      Caché 3D Activa en Memoria
                    </span>
                  )}
                </div>
                <p
                  className={`text-[11px] font-mono ${
                    isLight ? 'text-slate-600' : 'text-slate-400'
                  }`}
                >
                  Inspecciona y superpone el Plano 2D Limpio, el Render CGI y el
                  Entorno 3D sin perder estado ni recargar
                </p>
              </div>
            </div>

            {/* Mode Switcher */}
            <div className="flex flex-wrap items-center gap-2">
              <div
                className={`flex items-center gap-1 p-1 rounded-lg border ${
                  isLight
                    ? 'bg-white border-slate-200'
                    : 'bg-[#0b0f19] border-slate-800'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setCompareMode('split')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                    compareMode === 'split'
                      ? 'bg-[#0047BA] text-white'
                      : isLight
                        ? 'text-slate-600 hover:text-[#040B29]'
                        : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Columns3 className="w-3.5 h-3.5" />
                  Vista Dividida (1 · 2 · 3)
                </button>

                <button
                  type="button"
                  onClick={() => setCompareMode('curtain_1_2')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                    compareMode === 'curtain_1_2'
                      ? 'bg-[#0047BA] text-white'
                      : isLight
                        ? 'text-slate-600 hover:text-[#040B29]'
                        : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  Comparar Pasos 1 · 2
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (step2Completed && activePhase !== 'viewer3d') {
                      onSelectPhase('viewer3d');
                    }
                    setCompareMode('overlay_on_3d');
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                    compareMode === 'overlay_on_3d'
                      ? 'bg-[#0047BA] text-white'
                      : isLight
                        ? 'text-slate-600 hover:text-[#040B29]'
                        : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  Superponer sobre 3D
                </button>
              </div>

              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                  isLight
                    ? 'bg-white border-slate-300 text-slate-600 hover:text-[#040B29]'
                    : 'bg-[#0b0f19] border-slate-700 text-slate-300 hover:text-white'
                }`}
                title="Cerrar Comparador"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Body Content based on selected compareMode */}
          {compareMode === 'split' && (
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-4 p-5 overflow-y-auto min-h-0">
              {/* CARD 1: PASO 1 (Plano 2D Vectorial Limpio) */}
              <div
                className={`flex flex-col rounded-xl border overflow-hidden ${
                  isLight
                    ? 'bg-[#F8FAFC] border-slate-200'
                    : 'bg-[#111827] border-slate-800'
                }`}
              >
                <div className="px-4 py-2.5 border-b border-slate-700/30 flex items-center justify-between">
                  <div>
                    <span className="text-[11px] font-mono font-bold text-[#FF7A00]">
                      PASO 1 · MESA 2D
                    </span>
                    <h4 className="text-xs font-semibold">
                      Plano 2D Limpio y Vectorizado
                    </h4>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectPhase('workbench2d');
                      setIsOpen(false);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#0047BA] hover:bg-[#002068] text-white text-[11px] font-semibold cursor-pointer"
                  >
                    <Maximize2 className="w-3 h-3" />
                    Ir al Paso 1
                  </button>
                </div>

                <div className="flex-1 flex items-center justify-center p-4 min-h-[220px] bg-white/5">
                  {step1CleanImageUrl ? (
                    <img
                      src={step1CleanImageUrl}
                      alt="Paso 1 Plano 2D Limpio"
                      referrerPolicy="no-referrer"
                      className="max-h-[42vh] w-auto object-contain rounded-lg border border-slate-700/40 bg-white"
                    />
                  ) : (
                    <p className="text-xs text-slate-400">
                      Plano 2D vectorizado en memoria ({blueprint.walls.length}{' '}
                      muros)
                    </p>
                  )}
                </div>

                <div className="px-4 py-2 border-t border-slate-700/30 text-[11px] font-mono flex items-center justify-between">
                  <span>{blueprint.walls.length} Muros Estructurales</span>
                  <span>
                    {blueprint.totalWidth.toFixed(1)}m ×{' '}
                    {blueprint.totalDepth.toFixed(1)}m
                  </span>
                </div>
              </div>

              {/* CARD 2: PASO 2 (Render CGI Fotorrealista 2D) */}
              <div
                className={`flex flex-col rounded-xl border overflow-hidden ${
                  isLight
                    ? 'bg-[#F8FAFC] border-slate-200'
                    : 'bg-[#111827] border-slate-800'
                }`}
              >
                <div className="px-4 py-2.5 border-b border-slate-700/30 flex items-center justify-between">
                  <div>
                    <span className="text-[11px] font-mono font-bold text-[#FF7A00]">
                      PASO 2 · RENDER CGI IA
                    </span>
                    <h4 className="text-xs font-semibold">
                      Planta 3D Cenital Fotorrealista (90°)
                    </h4>
                  </div>
                  <button
                    type="button"
                    disabled={!step1Completed}
                    onClick={() => {
                      if (step1Completed) {
                        onSelectPhase('ai2d');
                        setIsOpen(false);
                      }
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#0047BA] hover:bg-[#002068] text-white text-[11px] font-semibold cursor-pointer disabled:opacity-40"
                  >
                    <Maximize2 className="w-3 h-3" />
                    Ir al Paso 2
                  </button>
                </div>

                <div className="flex-1 flex items-center justify-center p-4 min-h-[220px] bg-white/5">
                  {step2CgiImageUrl ? (
                    <img
                      src={step2CgiImageUrl}
                      alt="Paso 2 Render CGI 90°"
                      referrerPolicy="no-referrer"
                      className="max-h-[42vh] w-auto object-contain rounded-lg border border-slate-700/40 shadow-lg"
                    />
                  ) : (
                    <div className="text-center space-y-2 p-4">
                      <Sparkles className="w-6 h-6 text-[#FF7A00] mx-auto" />
                      <p className="text-xs text-slate-400">
                        Genera el Render CGI en el Paso 2 para visualizar la
                        textura fotorrealista.
                      </p>
                    </div>
                  )}
                </div>

                <div className="px-4 py-2 border-t border-slate-700/30 text-[11px] font-mono flex items-center justify-between">
                  <span>Textura Base UV 1:1</span>
                  <span className="text-emerald-400">
                    {step2CgiImageUrl ? 'Render CGI Activo ✓' : 'Pendiente'}
                  </span>
                </div>
              </div>

              {/* CARD 3: PASO 3 (Entorno 3D Interactivo + Zonificación Indoor/Outdoor) */}
              <div
                className={`flex flex-col rounded-xl border overflow-hidden ${
                  isLight
                    ? 'bg-[#F8FAFC] border-slate-200'
                    : 'bg-[#111827] border-slate-800'
                }`}
              >
                <div className="px-4 py-2.5 border-b border-slate-700/30 flex items-center justify-between">
                  <div>
                    <span className="text-[11px] font-mono font-bold text-[#FF7A00]">
                      PASO 3 · VISOR 3D INTERACTIVO
                    </span>
                    <h4 className="text-xs font-semibold">
                      Reconstrucción Espacial 3D (Grid 0–1000)
                    </h4>
                  </div>
                  <button
                    type="button"
                    disabled={!step1Completed || !step2Completed}
                    onClick={() => {
                      if (step1Completed && step2Completed) {
                        onSelectPhase('viewer3d');
                        setIsOpen(false);
                      }
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#FF7A00] hover:bg-[#e06900] text-[#040B29] text-[11px] font-bold cursor-pointer disabled:opacity-40"
                  >
                    <Eye className="w-3 h-3" />
                    Abrir 3D en Vivo
                  </button>
                </div>

                <div className="flex-1 flex flex-col justify-between p-4 min-h-[220px] space-y-3">
                  {step2CgiImageUrl && (
                    <div className="relative rounded-lg overflow-hidden border border-[#0047BA]/50 max-h-[26vh] flex items-center justify-center bg-black/30">
                      <img
                        src={step2CgiImageUrl}
                        alt="Mapeo Losa 3D"
                        referrerPolicy="no-referrer"
                        className="max-h-[24vh] w-auto object-contain opacity-90"
                      />
                      <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-[#040B29]/90 border border-[#0047BA] text-[10px] font-mono text-[#A6C8FF]">
                        Losa UV 1:1 + Muros 0.15m
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div
                      className={`p-2.5 rounded-lg border ${
                        isLight
                          ? 'bg-white border-slate-200'
                          : 'bg-[#0b0f19] border-slate-800'
                      }`}
                    >
                      <div className="text-[10px] font-mono text-slate-400">
                        MUROS INTERIORES
                      </div>
                      <div className="text-sm font-bold font-mono text-[#FF7A00]">
                        {step3SpatialData
                          ? step3SpatialData.walls.filter(
                              (w) => w.zoneType !== 'outdoor'
                            ).length
                          : blueprint.walls.length}{' '}
                        segmentos
                      </div>
                    </div>

                    <div
                      className={`p-2.5 rounded-lg border ${
                        isLight
                          ? 'bg-white border-slate-200'
                          : 'bg-[#0b0f19] border-slate-800'
                      }`}
                    >
                      <div className="text-[10px] font-mono text-slate-400">
                        ZONAS EXTERIORES
                      </div>
                      <div className="text-sm font-bold font-mono text-emerald-400 flex items-center gap-1">
                        <Sun className="w-3.5 h-3.5 text-amber-400" />
                        {outdoorZonesCount} abierta(s)
                      </div>
                    </div>

                    <div
                      className={`p-2.5 rounded-lg border ${
                        isLight
                          ? 'bg-white border-slate-200'
                          : 'bg-[#0b0f19] border-slate-800'
                      }`}
                    >
                      <div className="text-[10px] font-mono text-slate-400">
                        ARTEFACTOS 3D
                      </div>
                      <div className="text-sm font-bold font-mono">
                        {step3SpatialData
                          ? step3SpatialData.furniture.length
                          : blueprint.furniture.length}{' '}
                        modelos
                      </div>
                    </div>

                    <div
                      className={`p-2.5 rounded-lg border ${
                        isLight
                          ? 'bg-white border-slate-200'
                          : 'bg-[#0b0f19] border-slate-800'
                      }`}
                    >
                      <div className="text-[10px] font-mono text-slate-400">
                        ESTADO DE CACHÉ
                      </div>
                      <div className="text-xs font-bold font-mono text-emerald-400">
                        {step3SpatialData ? 'Persistente ✓' : 'Listo para 3D'}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="px-4 py-2 border-t border-slate-700/30 text-[11px] font-mono flex items-center justify-between">
                  <span>Zonas Outdoor sin muros perimetrales</span>
                  <span className="text-[#FF7A00] font-semibold">T = 0.0</span>
                </div>
              </div>
            </div>
          )}

          {/* Mode 2: Interactive Split Curtain comparing Step 1 (2D Clean Vector) vs Step 2 (CGI Render) */}
          {compareMode === 'curtain_1_2' && (
            <div className="flex-1 flex flex-col p-5 overflow-hidden min-h-0">
              <StepComparisonSlider
                step1ImageUrl={step1CleanImageUrl}
                step2ImageUrl={step2CgiImageUrl}
                theme={theme}
                blueprintTitle={blueprint.title}
              />
            </div>
          )}

          {/* Mode 3: Compact Control Card when Superimposing 2D/CGI directly over the live 3D Viewer */}
          {compareMode === 'overlay_on_3d' && (
            <div className="p-4 space-y-3">
              <p className="text-xs leading-relaxed">
                Superpone el plano 2D del Paso 1 o el Render CGI del Paso 2
                directamente sobre el visor 3D interactivo para inspeccionar la
                alineación:
              </p>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOverlaySource('step1')}
                  className={`flex-1 py-1.5 px-3 rounded-lg border text-xs font-semibold cursor-pointer ${
                    overlaySource === 'step1'
                      ? 'bg-[#0047BA] text-white border-[#0047BA]'
                      : 'border-slate-700 text-slate-300'
                  }`}
                >
                  Superponer Paso 1 (2D)
                </button>
                <button
                  type="button"
                  onClick={() => setOverlaySource('step2')}
                  className={`flex-1 py-1.5 px-3 rounded-lg border text-xs font-semibold cursor-pointer ${
                    overlaySource === 'step2'
                      ? 'bg-[#0047BA] text-white border-[#0047BA]'
                      : 'border-slate-700 text-slate-300'
                  }`}
                >
                  Superponer Paso 2 (CGI)
                </button>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <span className="text-xs font-mono whitespace-nowrap">
                  Opacidad Superposición:
                </span>
                <input
                  type="range"
                  min={0}
                  max={95}
                  value={overlayOpacity}
                  onChange={(e) => setOverlayOpacity(Number(e.target.value))}
                  className="flex-1 accent-[#FF7A00] cursor-pointer"
                />
                <span className="text-xs font-mono font-bold text-[#FF7A00] w-10 text-right">
                  {overlayOpacity}%
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
};
