import React, { useEffect, useMemo, useState } from 'react';
import {
  Calculator,
  Check,
  ClipboardCopy,
  Download,
  FileText,
  Layers,
  PackageCheck,
  Printer,
  Ruler,
  ShieldCheck,
  X,
} from 'lucide-react';
import { BlueprintData, ThemeMode } from '../types/render';
import {
  calculateProdalamCommercialMetrics,
  formatProdalamQuoteSummaryText,
  MetalconProfileSeries,
  StripLengthOption,
} from '../utils/commercialCalculator';

interface CommercialQuoteModalProps {
  isOpen: boolean;
  theme: ThemeMode;
  blueprint: BlueprintData | null;
  onClose: () => void;
}

export const CommercialQuoteModal: React.FC<CommercialQuoteModalProps> = ({
  isOpen,
  theme,
  blueprint,
  onClose,
}) => {
  const [profileSeries, setProfileSeries] =
    useState<MetalconProfileSeries>('90R');
  const [stripLengthMeters, setStripLengthMeters] =
    useState<StripLengthOption>(6);
  const [copiedSummary, setCopiedSummary] = useState<boolean>(false);

  const isLight = theme === 'light';

  useEffect(() => {
    if (!isOpen) {
      setCopiedSummary(false);
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const metrics = useMemo(
    () =>
      calculateProdalamCommercialMetrics(blueprint, {
        profileSeries,
        stripLengthMeters,
        wallHeightMeters: 2.4,
      }),
    [blueprint, profileSeries, stripLengthMeters]
  );

  if (!isOpen) return null;

  const projectTitle =
    blueprint?.title || 'Proyecto Arquitectónico Prodalam Render Pro v9.6';

  const handleCopySummary = async () => {
    const summaryText = formatProdalamQuoteSummaryText(projectTitle, metrics);
    try {
      await navigator.clipboard.writeText(summaryText);
      setCopiedSummary(true);
      window.setTimeout(() => setCopiedSummary(false), 2600);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = summaryText;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedSummary(true);
      window.setTimeout(() => setCopiedSummary(false), 2600);
    }
  };

  const handleDownloadTechnicalSheet = () => {
    const summaryText = formatProdalamQuoteSummaryText(projectTitle, metrics);
    const blob = new Blob([summaryText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${blueprint?.id || 'ficha-tecnica'}-cubicacion-prodalam-v7.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handlePrintPdfSheet = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/65 transition-opacity"
        aria-hidden="true"
      />

      {/* Modal Container */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="commercial-quote-modal-title"
        className={`relative z-10 w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl border shadow-2xl overflow-hidden transition-colors ${
          isLight
            ? 'bg-white border-slate-200 text-[#040B29]'
            : 'bg-[#0d121d] border-[#0047BA] text-slate-100'
        }`}
      >
        {/* Top Corporate Header */}
        <div
          className={`flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-b shrink-0 ${
            isLight
              ? 'bg-[#F8FAFC] border-slate-200'
              : 'bg-[#111827] border-slate-800'
          }`}
        >
          <div className="flex items-center gap-3.5">
            <div className="bg-white px-3 py-1.5 rounded-lg border border-slate-200/80 shadow-xs">
              <img
                src="/assets/aistudio/Logo-Principal-Azul_6c28d9e0.png"
                alt="Prodalam"
                referrerPolicy="no-referrer"
                className="h-5 w-auto object-contain select-none"
              />
            </div>
            <div>
              <div className="flex items-center gap-2 text-[11px] font-mono font-semibold text-[#FF7A00]">
                <span>MÓDULO DE INGENIERÍA Y CUBICACIÓN COMERCIAL</span>
                <span aria-hidden="true">·</span>
                <span>v10.0</span>
              </div>
              <h2
                id="commercial-quote-modal-title"
                className="text-base font-bold"
              >
                Ficha Técnica & Cotización Estimada Prodalam
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
            title="Cerrar Ficha Técnica (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* 1. Resumen de Superficies y Métricas CAD */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Ruler className="w-4 h-4 text-[#FF7A00]" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#0047BA] dark:text-[#A6C8FF]">
                  1. Resumen de Superficies y Métricas CAD ({projectTitle})
                </h3>
              </div>
              <span className="text-xs font-mono text-emerald-400">
                {metrics.wallCount} segmentos vectoriales ·{' '}
                {metrics.openingsCount} vanos
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Superficie Habitable */}
              <div
                className={`p-4 rounded-xl border ${
                  isLight
                    ? 'bg-[#F8FAFC] border-slate-200'
                    : 'bg-[#141c2b] border-slate-800'
                }`}
              >
                <div className="text-[11px] font-mono text-slate-400">
                  SUPERFICIE HABITABLE
                </div>
                <div className="text-2xl font-bold font-mono text-[#FF7A00] mt-1 tabular-nums">
                  {metrics.habitableAreaM2.toFixed(1)} m²
                </div>
                <div className="text-[11px] opacity-75 mt-1 font-mono tabular-nums">
                  Huella Losa: {metrics.slabFootprintAreaM2.toFixed(1)} m²
                </div>
              </div>

              {/* Metros Lineales de Muro */}
              <div
                className={`p-4 rounded-xl border ${
                  isLight
                    ? 'bg-[#F8FAFC] border-slate-200'
                    : 'bg-[#141c2b] border-slate-800'
                }`}
              >
                <div className="text-[11px] font-mono text-slate-400">
                  METROS LINEALES DE MURO
                </div>
                <div className="text-2xl font-bold font-mono text-[#0047BA] dark:text-[#A6C8FF] mt-1 tabular-nums">
                  {metrics.totalWallsLinearM.toFixed(1)} m
                </div>
                <div className="text-[11px] opacity-75 mt-1 font-mono tabular-nums">
                  Ext: {metrics.exteriorWallsLinearM.toFixed(1)}m · Int:{' '}
                  {metrics.interiorWallsLinearM.toFixed(1)}m
                </div>
              </div>

              {/* Perímetro de Cierre Exterior */}
              <div
                className={`p-4 rounded-xl border ${
                  isLight
                    ? 'bg-[#F8FAFC] border-slate-200'
                    : 'bg-[#141c2b] border-slate-800'
                }`}
              >
                <div className="text-[11px] font-mono text-slate-400">
                  PERÍMETRO DE CIERRE EXTERIOR
                </div>
                <div className="text-2xl font-bold font-mono text-emerald-400 mt-1 tabular-nums">
                  {metrics.perimeterClosureLinearM.toFixed(1)} m
                </div>
                <div className="text-[11px] opacity-75 mt-1 font-mono">
                  Cerco Acmafor 3D / Malla
                </div>
              </div>

              {/* Superficie Cubierta Techumbre */}
              <div
                className={`p-4 rounded-xl border ${
                  isLight
                    ? 'bg-[#F8FAFC] border-slate-200'
                    : 'bg-[#141c2b] border-slate-800'
                }`}
              >
                <div className="text-[11px] font-mono text-slate-400">
                  CUBIERTA / TECHUMBRE
                </div>
                <div className="text-2xl font-bold font-mono mt-1 tabular-nums">
                  {metrics.roofAreaM2.toFixed(1)} m²
                </div>
                <div className="text-[11px] opacity-75 mt-1 font-mono">
                  Incluye pendiente y aleros (1.18x)
                </div>
              </div>
            </div>
          </section>

          {/* Configurador Rápido de Estándar Metalcon Prodalam */}
          <section
            className={`p-4 rounded-xl border flex flex-wrap items-center justify-between gap-4 ${
              isLight
                ? 'bg-[#EBF3FF]/60 border-[#A6C8FF]'
                : 'bg-[#111827] border-[#0047BA]/60'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Calculator className="w-4 h-4 text-[#FF7A00]" />
              <div>
                <div className="text-xs font-bold">
                  Parámetros de Cubicación Estructural Prodalam
                </div>
                <div className="text-[11px] opacity-80">
                  Cálculo automático: 1 montante cada 40 cm + canales
                  superior/inferior + traslapes técnicos
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Selector de Serie 38R / 60R / 90R */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-mono opacity-80">Perfil:</span>
                {(['38R', '60R', '90R'] as MetalconProfileSeries[]).map(
                  (series) => (
                    <button
                      key={series}
                      type="button"
                      onClick={() => setProfileSeries(series)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-colors cursor-pointer ${
                        profileSeries === series
                          ? 'bg-[#0047BA] text-white'
                          : isLight
                            ? 'bg-white border border-slate-300 text-slate-700 hover:border-[#0047BA]'
                            : 'bg-[#0b0f19] border border-slate-700 text-slate-300 hover:border-[#0047BA]'
                      }`}
                    >
                      {series}
                    </button>
                  )
                )}
              </div>

              {/* Selector de Largo de Tira (3m / 6m) */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-mono opacity-80">Tira:</span>
                {([3, 6] as StripLengthOption[]).map((len) => (
                  <button
                    key={len}
                    type="button"
                    onClick={() => setStripLengthMeters(len)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-colors cursor-pointer ${
                      stripLengthMeters === len
                        ? 'bg-[#FF7A00] text-white'
                        : isLight
                          ? 'bg-white border border-slate-300 text-slate-700 hover:border-[#FF7A00]'
                          : 'bg-[#0b0f19] border border-slate-700 text-slate-300 hover:border-[#FF7A00]'
                    }`}
                  >
                    {len}.0m
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* 2. Tabla Desglosada de Materiales Prodalam */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PackageCheck className="w-4 h-4 text-[#FF7A00]" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#0047BA] dark:text-[#A6C8FF]">
                  2. Desglose Estimado de Materiales Prodalam
                </h3>
              </div>
              <span className="text-[11px] font-mono opacity-75">
                Valores calculados en base a geometría 1:1 del plano
              </span>
            </div>

            <div
              className={`rounded-xl border overflow-hidden ${
                isLight ? 'border-slate-200' : 'border-slate-800'
              }`}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr
                      className={`border-b font-mono text-[11px] uppercase ${
                        isLight
                          ? 'bg-slate-100 border-slate-200 text-slate-600'
                          : 'bg-[#141c2b] border-slate-800 text-slate-400'
                      }`}
                    >
                      <th className="py-3 px-4">Código / Familia</th>
                      <th className="py-3 px-4">Descripción Técnica Prodalam</th>
                      <th className="py-3 px-4 text-right">
                        Cantidad Estimada
                      </th>
                      <th className="py-3 px-4">Unidad</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-500/15">
                    {metrics.materials.map((item) => (
                      <tr
                        key={item.code}
                        className={
                          isLight
                            ? 'hover:bg-slate-50/90'
                            : 'hover:bg-slate-800/35'
                        }
                      >
                        <td className="py-3 px-4 align-top">
                          <div className="font-mono font-bold text-[#0047BA] dark:text-[#A6C8FF]">
                            {item.code}
                          </div>
                          <div className="text-[11px] opacity-70">
                            {item.family}
                          </div>
                        </td>
                        <td className="py-3 px-4 align-top">
                          <div className="font-semibold">{item.description}</div>
                          <div className="text-[11px] opacity-75 mt-0.5">
                            {item.notes}
                          </div>
                        </td>
                        <td className="py-3 px-4 align-top text-right font-mono text-sm font-bold text-[#FF7A00] tabular-nums">
                          {item.quantity}
                        </td>
                        <td className="py-3 px-4 align-top font-mono text-xs opacity-90 whitespace-nowrap">
                          {item.unit}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>

        {/* Footer Actions: Copiar Resumen & Descargar Ficha Técnica (.PDF / Text) */}
        <div
          className={`px-6 py-4 border-t flex flex-wrap items-center justify-between gap-3 shrink-0 ${
            isLight
              ? 'bg-[#F8FAFC] border-slate-200'
              : 'bg-[#111827] border-slate-800'
          }`}
        >
          <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
            <ShieldCheck className="w-4 h-4 text-[#FF7A00]" />
            <span>PRODALAM RENDER PRO v9.6 · CUBICACIÓN AUTOMÁTICA CAD</span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={handleCopySummary}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                copiedSummary
                  ? 'bg-emerald-600 text-white'
                  : 'bg-[#0047BA] hover:bg-[#002068] text-white'
              }`}
            >
              {copiedSummary ? (
                <>
                  <Check className="w-4 h-4" />
                  ¡Resumen Copiado al Portapapeles!
                </>
              ) : (
                <>
                  <ClipboardCopy className="w-4 h-4 text-[#FF7A00]" />
                  Copiar Resumen para Vendedor / Cliente
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleDownloadTechnicalSheet}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#FF7A00] hover:bg-[#e56d00] text-white text-xs font-bold transition-colors cursor-pointer shadow-sm"
            >
              <Download className="w-4 h-4" />
              Descargar Ficha Técnica (.PDF / Text)
            </button>

            <button
              type="button"
              onClick={handlePrintPdfSheet}
              className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl border text-xs font-semibold transition-colors cursor-pointer ${
                isLight
                  ? 'bg-white hover:bg-slate-100 border-slate-300 text-[#040B29]'
                  : 'bg-[#1f2937] hover:bg-slate-700 border-slate-700 text-slate-200'
              }`}
              title="Imprimir o Guardar como PDF"
            >
              <Printer className="w-4 h-4 text-[#A6C8FF]" />
              PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
