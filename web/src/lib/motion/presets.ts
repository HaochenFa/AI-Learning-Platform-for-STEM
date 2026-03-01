import type { Transition, Variants } from "motion/react";

export const STANDARD_EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1];

export const MICRO_TRANSITION: Transition = {
  duration: 0.16,
  ease: STANDARD_EASE,
};

export const STANDARD_TRANSITION: Transition = {
  duration: 0.22,
  ease: STANDARD_EASE,
};

export const SURFACE_TRANSITION: Transition = {
  duration: 0.26,
  ease: STANDARD_EASE,
};

export const FADE_UP_VARIANTS: Variants = {
  initial: { opacity: 0, y: 10 },
  enter: { opacity: 1, y: 0, transition: SURFACE_TRANSITION },
  exit: { opacity: 0, y: 6, transition: STANDARD_TRANSITION },
};

export const STAGGER_CONTAINER: Variants = {
  initial: { opacity: 0 },
  enter: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.04,
    },
  },
};

export const STAGGER_ITEM: Variants = {
  initial: { opacity: 0, y: 8 },
  enter: { opacity: 1, y: 0, transition: STANDARD_TRANSITION },
};

export const GENTLE_SCALE_VARIANTS: Variants = {
  initial: { opacity: 0, scale: 0.98 },
  enter: { opacity: 1, scale: 1, transition: STANDARD_TRANSITION },
  exit: { opacity: 0, scale: 0.98, transition: MICRO_TRANSITION },
};
