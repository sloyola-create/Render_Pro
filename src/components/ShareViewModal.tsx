import React, { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  Eye,
  Globe,
  Share2,
  ShieldCheck,
  X,
} from 'lucide-react';
import { ThemeMode } from '../types/render';

interface ShareViewModalProps {
  isOpen: boolean;
  theme: ThemeMode;
  blueprintTitle: string;
  modelUrl?: string | null;
  taskId?: string | null;
  onClose: () => void;
  onEnterReadOnlyPreview?: () => void;
}

export const ShareViewModal: React.FC<ShareViewModalProps> = ({
  isOpen,
  theme,
  blueprintTitle,
  modelUrl,
  taskId,
  onClose,
  onEnterReadOnlyPreview,
}) => {
  const [copied, setCopied] = useState(false);
  const isLight = theme === 'light';

  useEffect(() => {
    if (!isOpen) {
      setCopied(false);
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const buildShareLink = () => {
    const base = `${window.location.origin}${window.location.pathname}`;
    const params = new URLSearchParams();
    params.set('mode', 'view');
    if (modelUrl && !modelUrl.startsWith('blob:')) {
      params.set('model', modelUrl);
    } else if (taskId) {
      params.set('taskId', taskId);
    } else {
      params.set('model', 'tripo3d-active');
    }
    if (blueprintTitle) {
      params.set('title', blueprintTitle);
    }
    return `${base}?${params.toString()}`;
  };

  const shareUrl = buildShareLink();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2600);
    } catch {
      const input = document.createElement('input');
      input.value = shareUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2600);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/65 transition-opacity"
        aria-hidden="true"
      />

      {/* Modal Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-modal-title"
        className={`relative z-10 w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden transition-colors ${
          isLight
            ? 'bg-white border-slate-200 text-[#040B29]'
            : 'bg-[#111827] border-[#0047BA] text-slate-100'
        }`}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between px-6 py-4 border-b ${
            isLight
              ? 'bg-[#F8FAFC] border-slate-200'
              : 'bg-[#161b22] border-slate-800'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#0047BA]/15 border border-[#0047BA]/40 flex items-center justify-center">
              <Share2 className="w-4 h-4 text-[#FF7A00]" />
            </div>
            <div>
              <span className="text-[11px] font-mono font-semibold text-[#FF7A00]">
                ENLACE DE VISUALIZACIÓN 360° · SOLO LECTURA
              </span>
              <h2 id="share-modal-title" className="text-base font-bold">
                Compartir Vista 3D Interactiva
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className={`p-2 rounded-lg border transition-colors cursor-pointer ${
              isLight
                ? 'border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                : 'border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
            title="Cerrar (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          <div
            className={`p-3.5 rounded-xl border flex items-start gap-3 text-xs ${
              isLight
                ? 'bg-[#EBF3FF]/60 border-[#A6C8FF] text-[#040B29]'
                : 'bg-[#0b1324] border-[#0047BA]/60 text-slate-200'
            }`}
          >
            <Globe className="w-4 h-4 text-[#FF7A00] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold">
                Modo Presentación Cliente (Solo Lectura · 360°)
              </p>
              <p className="opacity-80 leading-relaxed">
                Quienes abran este enlace accederán directamente al visor 3D en
                pantalla completa con rotación 360°, zoom e iluminación solar,
                ocultando las herramientas de edición de los Pasos 1 y 2.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-mono font-semibold text-[#A6C8FF]">
              URL Directa de Visualización (?mode=view)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={shareUrl}
                onClick={(e) => (e.target as HTMLInputElement).select()}
                className={`flex-1 px-3.5 py-2.5 rounded-xl border text-xs font-mono focus:outline-none ${
                  isLight
                    ? 'bg-slate-50 border-slate-300 text-[#040B29]'
                    : 'bg-[#0b0f19] border-slate-700 text-slate-200'
                }`}
              />
              <button
                type="button"
                onClick={handleCopy}
                className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold transition-colors cursor-pointer shrink-0 ${
                  copied
                    ? 'bg-emerald-600 text-white'
                    : 'bg-[#FF7A00] hover:bg-[#e56d00] text-white'
                }`}
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4" />
                    ¡Copiado!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    Copiar Enlace
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-slate-500/20 text-xs">
            <div className="flex items-center gap-1.5 font-mono text-emerald-400">
              <ShieldCheck className="w-4 h-4" />
              <span>Controles de edición bloqueados en destino</span>
            </div>

            {onEnterReadOnlyPreview && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onEnterReadOnlyPreview();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0047BA] hover:bg-[#002068] text-white font-semibold cursor-pointer transition-colors"
              >
                <Eye className="w-3.5 h-3.5 text-[#FF7A00]" />
                Probar Vista Solo Lectura
                <ExternalLink className="w-3 h-3 opacity-80" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
