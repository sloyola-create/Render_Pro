import React, { useEffect, useRef, useState } from 'react';
import { BlueprintData, RenderType, ThemeMode } from '../types/render';
import { rasterizeCleanBlueprintDataUrl } from '../utils/blueprintExtractor';
import { synchronizeBlueprintWithStep2CGI } from '../utils/proceduralModels';
import { StepComparisonSlider } from './StepComparisonSlider';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Cog,
  Download,
  Eye,
  FileCode2,
  Home,
  Image as ImageIcon,
  Lock,
  Loader2,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Wand2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

interface AIEnhancerPhaseProps {
  blueprint: BlueprintData;
  theme: ThemeMode;
  uploadedImageDataUrl: string | null;
  aiRenderedImageUrl: string | null;
  onSetAiRenderedImageUrl: (url: string | null) => void;
  stylePrompt: string;
  step2Completed: boolean;
  onMarkStep2Completed: () => void;
  onChangeStylePrompt: (val: string) => void;
  onChangeRenderType: (type: RenderType) => void;
  onApplyAIBlueprint: (updated: BlueprintData) => void;
  onProceedTo3D: () => void;
}

export const AIEnhancerPhase: React.FC<AIEnhancerPhaseProps> = ({
  blueprint,
  theme,
  uploadedImageDataUrl,
  aiRenderedImageUrl,
  onSetAiRenderedImageUrl,
  stylePrompt,
  step2Completed,
  onMarkStep2Completed,
  onChangeStylePrompt,
  onChangeRenderType,
  onApplyAIBlueprint,
  onProceedTo3D,
}) => {
  const autoTriggeredBlueprintIdRef = useRef<string | null>(null);

  const [isProcessingAI, setIsProcessingAI] = useState(false);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [progressStage, setProgressStage] = useState<string>(
    'Transformando plano 2D limpio en Render CGI 3D Cenital con Gemini Vision...'
  );
  const [aiStatusMessage, setAiStatusMessage] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'cgi' | 'source2d' | 'compare12'>('cgi');
  const [zoomLevel, setZoomLevel] = useState<number>(1);

  const isLight = theme === 'light';

  const handleRunImageToImageCGI = async () => {
    setIsProcessingAI(true);
    setAiError(null);
    setAiStatusMessage(null);
    setProgressPercent(15);
    setProgressStage(
      'Enviando plano 2D limpio en alta definición a Gemini Vision (Image-to-Image)...'
    );

    const MAX_SILENT_RETRIES = 2;
    const RETRY_DELAY_MS = 2000;

    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      setProgressPercent(42);
      setProgressStage(
        'Generando muros negro mate, parquet de roble, porcelanato y amoblado 3D realista...'
      );

      const cleanSourceDataUrl =
        uploadedImageDataUrl || rasterizeCleanBlueprintDataUrl(blueprint);

      const payload = JSON.stringify({
        renderType: blueprint.renderType,
        stylePrompt,
        imageDataUrl: cleanSourceDataUrl,
        currentBlueprint: blueprint,
      });

      let lastFriendlyError =
        'Los servidores de Gemini están experimentando alta demanda momentánea';

      for (let attempt = 0; attempt <= MAX_SILENT_RETRIES; attempt++) {
        try {
          setProgressPercent(attempt === 0 ? 68 : 78 + attempt * 9);
          setProgressStage(
            'Renderizando iluminación ambiental 90°, sombras suaves (AO) y vegetación perimetral...'
          );

          const response = await fetch('/api/gemini/render-floorplan-cgi', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
          });

          let data: any = {};
          try {
            data = await response.json();
          } catch {
            data = {};
          }

          if (response.ok && data.renderedImageUrl) {
            setProgressPercent(92);
            setProgressStage(
              'Sincronizando Master Data y coordenadas 1:1 para el Paso 3...'
            );
            onSetAiRenderedImageUrl(data.renderedImageUrl);
            const syncedMasterBlueprint = await synchronizeBlueprintWithStep2CGI(
              data.renderedImageUrl,
              data.blueprint || blueprint
            );
            onApplyAIBlueprint(syncedMasterBlueprint);
            setProgressPercent(100);
            setViewMode('cgi');
            onMarkStep2Completed();
            setAiStatusMessage(
              data.summary ||
                'Render CGI de Planta Arquitectónica 3D Cenital (90° Top-Down) generado con éxito.'
            );
            return;
          }

          const isRetryable =
            response.status === 503 ||
            response.status === 429 ||
            response.status >= 500 ||
            data?.code === 'MODEL_OVERLOADED' ||
            data?.code === 'SERVICE_UNAVAILABLE';

          if (data?.userMessage && typeof data.userMessage === 'string') {
            lastFriendlyError = data.userMessage.replace(/\.$/, '');
          }

          if (isRetryable && attempt < MAX_SILENT_RETRIES) {
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
            continue;
          }

          break;
        } catch {
          if (attempt < MAX_SILENT_RETRIES) {
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
            continue;
          }
          break;
        }
      }

      setProgressPercent(100);
      onMarkStep2Completed();
      setAiError(lastFriendlyError);
    } finally {
      setIsProcessingAI(false);
    }
  };

  // Automatically execute the Image-to-Image CGI Render when entering Step 2
  // if no CGI image has been generated yet for this blueprint
  useEffect(() => {
    if (
      !aiRenderedImageUrl &&
      !isProcessingAI &&
      autoTriggeredBlueprintIdRef.current !== blueprint.id
    ) {
      autoTriggeredBlueprintIdRef.current = blueprint.id;
      handleRunImageToImageCGI();
    }
  }, [blueprint.id, aiRenderedImageUrl]);

  // Lossless .PNG exporter for the AI-rendered CGI image
  const handleDownloadCGIPng = () => {
    const targetSrc = aiRenderedImageUrl || uploadedImageDataUrl;
    if (!targetSrc) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width || 1600;
      canvas.height = img.naturalHeight || img.height || 1200;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const pngDataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = pngDataUrl;
      a.download = `${blueprint.id}-render-cgi-3d-cenital.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    };
    img.src = targetSrc;
  };

  const activeDisplayImage =
    viewMode === 'cgi' && aiRenderedImageUrl
      ? aiRenderedImageUrl
      : uploadedImageDataUrl;

  return (
    <div
      className={`flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0 transition-colors ${
        isLight ? 'bg-[#F4F7FB] text-[#040B29]' : 'bg-[#0b0f19] text-slate-100'
      }`}
    >
      {/* Left Column: Image-to-Image CGI Controls, Style Console & Step 3 Progression */}
      <aside
        className={`lg:col-span-5 xl:col-span-4 border-r p-6 flex flex-col justify-between overflow-y-auto transition-colors ${
          isLight
            ? 'bg-white border-slate-200'
            : 'bg-[#111827] border-slate-800/90'
        }`}
      >
        <div className="space-y-5">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div
                className={`flex items-center gap-2 text-xs font-mono ${
                  isLight ? 'text-[#0047BA]' : 'text-[#A6C8FF]'
                }`}
              >
                <span className="text-[#FF7A00] font-semibold">v1.0</span>
                <span aria-hidden="true">·</span>
                <span>PASO 2 DE 3</span>
                <span aria-hidden="true">·</span>
                <span>Render CGI por IA</span>
              </div>
              <span className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold text-emerald-500">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Paso 1 Completado ✓
              </span>
            </div>
            <h1
              className={`text-xl font-bold mt-1 text-balance ${
                isLight ? 'text-[#040B29]' : 'text-slate-100'
              }`}
            >
              Render CGI de Planta 3D Cenital (IA)
            </h1>
            <p
              className={`text-xs mt-1 leading-relaxed ${
                isLight ? 'text-slate-600' : 'text-slate-400'
              }`}
            >
              Transformación Image-to-Image con Gemini Vision: convierte el plano 2D limpio en una fotografía aérea cenital (90° Top-Down) de acabado comercial inmobiliario fotorrealista.
            </p>
          </div>

          {/* Clasificador de Tipo de Proyecto para el Paso 3 (renderType) */}
          <div className="space-y-2">
            <label
              className={`block text-xs font-semibold ${
                isLight ? 'text-[#040B29]' : 'text-slate-200'
              }`}
            >
              Clasificador de Subsistema para el Paso 3 (renderType)
            </label>
            <div className="grid grid-cols-1 gap-2">
              {(
                [
                  {
                    type: 'interior',
                    title: 'Interior / Plano de Distribución',
                    desc: 'Plantas de casas, departamentos y oficinas. Muros extruidos 2.60m, vanos limpios y mobiliario 3D en el Paso 3.',
                    icon: Home,
                  },
                  {
                    type: 'exterior',
                    title: 'Exterior / Fachada Arquitectónica',
                    desc: 'Edificios, galpones y casas vistas por fuera. Pedestal de hormigón/mármol, aleros rectos e iluminación solar.',
                    icon: Building2,
                  },
                  {
                    type: 'product',
                    title: 'Producto / Objeto de Ingeniería',
                    desc: 'Estructuras metálicas, perfiles y ensambles extraídos sobre pedestal técnico circular 360°.',
                    icon: Cog,
                  },
                ] as const
              ).map((option) => {
                const Icon = option.icon;
                const isSelected = blueprint.renderType === option.type;
                return (
                  <button
                    key={option.type}
                    type="button"
                    onClick={() => onChangeRenderType(option.type)}
                    className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                      isSelected
                        ? isLight
                          ? 'bg-[#EBF3FF] border-[#0047BA] text-[#040B29] shadow-xs'
                          : 'bg-[#1b2436] border-[#0047BA] text-white shadow-xs'
                        : isLight
                          ? 'bg-[#F8FAFC] border-slate-200 text-slate-700 hover:border-slate-300'
                          : 'bg-[#0b0f19] border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`p-2 rounded-lg shrink-0 ${
                          isSelected
                            ? 'bg-[#0047BA] text-white'
                            : isLight
                              ? 'bg-slate-200 text-slate-600'
                              : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-xs font-semibold">{option.title}</div>
                        <p
                          className={`text-[11px] mt-0.5 leading-relaxed ${
                            isLight ? 'text-slate-600' : 'text-slate-400'
                          }`}
                        >
                          {option.desc}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Directrices Técnicas de Estilo Fotorrealista */}
          <div className="space-y-1.5">
            <label
              htmlFor="style-console"
              className={`block text-xs font-semibold ${
                isLight ? 'text-[#040B29]' : 'text-slate-200'
              }`}
            >
              Directrices de Estilo Inmobiliario (Image-to-Image Prompt)
            </label>
            <textarea
              id="style-console"
              rows={2}
              value={stylePrompt}
              onChange={(e) => onChangeStylePrompt(e.target.value)}
              placeholder="Ej: Parquet de roble cálido, porcelanato blanco reticulado en baños y cocina, terraza deck de madera..."
              className={`w-full rounded-lg border px-3 py-2 text-xs focus:outline-none focus:border-[#0047BA] ${
                isLight
                  ? 'bg-[#F8FAFC] border-slate-300 text-[#040B29] placeholder:text-slate-400'
                  : 'bg-[#0b0f19] border-slate-700 text-slate-100 placeholder:text-slate-500'
              }`}
            />
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {[
                'Parquet roble cálido + Porcelanato blanco reticulado + Deck madera',
                'Muros negro mate + Amoblado textil de lujo + Jardín perimetral',
                'Iluminación 90° Ambient Occlusion + Piedra natural exterior',
              ].map((presetText) => (
                <button
                  key={presetText}
                  type="button"
                  onClick={() => onChangeStylePrompt(presetText)}
                  className={`text-[11px] px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                    isLight
                      ? 'bg-[#F8FAFC] border-slate-200 text-slate-600 hover:text-[#0047BA] hover:border-[#0047BA]'
                      : 'bg-[#0b0f19] border-slate-800 text-slate-400 hover:text-[#A6C8FF] hover:border-slate-700'
                  }`}
                >
                  + {presetText}
                </button>
              ))}
            </div>
          </div>

          {/* =================================================================== */}
          {/* JERARQUÍA DE BOTONES DE FLUJO: PASO 1 (CGI IA) -> PASO 2 (VISOR 3D) */}
          {/* =================================================================== */}
          <div
            className={`pt-4 border-t space-y-3.5 ${
              isLight ? 'border-slate-200' : 'border-slate-800'
            }`}
          >
            {/* PASO 1: Generador CGI Image-to-Image */}
            <div
              className={`rounded-xl border p-3.5 transition-colors ${
                isLight
                  ? 'bg-[#F8FAFC] border-slate-200'
                  : 'bg-[#0b0f19] border-slate-800'
              }`}
            >
              <div className="flex items-center justify-between text-[11px] font-mono mb-1.5">
                <span
                  className={
                    isLight
                      ? 'text-[#0047BA] font-semibold'
                      : 'text-[#A6C8FF] font-semibold'
                  }
                >
                  GENERADOR CGI IMAGE-TO-IMAGE
                </span>
                {aiRenderedImageUrl ? (
                  <span className="text-emerald-500 font-semibold">
                    Render CGI Generado ✓
                  </span>
                ) : step2Completed ? (
                  <span className="text-emerald-500 font-semibold">
                    Paso 2 Completado ✓
                  </span>
                ) : (
                  <span className="text-[#FF7A00]">Procesando IA</span>
                )}
              </div>

              <button
                type="button"
                disabled={isProcessingAI}
                onClick={handleRunImageToImageCGI}
                className={`w-full flex items-center justify-center gap-2 py-2.5 px-3.5 border text-xs font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-50 ${
                  isLight
                    ? 'bg-white hover:bg-[#EBF3FF] border-[#0047BA] text-[#0047BA]'
                    : 'bg-[#161f30] hover:bg-[#1e293b] border-[#0047BA] text-[#A6C8FF]'
                }`}
              >
                {isProcessingAI ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-[#FF7A00] shrink-0" />
                    <span>Generando Render CGI Fotorrealista...</span>
                  </>
                ) : (
                  <>
                    <Wand2 className="w-4 h-4 text-[#FF7A00] shrink-0" />
                    <span>
                      {aiRenderedImageUrl
                        ? 'Regenerar Render CGI Fotorrealista con IA'
                        : 'Generar Render CGI Fotorrealista con IA'}
                    </span>
                  </>
                )}
              </button>

              <p
                className={`text-[11px] mt-1.5 text-center ${
                  isLight ? 'text-slate-500' : 'text-slate-400'
                }`}
              >
                Transforma el plano limpio en un render 3D cenital inmobiliario de alta resolución
              </p>

              {/* Success Feedback */}
              {aiStatusMessage && !isProcessingAI && (
                <div
                  className={`mt-3 p-3 rounded-lg border text-xs flex items-start gap-2 ${
                    isLight
                      ? 'bg-[#EBF3FF]/70 border-[#A6C8FF] text-[#040B29]'
                      : 'bg-[#111827] border-slate-700 text-slate-200'
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                  <span>{aiStatusMessage}</span>
                </div>
              )}

              {/* Friendly Technical Alert on 503 / API Overload */}
              {aiError && !isProcessingAI && (
                <div
                  role="alert"
                  className={`mt-3 p-3.5 rounded-lg border text-xs space-y-2.5 ${
                    isLight
                      ? 'bg-amber-50 border-amber-300 text-[#040B29]'
                      : 'bg-[#1c1613] border-[#FF7A00]/60 text-slate-200'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-[#FF7A00] shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="font-semibold text-[#FF7A00]">{aiError}</p>
                      <p
                        className={`text-[11px] leading-relaxed ${
                          isLight ? 'text-slate-600' : 'text-slate-400'
                        }`}
                      >
                        Los vectores JSON extraídos en el Paso 1 están resguardados en memoria. Puedes reintentar la generación CGI o avanzar directamente al Visor 3D Interactivo.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      disabled={isProcessingAI}
                      onClick={handleRunImageToImageCGI}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors cursor-pointer ${
                        isLight
                          ? 'bg-white border-amber-400 text-[#040B29] hover:bg-amber-100/60'
                          : 'bg-[#0b0f19] border-[#FF7A00]/60 text-[#FF7A00] hover:bg-[#FF7A00]/15'
                      }`}
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Reintentar Render CGI
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* PASO 3 (DESTINO FINAL): Lanzar Visor 3D Interactivo con los vectores JSON del Paso 1 */}
            <div
              className={`rounded-xl border p-3.5 transition-all ${
                !step2Completed || isProcessingAI
                  ? 'opacity-50 border-slate-700/50'
                  : aiError
                    ? isLight
                      ? 'bg-[#EBF3FF] border-2 border-[#FF7A00] shadow-lg ring-2 ring-[#FF7A00]/30'
                      : 'bg-[#162033] border-2 border-[#FF7A00] shadow-xl ring-2 ring-[#FF7A00]/30'
                    : isLight
                      ? 'bg-[#EBF3FF]/60 border-[#A6C8FF]'
                      : 'bg-[#151e2e] border-[#0047BA]/60'
              }`}
            >
              <div className="flex items-center justify-between text-[11px] font-mono mb-1.5">
                <span className="text-[#FF7A00] font-semibold">
                  SIGUIENTE ETAPA · PASO 3 DE 3
                </span>
                <span
                  className={
                    isLight
                      ? 'text-[#0047BA] font-semibold'
                      : 'text-[#A6C8FF] font-semibold'
                  }
                >
                  {!step2Completed || isProcessingAI
                    ? 'Esperando Render CGI...'
                    : 'Paso 3 Desbloqueado ✓'}
                </span>
              </div>

              <button
                type="button"
                disabled={!step2Completed || isProcessingAI}
                onClick={onProceedTo3D}
                className={`w-full flex items-center justify-center gap-2 py-3 px-4 text-white text-xs font-bold rounded-lg transition-all cursor-pointer disabled:cursor-not-allowed shadow-md ${
                  aiError
                    ? 'bg-[#FF7A00] hover:bg-[#e06900] text-[#040B29]'
                    : 'bg-[#0047BA] hover:bg-[#002068]'
                }`}
              >
                {!step2Completed || isProcessingAI ? (
                  <>
                    <Lock className="w-4 h-4 shrink-0" />
                    <span>Paso 3 Bloqueado (Generando Render CGI...)</span>
                  </>
                ) : (
                  <>
                    <span>Avanzar al Paso 3: Lanzar Visor 3D Interactivo</span>
                    <ArrowRight
                      className={`w-4 h-4 shrink-0 ${
                        aiError ? 'text-[#040B29]' : 'text-[#FF7A00]'
                      }`}
                    />
                  </>
                )}
              </button>

              <p
                className={`text-[11px] mt-1.5 text-center ${
                  isLight ? 'text-slate-600' : 'text-slate-300'
                }`}
              >
                Construye el entorno 3D navegable usando los vectores JSON extraídos en el Paso 1
              </p>
            </div>
          </div>
        </div>

        {/* Download CGI Render (.PNG) Action */}
        <div
          className={`pt-4 border-t mt-4 ${
            isLight ? 'border-slate-200' : 'border-slate-800'
          }`}
        >
          <button
            type="button"
            disabled={!aiRenderedImageUrl && !uploadedImageDataUrl}
            onClick={handleDownloadCGIPng}
            className={`w-full flex items-center justify-center gap-2 py-2.5 px-4 border text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer disabled:opacity-40 ${
              isLight
                ? 'bg-white hover:bg-slate-50 text-[#040B29] border-slate-300'
                : 'bg-[#0b0f19] hover:bg-slate-800 text-slate-200 border-slate-700'
            }`}
          >
            <Download className="w-3.5 h-3.5 text-[#FF7A00]" />
            Descargar Render CGI en Alta Definición (.PNG)
          </button>
        </div>
      </aside>

      {/* Right Column: Clean High-Definition CGI Presentation Frame (No Canvas Diagram/Blocks) */}
      <section
        className={`lg:col-span-7 xl:col-span-8 relative flex flex-col min-h-[540px] p-6 lg:p-8 overflow-hidden transition-colors ${
          isLight ? 'bg-[#EBF3FF]/70' : 'bg-[#070d19]'
        }`}
      >
        {/* Top Presentation Header Bar */}
        <div
          className={`flex flex-wrap items-center justify-between gap-3 rounded-t-2xl border border-b-0 px-5 py-3.5 ${
            isLight
              ? 'bg-white border-slate-200 text-[#040B29]'
              : 'bg-[#111827] border-slate-800 text-slate-100'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#0047BA]/15 border border-[#0047BA]/40 flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4 text-[#FF7A00]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold tracking-tight">
                  MARCO DE PRESENTACIÓN CGI · 90° TOP-DOWN
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  <FileCode2 className="w-3 h-3" />
                  JSON Paso 1 activo ({blueprint.walls.length} muros)
                </span>
              </div>
              <p
                className={`text-[11px] font-mono mt-0.5 ${
                  isLight ? 'text-slate-500' : 'text-slate-400'
                }`}
              >
                {blueprint.title} · Escala {blueprint.totalWidth.toFixed(2)}m ×{' '}
                {blueprint.totalDepth.toFixed(2)}m
              </p>
            </div>
          </div>

          {/* Presentation Toolbar: View Switcher, Zoom & Direct Download */}
          <div className="flex items-center gap-2">
            <div
              className={`flex items-center rounded-lg border p-0.5 ${
                isLight
                  ? 'bg-slate-100 border-slate-200'
                  : 'bg-[#0b0f19] border-slate-800'
              }`}
            >
              <button
                type="button"
                onClick={() => setViewMode('cgi')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  viewMode === 'cgi'
                    ? 'bg-[#0047BA] text-white'
                    : isLight
                      ? 'text-slate-600 hover:text-[#040B29]'
                      : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <ImageIcon className="w-3.5 h-3.5" />
                Render CGI (IA)
              </button>
              <button
                type="button"
                onClick={() => setViewMode('source2d')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  viewMode === 'source2d'
                    ? 'bg-[#0047BA] text-white'
                    : isLight
                      ? 'text-slate-600 hover:text-[#040B29]'
                      : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                Plano Limpio (Paso 1)
              </button>
              <button
                type="button"
                onClick={() => setViewMode('compare12')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  viewMode === 'compare12'
                    ? 'bg-[#0047BA] text-white'
                    : isLight
                      ? 'text-slate-600 hover:text-[#040B29]'
                      : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-[#FF7A00]" />
                Comparar Pasos 1 · 2
              </button>
            </div>

            <div
              className={`hidden sm:flex items-center rounded-lg border p-0.5 ${
                isLight
                  ? 'bg-slate-100 border-slate-200'
                  : 'bg-[#0b0f19] border-slate-800'
              }`}
            >
              <button
                type="button"
                onClick={() => setZoomLevel((z) => Math.max(0.75, +(z - 0.25).toFixed(2)))}
                className="p-1.5 rounded hover:bg-slate-700/20 cursor-pointer"
                title="Alejar"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setZoomLevel(1)}
                className="px-2 text-[11px] font-mono cursor-pointer"
                title="Restablecer zoom"
              >
                {Math.round(zoomLevel * 100)}%
              </button>
              <button
                type="button"
                onClick={() => setZoomLevel((z) => Math.min(2.5, +(z + 0.25).toFixed(2)))}
                className="p-1.5 rounded hover:bg-slate-700/20 cursor-pointer"
                title="Acercar"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>

            <button
              type="button"
              disabled={!aiRenderedImageUrl && !uploadedImageDataUrl}
              onClick={handleDownloadCGIPng}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0047BA] hover:bg-[#002068] text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-40 shadow-xs"
            >
              <Download className="w-3.5 h-3.5 text-[#FF7A00]" />
              <span>.PNG</span>
            </button>
          </div>
        </div>

        {/* Main High-Definition Architectural Presentation Frame */}
        <div
          className={`flex-1 relative rounded-b-2xl border overflow-auto flex items-center justify-center p-6 shadow-2xl ${
            isLight
              ? 'bg-[#F8FAFC] border-slate-200'
              : 'bg-[#0b111e] border-slate-800'
          }`}
        >
          {viewMode === 'compare12' && (aiRenderedImageUrl || uploadedImageDataUrl) ? (
            <StepComparisonSlider
              step1ImageUrl={uploadedImageDataUrl}
              step2ImageUrl={aiRenderedImageUrl}
              theme={theme}
              blueprintTitle={blueprint.title}
            />
          ) : activeDisplayImage ? (
            <div
              className={`relative rounded-xl overflow-hidden border shadow-2xl transition-transform duration-200 ${
                isLight
                  ? 'bg-white border-slate-300'
                  : 'bg-[#040B29] border-slate-700/80'
              }`}
              style={{
                transform: `scale(${zoomLevel})`,
                transformOrigin: 'center center',
              }}
            >
              <img
                src={activeDisplayImage}
                alt={
                  viewMode === 'cgi' && aiRenderedImageUrl
                    ? `Render CGI 3D Cenital — ${blueprint.title}`
                    : `Plano 2D Limpio Base — ${blueprint.title}`
                }
                referrerPolicy="no-referrer"
                className="max-h-[68vh] w-auto object-contain block select-none"
              />

              {/* Subtle Architectural Plate Footer Caption */}
              <div
                className={`px-4 py-2 border-t flex items-center justify-between gap-4 text-[11px] font-mono ${
                  isLight
                    ? 'bg-white/95 border-slate-200 text-slate-600'
                    : 'bg-[#0d1526]/95 border-slate-800 text-slate-300'
                }`}
              >
                <span>
                  {viewMode === 'cgi' && aiRenderedImageUrl
                    ? 'VISTA AÉREA 90° TOP-DOWN · RENDER CGI INMOBILIARIO FOTORREALISTA'
                    : 'LÁMINA BASE 2D LIMPIA (ENTRADA IMAGE-TO-IMAGE DEL PASO 1)'}
                </span>
                <span className="text-[#FF7A00] font-semibold">
                  PRODALAM RENDER PRO v6.0
                </span>
              </div>
            </div>
          ) : (
            <div className="text-center max-w-md space-y-3 p-8">
              <div className="w-12 h-12 rounded-2xl bg-[#0047BA]/15 border border-[#0047BA]/40 flex items-center justify-center mx-auto">
                <Sparkles className="w-6 h-6 text-[#FF7A00]" />
              </div>
              <h2 className="text-sm font-bold">
                Preparando Transformación CGI Image-to-Image
              </h2>
              <p
                className={`text-xs leading-relaxed ${
                  isLight ? 'text-slate-600' : 'text-slate-400'
                }`}
              >
                Haz clic en «Generar Render CGI Fotorrealista con IA» para transformar el plano limpio del Paso 1 en una planta arquitectónica 3D cenital amoblada.
              </p>
            </div>
          )}

          {/* Animated Progress Overlay while Gemini Image-to-Image Generates the CGI Render */}
          {isProcessingAI && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#040B29]/80 backdrop-blur-xs p-6">
              <div
                className={`max-w-md w-full rounded-2xl border p-6 shadow-2xl text-center space-y-4 ${
                  isLight
                    ? 'bg-white border-slate-200 text-[#040B29]'
                    : 'bg-[#111827] border-[#0047BA] text-slate-100'
                }`}
              >
                <div className="w-12 h-12 rounded-xl bg-[#0047BA]/15 border border-[#0047BA]/40 flex items-center justify-center mx-auto">
                  <Loader2 className="w-6 h-6 animate-spin text-[#FF7A00]" />
                </div>
                <div className="space-y-1.5">
                  <p className="text-sm font-bold">{progressStage}</p>
                  <p
                    className={`text-xs font-mono ${
                      isLight ? 'text-slate-500' : 'text-slate-400'
                    }`}
                  >
                    Muros negro mate · Parquet de roble · Porcelanato · Amoblado 3D y sombras suaves 90°
                  </p>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-800/40 overflow-hidden">
                  <div
                    className="h-full bg-[#FF7A00] transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className="text-xs font-mono font-semibold text-[#FF7A00]">
                  {progressPercent}% Completado
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
