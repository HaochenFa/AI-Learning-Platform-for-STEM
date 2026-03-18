"use client";

import { motion } from "motion/react";
import type { CanvasSpec } from "@/lib/chat/types";
import ChartCanvas from "./ChartCanvas";
import DiagramCanvas from "./DiagramCanvas";
import WaveSimulation from "./WaveSimulation";
import VectorDiagram from "./VectorDiagram";

export type CanvasState = "idle" | "loading" | "revealed" | "error";

type GenerativeCanvasProps = {
  state: CanvasState;
  spec: CanvasSpec | null;
  title?: string;
  error?: string | null;
};

const SPRING_TRANSITION = {
  type: "spring" as const,
  stiffness: 300,
  damping: 28,
  mass: 0.8,
};

export default function GenerativeCanvas({ state, spec, title, error }: GenerativeCanvasProps) {
  if (state === "idle") {
    return null;
  }

  if (state === "loading") {
    return (
      <div className="mt-3 overflow-hidden rounded-2xl border border-default bg-[var(--surface-muted)]">
        <div className="px-4 pb-4 pt-3">
          <div className="mb-3 flex items-center gap-2">
            <div className="h-2 w-2 animate-pulse rounded-full bg-accent" />
            <span className="text-xs font-medium uppercase tracking-wider text-ui-muted">
              Generating visual
            </span>
          </div>
          {title && (
            <p className="mb-3 text-sm font-medium text-ui-primary">{title}</p>
          )}
          <div className="space-y-2">
            <div className="h-3 w-3/4 animate-pulse rounded bg-default" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-default" />
            <div className="mt-4 h-32 animate-pulse rounded-xl bg-default" />
          </div>
        </div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
        <p className="text-xs text-rose-600">{error ?? "Could not generate visual."}</p>
      </div>
    );
  }

  if (!spec) {
    return null;
  }

  return (
    <motion.div
      className="mt-3 overflow-hidden rounded-2xl border border-default bg-[var(--color-surface)]"
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={SPRING_TRANSITION}
    >
      <div className="px-4 pb-4 pt-3">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-accent">
            Visual
          </span>
        </div>
        <CanvasContent spec={spec} />
      </div>
    </motion.div>
  );
}

function CanvasContent({ spec }: { spec: CanvasSpec }) {
  switch (spec.type) {
    case "chart":
      return <ChartCanvas spec={spec} />;
    case "diagram":
      return <DiagramCanvas spec={spec} />;
    case "wave":
      return <WaveSimulation spec={spec} />;
    case "vector":
      return <VectorDiagram spec={spec} />;
    default:
      return null;
  }
}
