import React, { useEffect } from 'react';
import {
  BlueprintData,
  RenderType,
  Spatial3DAnalysisResult,
  ThemeMode,
} from '../types/render';
import { Interior3DViewer } from './viewers/Interior3DViewer';
import { Building2, Cog, Home, Lock } from 'lucide-react';

interface Immersive3DViewerProps {
  blueprint: BlueprintData;
  theme: ThemeMode;
  step2RenderUrl?: string | null;
  cachedSpatialData?: Spatial3DAnalysisResult | null;
  cachedSpatialSourceUrl?: string | null;
  onSaveSpatialData?: (data: Spatial3DAnalysisResult, sourceUrl: string) => void;
  onSelectRenderType: (type: RenderType) => void;
  readOnlyMode?: boolean;
  sharedModelUrl?: string | null;
  sharedTaskId?: string | null;
  onOpenShareModal?: (info: {
    modelUrl: string | null;
    taskId: string | null;
  }) => void;
  onOpenCommercialQuote?: () => void;
  onExitReadOnlyMode?: () => void;
}

export const Immersive3DViewer: React.FC<Immersive3DViewerProps> = ({
  blueprint,
  theme,
  step2RenderUrl,
  cachedSpatialData,
  cachedSpatialSourceUrl,
  onSaveSpatialData,
  onSelectRenderType,
  readOnlyMode = false,
  sharedModelUrl = null,
  sharedTaskId = null,
  onOpenShareModal,
  onOpenCommercialQuote,
  onExitReadOnlyMode,
}) => {
  const isLight = theme === 'light';

  const isProductCategory =
    blueprint.category === 'C' || blueprint.renderType === 'product';

  // Detect whether the analyzed blueprint is an interior floor plan distribution (excluding Category C / Product)
  const isInteriorFloorPlan =
    !isProductCategory &&
    blueprint.walls.length > 0 &&
    !/fachada|elevacion|elevation|alzado/i.test(blueprint.title || '');

  useEffect(() => {
    if (blueprint.category === 'C' && blueprint.renderType !== 'product') {
      onSelectRenderType('product');
      return;
    }
    if (isInteriorFloorPlan && blueprint.renderType === 'exterior') {
      onSelectRenderType('interior');
    }
  }, [
    blueprint.category,
    isInteriorFloorPlan,
    blueprint.renderType,
    onSelectRenderType,
  ]);

  const effectiveRenderType: RenderType =
    blueprint.category === 'C'
      ? 'product'
      : isInteriorFloorPlan && blueprint.renderType === 'exterior'
        ? 'interior'
        : blueprint.renderType;

  return (
    <div
      className={`relative w-full h-full flex-1 overflow-hidden transition-colors ${
        isLight ? 'bg-[#EBF3FF]' : 'bg-[#0b0f19]'
      }`}
    >
      {/* Top-Center Subsystem Switcher (Hidden in Read-Only 360° Share View) */}
      {!readOnlyMode && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1.5">
          <div
            className={`flex items-center gap-1 p-1 border rounded-lg shadow-lg transition-colors ${
              isLight
                ? 'bg-white border-slate-300'
                : 'bg-[#111827] border-slate-700/90'
            }`}
          >
            <button
              type="button"
              onClick={() => onSelectRenderType('interior')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                effectiveRenderType === 'interior'
                  ? 'bg-[#0047BA] text-white'
                  : isLight
                    ? 'text-slate-600 hover:text-[#040B29]'
                    : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Home className="w-3.5 h-3.5" />
              Interior / Distribución
            </button>

            <button
              type="button"
              disabled={isInteriorFloorPlan}
              onClick={() => {
                if (!isInteriorFloorPlan) onSelectRenderType('exterior');
              }}
              title={
                isInteriorFloorPlan
                  ? 'Vista Exterior disponible únicamente al cargar planos de elevación/fachada'
                  : 'Cambiar a Vista Exterior / Fachada'
              }
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                isInteriorFloorPlan
                  ? isLight
                    ? 'opacity-45 cursor-not-allowed text-slate-400 bg-slate-100'
                    : 'opacity-45 cursor-not-allowed text-slate-500 bg-slate-900/60'
                  : effectiveRenderType === 'exterior'
                    ? 'bg-[#0047BA] text-white cursor-pointer'
                    : isLight
                      ? 'text-slate-600 hover:text-[#040B29] cursor-pointer'
                      : 'text-slate-400 hover:text-slate-200 cursor-pointer'
              }`}
            >
              {isInteriorFloorPlan ? (
                <Lock className="w-3.5 h-3.5 text-[#FF7A00]" />
              ) : (
                <Building2 className="w-3.5 h-3.5" />
              )}
              Exterior / Fachada
            </button>

            <button
              type="button"
              onClick={() => onSelectRenderType('product')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                effectiveRenderType === 'product'
                  ? 'bg-[#0047BA] text-white'
                  : isLight
                    ? 'text-slate-600 hover:text-[#040B29]'
                    : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Cog className="w-3.5 h-3.5" />
              Producto / Ingeniería
            </button>
          </div>

          {isInteriorFloorPlan && (
            <div
              className={`px-3 py-1 rounded-md border text-[11px] font-mono shadow-sm pointer-events-none ${
                isLight
                  ? 'bg-white/95 border-slate-200 text-slate-600'
                  : 'bg-[#111827]/95 border-slate-800 text-slate-300'
              }`}
            >
              <span className="text-[#FF7A00] font-semibold">Nota:</span> Vista
              Exterior disponible únicamente al cargar planos de
              elevación/fachada
            </div>
          )}
        </div>
      )}

      {/* Visor 3D HD v7.0 */}
      <Interior3DViewer
        blueprint={{ ...blueprint, renderType: effectiveRenderType }}
        theme={theme}
        step2RenderUrl={step2RenderUrl}
        cachedSpatialData={cachedSpatialData}
        cachedSpatialSourceUrl={cachedSpatialSourceUrl}
        onSaveSpatialData={onSaveSpatialData}
        readOnlyMode={readOnlyMode}
        sharedModelUrl={sharedModelUrl}
        sharedTaskId={sharedTaskId}
        onOpenShareModal={onOpenShareModal}
        onOpenCommercialQuote={onOpenCommercialQuote}
        onExitReadOnlyMode={onExitReadOnlyMode}
      />
    </div>
  );
};
