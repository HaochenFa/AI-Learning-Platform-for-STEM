"use client";

import { useEffect, useRef, useState } from "react";
import type { CanvasSpec } from "@/lib/chat/types";

type DiagramCanvasProps = {
  spec: Extract<CanvasSpec, { type: "diagram" }>;
};

let _mermaidInit = false;
function ensureMermaidInit(mermaid: { initialize: (config: object) => void }) {
  if (_mermaidInit) return;
  mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "antiscript" });
  _mermaidInit = true;
}

export default function DiagramCanvas({ spec }: DiagramCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;

    async function renderDiagram() {
      if (!container) return;

      try {
        const mermaid = (await import("mermaid")).default;
        ensureMermaidInit(mermaid);

        const id = `diagram-${Math.random().toString(36).slice(2)}`;
        setIsRendering(true);
        const { svg } = await mermaid.render(id, spec.definition);
        setIsRendering(false);

        if (!cancelled) {
          // svg is trusted output from the mermaid library, not user-supplied HTML
          container.innerHTML = svg;
          setError(null);
        }
      } catch {
        if (!cancelled) {
          setIsRendering(false);
          setError("Could not render diagram. The definition may be invalid.");
          container.innerHTML = "";
        }
      }
    }

    renderDiagram();
    return () => {
      cancelled = true;
      if (container) {
        container.innerHTML = "";
      }
    };
  }, [spec.definition]);

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-ui-primary">{spec.title}</p>
      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</p>
      ) : isRendering ? (
        <div className="min-h-24 animate-pulse rounded-xl border border-default bg-[var(--surface-muted)]" />
      ) : (
        <div
          ref={containerRef}
          className="flex min-h-24 items-center justify-center overflow-auto rounded-xl border border-default bg-[var(--surface-muted)] p-3 [&_svg]:max-w-full"
        />
      )}
    </div>
  );
}
