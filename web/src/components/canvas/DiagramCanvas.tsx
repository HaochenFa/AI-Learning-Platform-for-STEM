"use client";

import { useEffect, useRef, useState } from "react";
import type { CanvasSpec } from "@/lib/chat/types";

type DiagramCanvasProps = {
  spec: Extract<CanvasSpec, { type: "diagram" }>;
};

export default function DiagramCanvas({ spec }: DiagramCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function renderDiagram() {
      if (!containerRef.current) return;

      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "antiscript" });

        const id = `diagram-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(id, spec.definition);

        if (!cancelled && containerRef.current) {
          // svg is trusted output from the mermaid library, not user-supplied HTML
          containerRef.current.innerHTML = svg;
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError("Could not render diagram. The definition may be invalid.");
          if (containerRef.current) {
            containerRef.current.innerHTML = "";
          }
        }
      }
    }

    renderDiagram();
    return () => {
      cancelled = true;
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
    };
  }, [spec.definition]);

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-ui-primary">{spec.title}</p>
      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</p>
      ) : (
        <div
          ref={containerRef}
          className="flex min-h-24 items-center justify-center overflow-auto rounded-xl border border-default bg-[var(--surface-muted)] p-3 [&_svg]:max-w-full"
        />
      )}
    </div>
  );
}
