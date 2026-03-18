"use client";

import { useEffect, useRef } from "react";
import type { CanvasSpec } from "@/lib/chat/types";

type WaveSimulationProps = {
  spec: Extract<CanvasSpec, { type: "wave" }>;
};

const CANVAS_HEIGHT = 160;
const CANVAS_WIDTH = 400;

function drawWaves(
  ctx: CanvasRenderingContext2D,
  waves: Extract<CanvasSpec, { type: "wave" }>["waves"],
  phase: number,
  width: number,
  height: number,
) {
  ctx.clearRect(0, 0, width, height);

  const midY = height / 2;
  const xScale = (2 * Math.PI) / width;

  // Draw baseline
  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(width, midY);
  ctx.stroke();
  ctx.setLineDash([]);

  waves.forEach((wave) => {
    const maxAmplitude = (height / 2) * 0.8;
    const amp = Math.min(wave.amplitude, 2) * (maxAmplitude / 2);
    const freq = Math.min(wave.frequency, 5);

    ctx.strokeStyle = wave.color;
    ctx.lineWidth = 2;
    ctx.beginPath();

    for (let x = 0; x <= width; x++) {
      const y = midY - amp * Math.sin(freq * xScale * x + phase);
      if (x === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  });
}

export default function WaveSimulation({ spec }: WaveSimulationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const phaseRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.offsetWidth || CANVAS_WIDTH;
    canvas.width = width;
    canvas.height = CANVAS_HEIGHT;

    function animate() {
      if (!ctx || !canvas) return;
      phaseRef.current += 0.04;
      drawWaves(ctx, spec.waves, phaseRef.current, canvas.width, canvas.height);
      rafRef.current = requestAnimationFrame(animate);
    }

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [spec.waves]);

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-ui-primary">{spec.title}</p>
      <div className="overflow-hidden rounded-xl border border-default bg-[var(--surface-muted)] p-2">
        <canvas ref={canvasRef} className="w-full" height={CANVAS_HEIGHT} />
      </div>
      {spec.waves.length > 1 && (
        <div className="flex flex-wrap gap-3 px-1">
          {spec.waves.map((wave) => (
            <div key={wave.label} className="flex items-center gap-1.5 text-xs text-ui-muted">
              <span
                className="inline-block h-2 w-5 rounded-full"
                style={{ backgroundColor: wave.color }}
              />
              {wave.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
