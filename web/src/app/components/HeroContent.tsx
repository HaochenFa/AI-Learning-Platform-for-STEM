"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { AppIcons } from "@/components/icons";
import TransientFeedbackAlert from "@/components/ui/transient-feedback-alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { type GuestLandingFeedback } from "@/lib/guest/errors";
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
  guestHref?: string;
  guestLabel?: string;
  guestFeedback?: GuestLandingFeedback | null;
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

const ROLE_CARDS = [
  {
    key: "teacher",
    label: "Teacher",
    icon: AppIcons.graduation,
    description:
      "Upload materials, review the AI blueprint, and publish class-ready activities with full editorial control.",
  },
  {
    key: "student",
    label: "Student",
    icon: AppIcons.user,
    description:
      "Access AI-powered chat, quizzes, and flashcards grounded in exactly what your class is studying.",
  },
];

const FEATURE_ITEMS = [
  {
    key: "chat",
    icon: AppIcons.chat,
    label: "AI Chat",
    detail: "Context-aware conversations grounded in your class materials.",
  },
  {
    key: "blueprint",
    icon: AppIcons.classes,
    label: "Blueprint Studio",
    detail: "Edit the AI-generated curriculum structure before publishing.",
  },
  {
    key: "quiz",
    icon: AppIcons.quiz,
    label: "Quizzes",
    detail: "Auto-generated assessments aligned to your learning objectives.",
  },
  {
    key: "flashcards",
    icon: AppIcons.flashcards,
    label: "Flashcards",
    detail: "Spaced-repetition sessions drawn from the published blueprint.",
  },
];

export default function HeroContent({
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
  guestHref,
  guestLabel,
  guestFeedback,
}: HeroContentProps) {
  const primaryScroll = !primaryHref.startsWith("/?auth=");
  const secondaryScroll = !secondaryHref.startsWith("/?auth=");

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

        {guestFeedback ? (
          <motion.div variants={STAGGER_ITEM} className="max-w-[40rem]">
            <TransientFeedbackAlert
              variant={guestFeedback.variant}
              title={guestFeedback.title}
              message={guestFeedback.message}
              className="border shadow-sm"
              dismissOnRetry={false}
            />
          </motion.div>
        ) : null}

        <motion.div variants={STAGGER_ITEM} className="flex flex-wrap items-center gap-5">
          <Button asChild variant="warm" size="lg" className="ui-motion-lift">
            <Link href={primaryHref} scroll={primaryScroll}>
              {primaryLabel}
            </Link>
          </Button>
          <Link
            href={secondaryHref}
            scroll={secondaryScroll}
            className="text-sm ui-motion-color text-ui-muted hover:text-accent"
          >
            {secondaryLabel} →
          </Link>
          {guestHref && guestLabel ? (
            <Link href={guestHref} className="text-sm ui-motion-color text-ui-subtle hover:text-accent">
              {guestLabel} →
            </Link>
          ) : null}
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
        {ROLE_CARDS.map(({ key, icon: Icon, label, description }) => (
          <motion.div key={key} variants={STAGGER_ITEM}>
            <Card className="hero-card rounded-2xl p-5">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft">
                  <Icon className="h-3.5 w-3.5 text-accent" />
                </span>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ui-muted">
                  {label}
                </p>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-ui-subtle">{description}</p>
            </Card>
          </motion.div>
        ))}
      </motion.div>

      {/* Zone D — Feature grid */}
      <motion.div
        variants={STAGGER_CONTAINER}
        initial="initial"
        animate="enter"
        transition={{ delayChildren: 0.66, staggerChildren: 0.07 }}
        className="border-t border-default pt-8"
      >
        <motion.p
          variants={STAGGER_ITEM}
          className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-ui-subtle"
        >
          Platform features
        </motion.p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {FEATURE_ITEMS.map(({ key, icon: Icon, label, detail }) => (
            <motion.div
              key={key}
              variants={STAGGER_ITEM}
              className="group rounded-2xl border border-default bg-[var(--surface-card,white)] p-4 transition-colors duration-200 hover:border-accent hover:bg-accent-soft"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--surface-muted)] text-ui-muted transition-colors duration-200 group-hover:bg-white/70 group-hover:text-accent">
                <Icon className="h-4 w-4" />
              </div>
              <p className="mt-3 text-xs font-semibold text-ui-primary">{label}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-ui-muted">{detail}</p>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
