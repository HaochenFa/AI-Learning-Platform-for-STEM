"use client";

import { useEffect, useRef } from "react";

type AmbientBackgroundProps = {
  className?: string;
};

export default function AmbientBackground({ className }: AmbientBackgroundProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) {
      node.style.setProperty("--cursor-x", "50%");
      node.style.setProperty("--cursor-y", "30%");
      return;
    }

    let frame = 0;
    let targetX = 50;
    let targetY = 30;
    let currentX = 50;
    let currentY = 30;

    const update = () => {
      currentX += (targetX - currentX) * 0.08;
      currentY += (targetY - currentY) * 0.08;
      node.style.setProperty("--cursor-x", `${currentX.toFixed(2)}%`);
      node.style.setProperty("--cursor-y", `${currentY.toFixed(2)}%`);
      frame = window.requestAnimationFrame(update);
    };

    const handleMove = (event: PointerEvent) => {
      const x = (event.clientX / window.innerWidth) * 100;
      const y = (event.clientY / window.innerHeight) * 100;
      targetX = Math.min(90, Math.max(10, x));
      targetY = Math.min(90, Math.max(10, y));
    };

    const handleLeave = () => {
      targetX = 50;
      targetY = 30;
    };

    window.addEventListener("pointermove", handleMove, { passive: true });
    document.addEventListener("mouseleave", handleLeave);
    window.addEventListener("blur", handleLeave);
    frame = window.requestAnimationFrame(update);

    return () => {
      window.removeEventListener("pointermove", handleMove);
      document.removeEventListener("mouseleave", handleLeave);
      window.removeEventListener("blur", handleLeave);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={ref} className={`ambient-bg ${className ?? ""}`}>
      <div className="ambient-vignette" />
    </div>
  );
}
