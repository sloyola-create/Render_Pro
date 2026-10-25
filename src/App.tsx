/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import {
  AppPhase,
  BlueprintData,
  Controls2DState,
  RenderType,
  Spatial3DAnalysisResult,
  ThemeMode,
} from './types/render';
import { buildBlueprintFromDxf, parseDxfContent } from './utils/dxfParser';
import {
  buildBlueprintFromPdfMeta,
  enhanceAndSharpenBlueprintImage,
  extractBlueprintFromImage,
  rasterizeCleanBlueprintDataUrl,
} from './utils/blueprintExtractor';
import { Topbar } from './components/Topbar';
import { Workbench2D } from './components/Workbench2D';
import { AIEnhancerPhase } from './components/AIEnhancerPhase';
import { Immersive3DViewer } from './components/Immersive3DViewer';
import { QuickStepComparator } from './components/QuickStepComparator';
import { SettingsModal } from './components/SettingsModal';
import { ShareViewModal } from './components/ShareViewModal';
import { CommercialQuoteModal } from './components/CommercialQuoteModal';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

function createSharedViewDefaultBlueprint(title: string): BlueprintData {
  return {
    id: 'shared-view-3d',
    title: title || 'Maqueta 3D Compartida · Prodalam Render Pro v10.0',
    subtitle: 'Visualización Interactiva 360° (Solo Lectura)',
    renderType: 'interior',
    totalWidth: 12,
    totalDepth: 10,
    styleSummary: 'Presentación 360° HD',
    primaryColorHex: '#0047BA',
    accentColorHex: '#FF7A00',
    metalFinish: 'black_steel',
    walls: [],
    rooms: [],
    furniture: [],
    exteriorModules: [],
    productArchetype: 'truss_portal',
    productComponents: [],
    dimensions: [],
  };
}

export default function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      const saved = window.localStorage.getItem('theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      // ignore localStorage errors in restricted environments
    }
    return 'dark';
  });

  // Detectar si se abrió con enlace de visualización solo lectura (?mode=view&model=...)
  const [isReadOnlyViewMode, setIsReadOnlyViewMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.get('mode') === 'view';
  });
  const [sharedModelUrl, setSharedModelUrl] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    return params.get('model');
  });
  const [sharedTaskId, setSharedTaskId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    return params.get('taskId');
  });

  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState<boolean>(false);
  const [isCommercialQuoteOpen, setIsCommercialQuoteOpen] =
    useState<boolean>(false);
  const [activePhase, setActivePhase] = useState<AppPhase>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('mode') === 'view') return 'viewer3d';
    }
    return 'workbench2d';
  });

  const [blueprint, setBlueprint] = useState<BlueprintData | null>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('mode') === 'view') {
        return createSharedViewDefaultBlueprint(
          params.get('title') || 'Maqueta 3D Compartida · Prodalam Render Pro'
        );
      }
    }
    return null;
  });

  const [step1Completed, setStep1Completed] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('mode') === 'view') return true;
    }
    return false;
  });
  const [step2Completed, setStep2Completed] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('mode') === 'view') return true;
    }
    return false;
  });
  const [hasVisitedStep3, setHasVisitedStep3] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('mode') === 'view') return true;
    }
    return false;
  });

  const [step3SpatialData, setStep3SpatialData] =
    useState<Spatial3DAnalysisResult | null>(null);
  const [step3SpatialSourceUrl, setStep3SpatialSourceUrl] = useState<
    string | null
  >(null);

  const [controls2D, setControls2D] = useState<Controls2DState>({
    showGrid: true,
    grayscale: false,
    invertColors: false,
    lineThickness: 2.0,
    zoom: 1.0,
    panX: 0,
    panY: 0,
  });

  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [uploadedFileSize, setUploadedFileSize] = useState<string | null>(null);
  const [uploadedImage, setUploadedImage] = useState<HTMLImageElement | null>(
    null
  );
  const [uploadedImageDataUrl, setUploadedImageDataUrl] = useState<
    string | null
  >(null);
  const [aiRenderedImageUrl, setAiRenderedImageUrl] = useState<string | null>(
    null
  );
  const [stylePrompt, setStylePrompt] = useState<string>(
    'Acabado comercial inmobiliario de lujo, parquet de roble cálido en salones y dormitorios, porcelanato blanco reticulado en baños y cocina, muros negro mate y vegetación exterior.'
  );

  useEffect(() => {
    try {
      window.localStorage.setItem('theme', theme);
    } catch {
      // ignore localStorage errors
    }
    const root = document.documentElement;
    if (theme === 'light') {
      root.classList.add('theme-light');
      root.classList.remove('dark');
    } else {
      root.classList.remove('theme-light');
      root.classList.add('dark');
    }
  }, [theme]);

  useEffect(() => {
    if (activePhase === 'viewer3d') {
      setHasVisitedStep3(true);
      const timer = setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
      }, 30);
      return () => clearTimeout(timer);
    }
  }, [activePhase]);

  const hasLoadedFile = Boolean(blueprint && uploadedFileName);

  const handleUpdateControls = (patch: Partial<Controls2DState>) => {
    setControls2D((prev) => ({ ...prev, ...patch }));
  };

  const handleChangeRenderType = (type: RenderType) => {
    setBlueprint((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        renderType: type,
      };
    });
  };

  const handleSetStep2RenderedImageUrl = (newUrl: string | null) => {
    setAiRenderedImageUrl((prevUrl) => {
      if (prevUrl !== newUrl) {
        setStep3SpatialData(null);
        setStep3SpatialSourceUrl(null);
      }
      return newUrl;
    });
  };

  const handleSaveStep3SpatialData = (
    data: Spatial3DAnalysisResult,
    sourceUrl: string
  ) => {
    setStep3SpatialData(data);
    setStep3SpatialSourceUrl(sourceUrl);
  };

  const handleFileSelected = (file: File) => {
    const sizeFormatted = formatFileSize(file.size);
    setUploadedFileName(file.name);
    setUploadedFileSize(sizeFormatted);
    setStep1Completed(false);
    setStep2Completed(false);
    setHasVisitedStep3(false);
    setAiRenderedImageUrl(null);
    setStep3SpatialData(null);
    setStep3SpatialSourceUrl(null);
    setIsReadOnlyViewMode(false);
    setActivePhase('workbench2d');

    const ext = file.name.split('.').pop()?.toLowerCase() || '';

    if (ext === 'dxf') {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = String(e.target?.result || '');
        const parsed = parseDxfContent(text);
        const dxfBlueprint = buildBlueprintFromDxf(file.name, parsed);
        setUploadedImage(null);
        setUploadedImageDataUrl(null);
        setBlueprint(dxfBlueprint);
      };
      reader.readAsText(file);
      return;
    }

    if (ext === 'pdf') {
      const pdfBlueprint = buildBlueprintFromPdfMeta(file.name, sizeFormatted);
      setUploadedImage(null);
      setUploadedImageDataUrl(null);
      setBlueprint(pdfBlueprint);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = String(e.target?.result || '');
      const img = new Image();
      img.onload = () => {
        const extractedBlueprint = extractBlueprintFromImage(
          img,
          file.name,
          sizeFormatted
        );
        setUploadedImage(img);
        setUploadedImageDataUrl(dataUrl);
        setBlueprint(extractedBlueprint);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const handleProcessStep1Vectors = async () => {
    if (!blueprint || !uploadedFileName) return;
    if (uploadedImage && uploadedFileSize) {
      const { cleanImage, cleanDataUrl } =
        await enhanceAndSharpenBlueprintImage(uploadedImage);
      const refreshed = extractBlueprintFromImage(
        cleanImage,
        uploadedFileName,
        uploadedFileSize
      );
      setUploadedImage(cleanImage);
      setUploadedImageDataUrl(cleanDataUrl);
      setBlueprint(refreshed);
    } else {
      const cleanDataUrl = rasterizeCleanBlueprintDataUrl(blueprint);
      if (cleanDataUrl) {
        setUploadedImageDataUrl(cleanDataUrl);
      }
    }
    setStep1Completed(true);
  };

  const handleClearWorkspace = () => {
    setBlueprint(null);
    setUploadedFileName(null);
    setUploadedFileSize(null);
    setUploadedImage(null);
    setUploadedImageDataUrl(null);
    setAiRenderedImageUrl(null);
    setStep3SpatialData(null);
    setStep3SpatialSourceUrl(null);
    setStep1Completed(false);
    setStep2Completed(false);
    setHasVisitedStep3(false);
    setIsReadOnlyViewMode(false);
    setActivePhase('workbench2d');
    setControls2D({
      showGrid: true,
      grayscale: false,
      invertColors: false,
      lineThickness: 2.0,
      zoom: 1.0,
      panX: 0,
      panY: 0,
    });
  };

  const effectiveStep2RenderUrl = aiRenderedImageUrl || uploadedImageDataUrl;

  return (
    <div
      className={`h-screen w-screen flex flex-col overflow-hidden transition-colors ${
        theme === 'light'
          ? 'bg-[#F4F7FB] text-[#040B29]'
          : 'bg-[#0b0f19] text-slate-100'
      }`}
    >
      {/* Topbar is hidden when in full-screen read-only view mode (?mode=view) */}
      {!isReadOnlyViewMode && (
        <Topbar
          activePhase={activePhase}
          hasLoadedFile={hasLoadedFile}
          step1Completed={step1Completed}
          step2Completed={step2Completed}
          theme={theme}
          onChangePhase={(phase) => {
            if (phase === 'ai2d' && !step1Completed) return;
            if (phase === 'viewer3d' && (!step1Completed || !step2Completed))
              return;
            setActivePhase(phase);
          }}
          onFileSelected={handleFileSelected}
          onClearWorkspace={handleClearWorkspace}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onOpenShareModal={() => setIsShareModalOpen(true)}
          onOpenCommercialQuote={() => setIsCommercialQuoteOpen(true)}
        />
      )}

      {/* Quick Step Comparator (1 · 2 · 3) — Hidden in Read-Only Mode */}
      {!isReadOnlyViewMode && (
        <QuickStepComparator
          activePhase={activePhase}
          theme={theme}
          blueprint={blueprint}
          step1Completed={step1Completed}
          step2Completed={step2Completed}
          step1CleanImageUrl={uploadedImageDataUrl}
          step2CgiImageUrl={aiRenderedImageUrl}
          step3SpatialData={step3SpatialData}
          onSelectPhase={(phase) => {
            if (phase === 'ai2d' && !step1Completed) return;
            if (phase === 'viewer3d' && (!step1Completed || !step2Completed))
              return;
            setActivePhase(phase);
          }}
        />
      )}

      {!isReadOnlyViewMode && activePhase === 'workbench2d' && (
        <Workbench2D
          blueprint={blueprint}
          controls={controls2D}
          theme={theme}
          uploadedFileName={uploadedFileName}
          uploadedFileSize={uploadedFileSize}
          uploadedImage={uploadedImage}
          step1Completed={step1Completed}
          onProcessStep1Vectors={handleProcessStep1Vectors}
          onUpdateControls={handleUpdateControls}
          onFileDrop={handleFileSelected}
          onClearFile={handleClearWorkspace}
          onProceedToPhase2={() => {
            if (step1Completed) setActivePhase('ai2d');
          }}
        />
      )}

      {!isReadOnlyViewMode &&
        activePhase === 'ai2d' &&
        blueprint &&
        step1Completed && (
          <AIEnhancerPhase
            blueprint={blueprint}
            theme={theme}
            uploadedImageDataUrl={uploadedImageDataUrl}
            aiRenderedImageUrl={aiRenderedImageUrl}
            onSetAiRenderedImageUrl={handleSetStep2RenderedImageUrl}
            stylePrompt={stylePrompt}
            step2Completed={step2Completed}
            onMarkStep2Completed={() => setStep2Completed(true)}
            onChangeStylePrompt={setStylePrompt}
            onChangeRenderType={handleChangeRenderType}
            onApplyAIBlueprint={setBlueprint}
            onProceedTo3D={() => {
              if (step1Completed && step2Completed) setActivePhase('viewer3d');
            }}
          />
        )}

      {/* Keep Immersive3DViewer mounted once visited or in Read-Only View Mode (?mode=view) */}
      {blueprint &&
        step1Completed &&
        step2Completed &&
        (isReadOnlyViewMode ||
          activePhase === 'viewer3d' ||
          hasVisitedStep3) && (
          <div
            className={
              isReadOnlyViewMode || activePhase === 'viewer3d'
                ? 'flex-1 flex flex-col min-h-0 w-full h-full'
                : 'hidden'
            }
          >
            <Immersive3DViewer
              blueprint={blueprint}
              theme={theme}
              step2RenderUrl={effectiveStep2RenderUrl}
              cachedSpatialData={step3SpatialData}
              cachedSpatialSourceUrl={step3SpatialSourceUrl}
              onSaveSpatialData={handleSaveStep3SpatialData}
              onSelectRenderType={handleChangeRenderType}
              readOnlyMode={isReadOnlyViewMode}
              sharedModelUrl={sharedModelUrl}
              sharedTaskId={sharedTaskId}
              onOpenShareModal={({ modelUrl, taskId }) => {
                if (modelUrl) setSharedModelUrl(modelUrl);
                if (taskId) setSharedTaskId(taskId);
                setIsShareModalOpen(true);
              }}
              onOpenCommercialQuote={() => setIsCommercialQuoteOpen(true)}
              onExitReadOnlyMode={() => {
                setIsReadOnlyViewMode(false);
                if (window.location.search.includes('mode=view')) {
                  window.history.replaceState(
                    {},
                    '',
                    window.location.pathname
                  );
                }
              }}
            />
          </div>
        )}

      <SettingsModal
        isOpen={isSettingsOpen}
        theme={theme}
        onToggleTheme={setTheme}
        onClose={() => setIsSettingsOpen(false)}
      />

      <ShareViewModal
        isOpen={isShareModalOpen}
        theme={theme}
        blueprintTitle={blueprint?.title || 'Maqueta 3D Prodalam'}
        modelUrl={sharedModelUrl}
        taskId={sharedTaskId}
        onClose={() => setIsShareModalOpen(false)}
        onEnterReadOnlyPreview={() => {
          setActivePhase('viewer3d');
          setIsReadOnlyViewMode(true);
        }}
      />

      {blueprint && (
        <CommercialQuoteModal
          isOpen={isCommercialQuoteOpen}
          theme={theme}
          blueprint={blueprint}
          onClose={() => setIsCommercialQuoteOpen(false)}
        />
      )}
    </div>
  );
}
