"use client";

import type { ReactNode } from "react";
import { MotionConfig } from "motion/react";
import { STANDARD_EASE, STANDARD_TRANSITION } from "@/lib/motion/presets";

type MotionProviderProps = {
  children: ReactNode;
};

export default function MotionProvider({ children }: MotionProviderProps) {
  return (
    <MotionConfig transition={{ ...STANDARD_TRANSITION, ease: STANDARD_EASE }} reducedMotion="user">
      {children}
    </MotionConfig>
  );
}
