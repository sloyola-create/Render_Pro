import React, { useCallback, useRef, useState } from 'react';
import { MoveHorizontal, SlidersHorizontal } from 'lucide-react';
import { ThemeMode } from '../types/render';

interface StepComparisonSliderProps {
  step1ImageUrl: string | null;
  step2ImageUrl: string | null;
  theme: ThemeMode;
  blueprintTitle?: string;
}

export const StepComparisonSlider: React.FC<StepComparisonSliderProps> = ({
  step1ImageUrl,
  step2ImageUrl,
  theme,
  blueprintTitle,
}) => {
  const [sliderPercent, setSliderPercent] = useState<number>(50);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isLight = theme === 'light';

  const updatePositionFromClientX = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = ((clientX - rect.left) / rect.width) * 100;
    setSliderPercent(Math.max(0, Math.min(100, Number(ratio.toFixed(1)))));
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    updatePositionFromClientX(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    updatePositionFromClientX(e.clientX);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      setIsDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore if already released
      }
    }
  };

  const baseRightImage = step2ImageUrl || step1ImageUrl;
  const topLeftImage = step1ImageUrl || step2ImageUrl;

  return (
    <div className="flex flex-col w-full h-full min-h-0 space-y-3 select-none">
      {/* Control Header */}
      <div
        className={`flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-xl border ${
          isLight
            ? 'bg-white border-slate-200 text-[#040B29]'
            : 'bg-[#111827] border-slate-800 text-slate-200'
        }`}
      >
        <div className="flex items-center gap-2 text-xs">
          <SlidersHorizontal className="w-4 h-4 text-[#FF7A00]" />
          <span className="font-semibold">
            Cortina Interactiva Before / After:
          </span>
          <span className="opacity-80">
            Arrastra la barra vertical de izquierda a derecha para comparar
            Paso 1 (Plano 2D) vs Paso 2 (Render CGI)
          </span>
        </div>

        <div className="flex items-center gap-2.5 text-xs font-mono">
          <span className="text-[#A6C8FF]">Paso 1 (2D)</span>
          <input
            type="range"
            min={0}
            max={100}
            step={0.5}
            value={sliderPercent}
            onChange={(e) => setSliderPercent(parseFloat(e.target.value))}
            className="w-36 accent-[#FF7A00] cursor-pointer"
          />
          <span className="text-[#FF7A00]">Paso 2 (CGI)</span>
          <span className="w-11 text-right font-bold tabular-nums">
            {Math.round(sliderPercent)}%
          </span>
        </div>
      </div>

      {/* Interactive Side-by-Side Curtain Viewport */}
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`relative flex-1 min-h-[340px] rounded-2xl border overflow-hidden flex items-center justify-center cursor-ew-resize shadow-2xl ${
          isLight
            ? 'bg-slate-100 border-slate-300'
            : 'bg-[#070d19] border-slate-800'
        }`}
      >
        {baseRightImage && topLeftImage ? (
          <div className="relative inline-flex items-center justify-center max-h-[62vh] max-w-[88vw]">
            {/* Layer 1 (Right / Full Base): Step 2 CGI Render */}
            <img
              src={baseRightImage}
              alt={
                blueprintTitle
                  ? `Paso 2 Render CGI — ${blueprintTitle}`
                  : 'Paso 2 Render CGI'
              }
              referrerPolicy="no-referrer"
              draggable={false}
              className="max-h-[60vh] w-auto object-contain block select-none pointer-events-none"
            />

            {/* Layer 2 (Left Clipped Curtain): Step 1 2D Blueprint */}
            <img
              src={topLeftImage}
              alt={
                blueprintTitle
                  ? `Paso 1 Plano 2D — ${blueprintTitle}`
                  : 'Paso 1 Plano 2D'
              }
              referrerPolicy="no-referrer"
              draggable={false}
              className="absolute inset-0 w-full h-full object-contain block select-none pointer-events-none bg-white"
              style={{
                clipPath: `inset(0 ${100 - sliderPercent}% 0 0)`,
              }}
            />

            {/* Corner Labels */}
            <div className="absolute top-3 left-3 z-10 px-2.5 py-1 rounded-lg bg-[#040B29]/90 border border-[#0047BA] text-[11px] font-mono font-semibold text-white pointer-events-none shadow-md">
              PASO 1 · PLANO 2D
            </div>

            <div className="absolute top-3 right-3 z-10 px-2.5 py-1 rounded-lg bg-[#040B29]/90 border border-[#FF7A00] text-[11px] font-mono font-semibold text-[#FF7A00] pointer-events-none shadow-md">
              PASO 2 · RENDER CGI HD
            </div>

            {/* Vertical Curtain Divider Bar & Handle */}
            <div
              className="absolute inset-y-0 z-20 w-0.5 bg-[#FF7A00] pointer-events-none shadow-[0_0_12px_rgba(255,122,0,0.9)]"
              style={{ left: `${sliderPercent}%` }}
            >
              <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-[#FF7A00] border-2 border-white text-[#040B29] shadow-xl flex items-center justify-center">
                <MoveHorizontal className="w-4 h-4 stroke-[2.5]" />
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-400">
            Procesa el Paso 1 y el Paso 2 para activar la cortina comparativa
            interactiva.
          </p>
        )}
      </div>
    </div>
  );
};
