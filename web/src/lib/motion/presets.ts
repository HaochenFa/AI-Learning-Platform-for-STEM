import type { Transition, Variants } from "motion/react";

export const STANDARD_EASE: [number, number, number, number] = [0.25, 0.46, 0.45, 0.94];

export const MICRO_TRANSITION: Transition = {
  duration: 0.2,
  ease: STANDARD_EASE,
};

export const STANDARD_TRANSITION: Transition = {
  duration: 0.32,
  ease: STANDARD_EASE,
};

export const SURFACE_TRANSITION: Transition = {
  duration: 0.42,
  ease: STANDARD_EASE,
};

export const FADE_UP_VARIANTS: Variants = {
  initial: { opacity: 0, y: 18 },
  enter: { opacity: 1, y: 0, transition: SURFACE_TRANSITION },
  exit: { opacity: 0, y: 8, transition: STANDARD_TRANSITION },
};

export const STAGGER_CONTAINER: Variants = {
  initial: { opacity: 0 },
  enter: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.06,
    },
  },
};

export const STAGGER_ITEM: Variants = {
  initial: { opacity: 0, y: 12 },
  enter: { opacity: 1, y: 0, transition: STANDARD_TRANSITION },
};

export const GENTLE_SCALE_VARIANTS: Variants = {
  initial: { opacity: 0, scale: 0.98 },
  enter: { opacity: 1, scale: 1, transition: STANDARD_TRANSITION },
  exit: { opacity: 0, scale: 0.98, transition: MICRO_TRANSITION },
};

export const CANVAS_SPRING_TRANSITION = {
  type: "spring" as const,
  stiffness: 180,
  damping: 26,
  mass: 0.9,
};
