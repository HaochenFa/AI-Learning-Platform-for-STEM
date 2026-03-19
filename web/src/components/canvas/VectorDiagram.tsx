"use client";

import type { CanvasSpec } from "@/lib/chat/types";

type VectorDiagramProps = {
  spec: Extract<CanvasSpec, { type: "vector" }>;
};

const SVG_SIZE = 220;
const CENTER = SVG_SIZE / 2;
const SCALE = 32; // pixels per unit magnitude

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

export default function VectorDiagram({ spec }: VectorDiagramProps) {
  const { title, vectors, gridSize = 10 } = spec;

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-ui-primary">{title}</p>
      <div className="flex items-start gap-4">
        <div className="overflow-hidden rounded-xl border border-default bg-[var(--surface-muted)]">
          <svg
            width={SVG_SIZE}
            height={SVG_SIZE}
            viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
            aria-label={title}
            role="img"
          >
            {/* Grid lines */}
            {Array.from({ length: Math.floor(SVG_SIZE / gridSize) + 1 }, (_, i) => i * gridSize).map((pos) => (
              <g key={`grid-${pos}`}>
                <line x1={pos} y1={0} x2={pos} y2={SVG_SIZE} stroke="var(--color-border)" strokeWidth={0.5} />
                <line x1={0} y1={pos} x2={SVG_SIZE} y2={pos} stroke="var(--color-border)" strokeWidth={0.5} />
              </g>
            ))}
            {/* Axes */}
            <line x1={CENTER} y1={4} x2={CENTER} y2={SVG_SIZE - 4} stroke="var(--color-muted-foreground)" strokeWidth={1} />
            <line x1={4} y1={CENTER} x2={SVG_SIZE - 4} y2={CENTER} stroke="var(--color-muted-foreground)" strokeWidth={1} />
            {/* Axis labels */}
            <text x={CENTER + 6} y={14} fontSize={9} fill="var(--color-muted-foreground)">+y</text>
            <text x={SVG_SIZE - 14} y={CENTER - 4} fontSize={9} fill="var(--color-muted-foreground)">+x</text>
            {/* Vectors */}
            {vectors.map((vec) => {
              const rad = toRad(vec.angleDeg);
              const mag = Math.min(vec.magnitude, 5) * SCALE;
              const dx = mag * Math.cos(rad);
              const dy = -mag * Math.sin(rad); // SVG y is inverted
              const x2 = CENTER + dx;
              const y2 = CENTER + dy;

              // Arrowhead
              const arrowSize = 8;
              const angle = Math.atan2(dy, dx);
              const ax1 = x2 - arrowSize * Math.cos(angle - 0.4);
              const ay1 = y2 - arrowSize * Math.sin(angle - 0.4);
              const ax2 = x2 - arrowSize * Math.cos(angle + 0.4);
              const ay2 = y2 - arrowSize * Math.sin(angle + 0.4);

              return (
                <g key={vec.label}>
                  <line
                    x1={CENTER}
                    y1={CENTER}
                    x2={x2}
                    y2={y2}
                    stroke={vec.color}
                    strokeWidth={2.5}
                  />
                  <polygon
                    points={`${x2},${y2} ${ax1},${ay1} ${ax2},${ay2}`}
                    fill={vec.color}
                  />
                  <text
                    x={x2 + (dx > 0 ? 5 : -5)}
                    y={y2 + (dy > 0 ? 12 : -5)}
                    fontSize={10}
                    fill={vec.color}
                    textAnchor={dx > 0 ? "start" : "end"}
                  >
                    {vec.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <div className="space-y-2 pt-1">
          {vectors.map((vec) => (
            <div key={vec.label} className="flex items-start gap-2">
              <span
                className="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: vec.color }}
              />
              <div className="text-xs text-ui-muted">
                <span className="font-medium text-ui-primary">{vec.label}</span>
                <br />
                {vec.magnitude} units, {vec.angleDeg}°
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
