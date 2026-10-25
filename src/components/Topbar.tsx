import React, { useRef } from 'react';
import { AppPhase, ThemeMode } from '../types/render';
import { Calculator, CheckCircle2, Lock, Settings, Share2, Upload } from 'lucide-react';

interface TopbarProps {
  activePhase: AppPhase;
  hasLoadedFile: boolean;
  step1Completed: boolean;
  step2Completed: boolean;
  theme: ThemeMode;
  onChangePhase: (phase: AppPhase) => void;
  onFileSelected: (file: File) => void;
  onClearWorkspace: () => void;
  onOpenSettings: () => void;
  onOpenShareModal?: () => void;
  onOpenCommercialQuote?: () => void;
}

export const Topbar: React.FC<TopbarProps> = ({
  activePhase,
  hasLoadedFile,
  step1Completed,
  step2Completed,
  theme,
  onChangePhase,
  onFileSelected,
  onClearWorkspace,
  onOpenSettings,
  onOpenShareModal,
  onOpenCommercialQuote,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isLight = theme === 'light';

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelected(file);
      e.target.value = '';
    }
  };

  return (
    <header
      className={`flex items-center justify-between gap-6 px-6 py-3 border-b shrink-0 z-30 transition-colors ${
        isLight
          ? 'bg-white border-slate-200 text-[#040B29]'
          : 'bg-[#040B29] border-[#002068] text-slate-100'
      }`}
    >
      {/* Zone 1: Official Prodalam Corporate Logo + Prodalam Render Pro v10.0 */}
      <a
        href="#workbench"
        onClick={(e) => {
          e.preventDefault();
          onChangePhase('workbench2d');
        }}
        title="Prodalam Render Pro v10.0"
        className="flex items-center gap-3.5 whitespace-nowrap shrink-0 group"
      >
        <div
          className={`px-3 py-1.5 rounded-lg transition-shadow ${
            isLight ? 'bg-white' : 'bg-white shadow-sm'
          }`}
        >
          <img
            src="/assets/aistudio/Logo-Principal-Azul_6c28d9e0.png"
            alt="Prodalam"
            referrerPolicy="no-referrer"
            className="h-6 w-auto object-contain block select-none"
          />
        </div>
        <div className="flex items-baseline gap-2">
          <span
            className={`text-base font-bold tracking-tight ${
              isLight ? 'text-[#040B29]' : 'text-white'
            }`}
          >
            Prodalam Render Pro
          </span>
          <span className="text-xs font-mono font-semibold text-[#FF7A00]">
            v10.0
          </span>
        </div>
      </a>

      {/* Zone 2: Strict 3-Step Sequential Pipeline Navigation */}
      <nav className="hidden md:flex items-center gap-5 text-sm font-medium">
        {/* PASO 1 */}
        <button
          type="button"
          onClick={() => onChangePhase('workbench2d')}
          className={`flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 pb-0.5 cursor-pointer ${
            activePhase === 'workbench2d'
              ? isLight
                ? 'text-[#0047BA] border-b-2 border-[#FF7A00] font-semibold'
                : 'text-white border-b-2 border-[#FF7A00] font-semibold'
              : isLight
                ? 'text-slate-600 hover:text-[#0047BA]'
                : 'text-slate-300 hover:text-white'
          }`}
        >
          <span>Paso 1: Mesa 2D</span>
          {hasLoadedFile && !step1Completed && (
            <span className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold text-[#FF7A00] ml-1">
              · En Calibración
            </span>
          )}
          {step1Completed && (
            <span className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold text-emerald-500 ml-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Paso 1 Completado ✓
            </span>
          )}
        </button>

        <span className="text-slate-500/40 select-none" aria-hidden="true">
          →
        </span>

        {/* PASO 2 (Locked until Paso 1 is completed) */}
        <button
          type="button"
          disabled={!step1Completed}
          onClick={() => {
            if (step1Completed) onChangePhase('ai2d');
          }}
          className={`flex items-center gap-1.5 transition-all whitespace-nowrap shrink-0 pb-0.5 ${
            !step1Completed
              ? 'opacity-40 cursor-not-allowed pointer-events-none text-slate-400'
              : activePhase === 'ai2d'
                ? isLight
                  ? 'text-[#0047BA] border-b-2 border-[#FF7A00] font-semibold cursor-pointer'
                  : 'text-white border-b-2 border-[#FF7A00] font-semibold cursor-pointer'
                : isLight
                  ? 'text-slate-600 hover:text-[#0047BA] cursor-pointer'
                  : 'text-slate-300 hover:text-white cursor-pointer'
          }`}
        >
          {!step1Completed && <Lock className="w-3.5 h-3.5" />}
          <span>Paso 2: Render 2D Cenital 3D</span>
          {step2Completed && (
            <span className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold text-emerald-500 ml-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              ✓
            </span>
          )}
        </button>

        <span className="text-slate-500/40 select-none" aria-hidden="true">
          →
        </span>

        {/* PASO 3 (Strictly Locked until BOTH Paso 1 AND Paso 2 are completed) */}
        <button
          type="button"
          disabled={!step1Completed || !step2Completed}
          onClick={() => {
            if (step1Completed && step2Completed) onChangePhase('viewer3d');
          }}
          className={`flex items-center gap-1.5 transition-all whitespace-nowrap shrink-0 pb-0.5 ${
            !step1Completed || !step2Completed
              ? 'opacity-40 cursor-not-allowed pointer-events-none text-slate-400'
              : activePhase === 'viewer3d'
                ? isLight
                  ? 'text-[#0047BA] border-b-2 border-[#FF7A00] font-semibold cursor-pointer'
                  : 'text-white border-b-2 border-[#FF7A00] font-semibold cursor-pointer'
                : isLight
                  ? 'text-slate-600 hover:text-[#0047BA] cursor-pointer'
                  : 'text-slate-300 hover:text-white cursor-pointer'
          }`}
        >
          {(!step1Completed || !step2Completed) && (
            <Lock className="w-3.5 h-3.5" />
          )}
          <span>Paso 3: Entorno 3D Interactivo</span>
        </button>

        {step1Completed && (
          <button
            type="button"
            onClick={onClearWorkspace}
            className={`ml-2 text-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              isLight
                ? 'text-slate-500 hover:text-red-600'
                : 'text-slate-400 hover:text-red-400'
            }`}
          >
            Reiniciar Flujo
          </button>
        )}
      </nav>

      {/* Zone 3: Cubicación & Cotización Prodalam + Share 3D View + Primary File Load Action + Settings Gear Button */}
      <div className="flex items-center gap-2.5 shrink-0">
        {hasLoadedFile && onOpenCommercialQuote && (
          <button
            type="button"
            onClick={onOpenCommercialQuote}
            className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-xs ${
              isLight
                ? 'bg-[#FFF5EB] border-[#FF7A00] text-[#040B29] hover:bg-[#FF7A00] hover:text-white'
                : 'bg-[#FF7A00]/15 border-[#FF7A00] text-white hover:bg-[#FF7A00]'
            }`}
            title="Abrir Ficha Técnica, Cubicación de Materiales y Cotización Prodalam"
          >
            <Calculator className="w-3.5 h-3.5 text-[#FF7A00] group-hover:text-white" />
            Cubicación &amp; Cotización Prodalam
          </button>
        )}

        {step1Completed && step2Completed && onOpenShareModal && (
          <button
            type="button"
            onClick={onOpenShareModal}
            className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              isLight
                ? 'bg-[#EBF3FF] border-[#0047BA] text-[#0047BA] hover:bg-[#0047BA] hover:text-white'
                : 'bg-[#002068]/70 border-[#0047BA] text-white hover:bg-[#0047BA]'
            }`}
            title="Compartir enlace de visualización 3D en modo solo lectura (?mode=view)"
          >
            <Share2 className="w-3.5 h-3.5 text-[#FF7A00]" />
            Compartir Vista 3D
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.pdf,.dxf"
          onChange={handleFileChange}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#0047BA] hover:bg-[#002068] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
        >
          <Upload className="w-3.5 h-3.5 text-[#FF7A00]" />
          Cargar Plano / DXF
        </button>

        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Configuración"
          title="Configuración y Acerca de la App"
          className={`p-2 rounded-lg border transition-colors cursor-pointer shrink-0 ${
            isLight
              ? 'bg-[#EBF3FF] border-[#A6C8FF] text-[#0047BA] hover:bg-[#A6C8FF]/40'
              : 'bg-[#002068]/60 border-[#0047BA]/60 text-[#A6C8FF] hover:text-white hover:bg-[#0047BA]'
          }`}
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
