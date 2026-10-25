import React, { useEffect } from 'react';
import { ThemeMode } from '../types/render';
import {
  Award,
  Code2,
  Cpu,
  Mail,
  Moon,
  Palette,
  ShieldCheck,
  Sun,
  UserCheck,
  X,
} from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  theme: ThemeMode;
  onToggleTheme: (nextTheme: ThemeMode) => void;
  onClose: () => void;
}

const PRODALAM_SWATCHES = [
  { name: 'Azul Corporativo', hex: '#0047BA' },
  { name: 'Naranja Acento', hex: '#FF7A00' },
  { name: 'Azul Marino', hex: '#040B29' },
  { name: 'Azul Cobalto', hex: '#002068' },
  { name: 'Celeste Técnico', hex: '#A6C8FF' },
  { name: 'Blanco Hielo', hex: '#EBF3FF' },
  { name: 'Gris Estructural', hex: '#E5E5E5' },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  theme,
  onToggleTheme,
  onClose,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isLight = theme === 'light';

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop Scrim */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/60 transition-opacity"
        aria-hidden="true"
      />

      {/* Slide-over Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        className={`relative z-10 w-full max-w-md h-full flex flex-col justify-between overflow-y-auto border-l shadow-2xl transition-colors ${
          isLight
            ? 'bg-white border-slate-200 text-[#040B29]'
            : 'bg-[#0d1117] border-slate-800 text-slate-100'
        }`}
      >
        {/* Top Header */}
        <div>
          <div
            className={`flex items-center justify-between px-6 py-4 border-b ${
              isLight ? 'border-slate-200 bg-[#F8FAFC]' : 'border-slate-800 bg-[#161b22]'
            }`}
          >
            <div>
              <div className="flex items-center gap-2 text-xs font-mono text-[#0047BA] dark:text-[#A6C8FF]">
                <span>CONFIGURACIÓN DEL SISTEMA</span>
                <span aria-hidden="true">·</span>
                <span className="text-[#FF7A00] font-semibold">v9.6</span>
              </div>
              <h2 id="settings-modal-title" className="text-base font-bold mt-0.5">
                Preferencias y Acerca de la App
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className={`p-2 rounded-lg border transition-colors cursor-pointer ${
                isLight
                  ? 'border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  : 'border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white'
              }`}
              title="Cerrar configuración (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-6 space-y-6">
            {/* 1. Theme Selector (Modo Claro / Modo Oscuro) */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold tracking-wide uppercase text-[#0047BA] dark:text-[#A6C8FF]">
                    Apariencia e Interfaz
                  </h3>
                  <p
                    className={`text-xs mt-0.5 ${
                      isLight ? 'text-slate-600' : 'text-slate-400'
                    }`}
                  >
                    Adapta el contraste de paneles y lienzos 2D/3D
                  </p>
                </div>

                {/* Interactive Switch */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={isLight}
                  onClick={() => onToggleTheme(isLight ? 'dark' : 'light')}
                  className={`relative inline-flex h-7 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    isLight ? 'bg-[#0047BA]' : 'bg-slate-700'
                  }`}
                  title="Alternar entre Modo Oscuro y Modo Claro"
                >
                  <span
                    className={`pointer-events-none inline-flex h-6 w-6 transform items-center justify-center rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      isLight ? 'translate-x-7' : 'translate-x-0'
                    }`}
                  >
                    {isLight ? (
                      <Sun className="w-3.5 h-3.5 text-[#FF7A00]" />
                    ) : (
                      <Moon className="w-3.5 h-3.5 text-[#040B29]" />
                    )}
                  </span>
                </button>
              </div>

              {/* Dual Mode Selection Buttons */}
              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => onToggleTheme('dark')}
                  className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    !isLight
                      ? 'border-[#0047BA] bg-[#161b22] text-white ring-1 ring-[#0047BA]'
                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <div className="p-2 rounded-lg bg-[#040B29] text-[#A6C8FF]">
                    <Moon className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold">Modo Oscuro</div>
                    <div className="text-[11px] opacity-75 font-mono">Técnico CAD</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => onToggleTheme('light')}
                  className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    isLight
                      ? 'border-[#0047BA] bg-[#EBF3FF]/60 text-[#040B29] ring-1 ring-[#0047BA]'
                      : 'border-slate-800 bg-[#161b22]/50 text-slate-400 hover:bg-[#161b22]'
                  }`}
                >
                  <div className="p-2 rounded-lg bg-[#EBF3FF] text-[#0047BA]">
                    <Sun className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold">Modo Claro</div>
                    <div className="text-[11px] opacity-75 font-mono">Estudio Diurno</div>
                  </div>
                </button>
              </div>
            </section>

            {/* 2. Official Prodalam Brand Palette */}
            <section
              className={`pt-5 border-t space-y-3 ${
                isLight ? 'border-slate-200' : 'border-slate-800'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-bold tracking-wide uppercase text-[#0047BA] dark:text-[#A6C8FF]">
                  <Palette className="w-3.5 h-3.5" />
                  Identidad Corporativa Prodalam
                </span>
                <span className="text-[11px] font-mono text-[#FF7A00]">Paleta Oficial</span>
              </div>

              <div
                className={`p-3.5 rounded-xl border flex items-center justify-between ${
                  isLight
                    ? 'bg-white border-slate-200'
                    : 'bg-[#161b22] border-slate-800'
                }`}
              >
                <div className="bg-white px-3 py-1.5 rounded-lg border border-slate-200/80">
                  <img
                    src="/assets/aistudio/Logo-Principal-Azul_6c28d9e0.png"
                    alt="Logo Oficial Prodalam"
                    referrerPolicy="no-referrer"
                    className="h-6 w-auto object-contain select-none"
                  />
                </div>
                <div className="text-right font-mono">
                  <div className="text-xs font-semibold">Prodalam Render Pro v10.0</div>
                  <div className="text-[11px] text-[#FF7A00]">Release Oficial v10.0</div>
                </div>
              </div>

              <div className="grid grid-cols-7 gap-1.5">
                {PRODALAM_SWATCHES.map((swatch) => (
                  <div key={swatch.hex} className="group flex flex-col items-center">
                    <div
                      className="w-full h-7 rounded-md border border-black/15 shadow-xs"
                      style={{ backgroundColor: swatch.hex }}
                      title={`${swatch.name}: ${swatch.hex}`}
                    />
                    <span className="text-[9px] font-mono mt-1 opacity-75">
                      {swatch.hex}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            {/* 3. Sección "About / Acerca de la App" (Créditos Oficiales) */}
            <section
              className={`pt-5 border-t space-y-3.5 ${
                isLight ? 'border-slate-200' : 'border-slate-800'
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold tracking-wide uppercase text-[#0047BA] dark:text-[#A6C8FF]">
                  About / Acerca de la App
                </h3>
                {/* Official Development Insignia */}
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-mono font-semibold border ${
                    isLight
                      ? 'bg-[#EBF3FF] text-[#0047BA] border-[#A6C8FF]'
                      : 'bg-[#002068]/50 text-[#A6C8FF] border-[#0047BA]/60'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-[#FF7A00]" />
                  SPLS-LAB DEV · v10.0
                </span>
              </div>

              <div
                className={`rounded-xl border p-4 space-y-3 font-mono text-xs ${
                  isLight
                    ? 'bg-[#F8FAFC] border-slate-200 text-[#040B29]'
                    : 'bg-[#161b22] border-slate-800 text-slate-200'
                }`}
              >
                {/* Developer / Studio */}
                <div className="flex items-start justify-between gap-3 pb-2.5 border-b border-slate-500/15">
                  <span className="flex items-center gap-2 text-slate-500 dark:text-slate-400 font-sans">
                    <Code2 className="w-4 h-4 text-[#0047BA] dark:text-[#A6C8FF] shrink-0" />
                    Developer / Studio:
                  </span>
                  <span className="font-semibold text-right">SPLS-Lab Dev</span>
                </div>

                {/* Lead Architect / Created by */}
                <div className="flex items-start justify-between gap-3 pb-2.5 border-b border-slate-500/15">
                  <span className="flex items-center gap-2 text-slate-500 dark:text-slate-400 font-sans">
                    <UserCheck className="w-4 h-4 text-[#FF7A00] shrink-0" />
                    Lead Architect / Created by:
                  </span>
                  <span className="font-semibold text-right">SPLS</span>
                </div>

                {/* Engine / Core */}
                <div className="flex items-start justify-between gap-3 pb-2.5 border-b border-slate-500/15">
                  <span className="flex items-center gap-2 text-slate-500 dark:text-slate-400 font-sans">
                    <Cpu className="w-4 h-4 text-[#0047BA] dark:text-[#A6C8FF] shrink-0" />
                    Engine / Core:
                  </span>
                  <span className="font-semibold text-right">
                    Powered by Google Gemini / Vertex AI
                  </span>
                </div>

                {/* E-mail */}
                <div className="flex items-start justify-between gap-3 pb-2.5 border-b border-slate-500/15">
                  <span className="flex items-center gap-2 text-slate-500 dark:text-slate-400 font-sans">
                    <Mail className="w-4 h-4 text-[#FF7A00] shrink-0" />
                    E-mail:
                  </span>
                  <a
                    href="mailto:informatica@prodalam.cl"
                    className="font-semibold text-[#0047BA] dark:text-[#A6C8FF] hover:underline text-right"
                  >
                    informatica@prodalam.cl
                  </a>
                </div>

                {/* Copyright */}
                <div className="flex items-center justify-between gap-3 pt-0.5">
                  <span className="flex items-center gap-2 text-slate-500 dark:text-slate-400 font-sans">
                    <Award className="w-4 h-4 text-[#0047BA] dark:text-[#A6C8FF] shrink-0" />
                    Copyright:
                  </span>
                  <span className="text-[11px] font-semibold text-right">
                    © 2026 Argodrone. All rights reserved.
                  </span>
                </div>
              </div>
            </section>
          </div>
        </div>

        {/* Footer */}
        <div
          className={`px-6 py-4 border-t flex items-center justify-between text-xs font-mono ${
            isLight
              ? 'border-slate-200 bg-[#F8FAFC] text-slate-500'
              : 'border-slate-800 bg-[#161b22] text-slate-400'
          }`}
        >
          <span>PRODALAM RENDER PRO v10.0</span>
          <span className="text-[#FF7A00] font-semibold">BUILD v10.0</span>
        </div>
      </aside>
    </div>
  );
};
