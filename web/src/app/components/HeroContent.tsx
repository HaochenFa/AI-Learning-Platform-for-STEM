"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { AppIcons } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  FADE_UP_VARIANTS,
  STAGGER_CONTAINER,
  STAGGER_ITEM,
} from "@/lib/motion/presets";

type HeroContentProps = {
  primaryHref: string;
  primaryLabel: string;
  secondaryHref: string;
  secondaryLabel: string;
};

const WORKFLOW_STEPS = [
  {
    n: "01",
    label: "Upload materials",
    detail: "Lecture notes, slides, or reading lists — any format.",
  },
  {
    n: "02",
    label: "Curate blueprint",
    detail: "Review and refine the AI-generated topic and objective structure.",
  },
  {
    n: "03",
    label: "Launch activities",
    detail: "Students access guided chat, quizzes, and flashcards instantly.",
  },
];

export default function HeroContent({
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
}: HeroContentProps) {
  return (
    <div className="space-y-10">
      {/* Zone A — Headline + CTA */}
      <motion.div
        variants={STAGGER_CONTAINER}
        initial="initial"
        animate="enter"
        className="space-y-7"
      >
        <motion.div variants={STAGGER_ITEM}>
          <Badge className="inline-flex gap-1.5 px-3.5 py-1.5 text-xs font-medium tracking-wide">
            <AppIcons.graduation className="h-3.5 w-3.5 opacity-70" />
            For teachers and students
          </Badge>
        </motion.div>

        <div className="space-y-5">
          <motion.h1
            variants={FADE_UP_VARIANTS}
            className="editorial-title text-[3rem] leading-[1.15] text-ui-primary sm:text-[3.75rem]"
          >
            Structured AI learning, built on what you actually teach.
          </motion.h1>

          <motion.p
            variants={STAGGER_ITEM}
            className="max-w-[52ch] text-base text-ui-muted sm:text-lg"
          >
            Build from one editable blueprint, launch class-ready activities, and keep AI responses
            grounded in what your learners are actually studying.
          </motion.p>
        </div>

        <motion.div variants={STAGGER_ITEM} className="flex items-center gap-5">
          <Button asChild variant="warm" size="lg" className="ui-motion-lift">
            <Link href={primaryHref}>{primaryLabel}</Link>
          </Button>
          <Link
            href={secondaryHref}
            className="text-sm ui-motion-color text-ui-muted hover:text-accent"
          >
            {secondaryLabel} →
          </Link>
        </motion.div>
      </motion.div>

      {/* Zone B — Workflow steps */}
      <motion.div
        variants={STAGGER_CONTAINER}
        initial="initial"
        animate="enter"
        transition={{ delayChildren: 0.38, staggerChildren: 0.08 }}
        className="grid grid-cols-3 gap-6 border-t border-default pt-8"
      >
        {WORKFLOW_STEPS.map((step) => (
          <motion.div key={step.n} variants={STAGGER_ITEM} className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ui-subtle">
              {step.n}
            </p>
            <p className="text-sm font-semibold text-ui-primary">{step.label}</p>
            <p className="text-xs leading-relaxed text-ui-muted">{step.detail}</p>
          </motion.div>
        ))}
      </motion.div>

      {/* Zone C — Role diptych */}
      <motion.div
        variants={STAGGER_CONTAINER}
        initial="initial"
        animate="enter"
        transition={{ delayChildren: 0.52, staggerChildren: 0.07 }}
        className="grid gap-3 sm:grid-cols-2"
      >
        <motion.div variants={STAGGER_ITEM}>
          <Card className="hero-card rounded-2xl p-5">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft">
                <AppIcons.graduation className="h-3.5 w-3.5 text-accent" />
              </span>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ui-muted">
                Teacher
              </p>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-ui-subtle">
              Upload materials, review the AI blueprint, and publish class-ready activities with full
              editorial control.
            </p>
          </Card>
        </motion.div>

        <motion.div variants={STAGGER_ITEM}>
          <Card className="hero-card rounded-2xl p-5">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft">
                <AppIcons.user className="h-3.5 w-3.5 text-accent" />
              </span>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ui-muted">
                Student
              </p>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-ui-subtle">
              Access AI-powered chat, quizzes, and flashcards grounded in exactly what your class is
              studying.
            </p>
          </Card>
        </motion.div>
      </motion.div>
    </div>
  );
}
