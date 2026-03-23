"use client";

import { useMemo, useState } from "react";
import { motion } from "motion/react";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";
import { submitFlashcardsSession } from "@/app/classes/[classId]/flashcards/actions";
import { AppIcons } from "@/components/icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { STAGGER_CONTAINER, STAGGER_ITEM } from "@/lib/motion/presets";

type FlashcardView = {
  id: string;
  front: string;
  back: string;
};

type FlashcardsAssignmentPanelProps = {
  classId: string;
  assignmentId: string;
  cards: FlashcardView[];
  attemptLimit: number;
  attemptsUsed: number;
  bestScore: number | null;
  dueLocked: boolean;
  isSubmittedNotice: boolean;
  readOnly?: boolean;
};

type CardStatus = "known" | "review";

function FlashCard({
  card,
  index,
  status,
  onFlip,
  isFlipped,
  onMark,
  disabled,
}: {
  card: FlashcardView;
  index: number;
  status: CardStatus | undefined;
  onFlip: () => void;
  isFlipped: boolean;
  onMark: (id: string, status: CardStatus) => void;
  disabled: boolean;
}) {
  return (
    <motion.div variants={STAGGER_ITEM} className="space-y-3">
      {/* Card number + status indicator */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-ui-subtle">
          Card {index + 1}
        </span>
        {status === "known" && (
          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--status-success-fg)]">
            <AppIcons.success className="h-3 w-3" />
            Known
          </span>
        )}
        {status === "review" && (
          <span className="inline-flex items-center gap-1 rounded-full border border-[color-mix(in_srgb,var(--accent-primary)_30%,transparent)] bg-accent-soft px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
            <AppIcons.clock className="h-3 w-3" />
            Needs review
          </span>
        )}
      </div>

      {/* 3D flip card */}
      <div
        className="cursor-pointer"
        style={{ perspective: "1000px" }}
        onClick={onFlip}
        role="button"
        tabIndex={0}
        aria-label={isFlipped ? "Show front of card" : "Show back of card"}
        onKeyDown={(e) => e.key === "Enter" || e.key === " " ? onFlip() : undefined}
      >
        <motion.div
          animate={{ rotateY: isFlipped ? 180 : 0 }}
          transition={{ duration: 0.45, ease: [0.22, 0.61, 0.36, 1] }}
          style={{ transformStyle: "preserve-3d", position: "relative", minHeight: "120px" }}
        >
          {/* Front face */}
          <Card
            className={cn(
              "absolute inset-0 rounded-2xl transition-shadow duration-200",
              status === "known" && "border-[var(--status-success-border)]",
              status === "review" && "border-[color-mix(in_srgb,var(--accent-primary)_30%,transparent)]",
              !status && "border-default",
            )}
            style={{ backfaceVisibility: "hidden" }}
          >
            <CardContent className="flex h-full min-h-[120px] flex-col justify-between p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-ui-primary leading-relaxed">{card.front}</p>
                <span className="shrink-0 rounded-lg bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ui-subtle">
                  Front
                </span>
              </div>
              <p className="mt-2 text-xs text-ui-muted">Tap to reveal answer →</p>
            </CardContent>
          </Card>

          {/* Back face */}
          <Card
            className={cn(
              "absolute inset-0 rounded-2xl",
              status === "known" ? "border-[var(--status-success-border)] bg-[var(--status-success-bg)]" : "border-accent bg-accent-soft",
            )}
            style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
          >
            <CardContent className="flex h-full min-h-[120px] flex-col justify-between p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-accent leading-relaxed">{card.back}</p>
                <span className="shrink-0 rounded-lg bg-[var(--surface-card,white)]/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                  Back
                </span>
              </div>
              <p className="mt-2 text-xs text-accent/70">Tap to show question ←</p>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Mark buttons */}
      <div className="flex gap-2 pt-1">
        <Button
          type="button"
          size="sm"
          variant={status === "known" ? "secondary" : "outline"}
          disabled={disabled}
          onClick={() => onMark(card.id, "known")}
          className={cn(
            "flex-1 gap-1.5 transition-colors duration-150",
            status === "known" && "border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success-fg)] hover:bg-[var(--status-success-hover-bg)]",
          )}
        >
          <AppIcons.success className="h-3.5 w-3.5" />
          I know this
        </Button>
        <Button
          type="button"
          size="sm"
          variant={status === "review" ? "warm" : "outline"}
          disabled={disabled}
          onClick={() => onMark(card.id, "review")}
          className="flex-1 gap-1.5"
        >
          <AppIcons.clock className="h-3.5 w-3.5" />
          Needs review
        </Button>
      </div>
    </motion.div>
  );
}

export default function FlashcardsAssignmentPanel({
  classId,
  assignmentId,
  cards,
  attemptLimit,
  attemptsUsed,
  bestScore,
  dueLocked,
  isSubmittedNotice,
  readOnly = false,
}: FlashcardsAssignmentPanelProps) {
  const [cardStatus, setCardStatus] = useState<Record<string, CardStatus | undefined>>({});
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});

  const attemptsRemaining = Math.max(attemptLimit - attemptsUsed, 0);
  const allReviewed = cards.every((card) => Boolean(cardStatus[card.id]));
  const knownCount = cards.filter((card) => cardStatus[card.id] === "known").length;
  const reviewCount = cards.filter((card) => cardStatus[card.id] === "review").length;
  const completionPercent =
    cards.length > 0 ? Math.round(((knownCount + reviewCount) / cards.length) * 100) : 0;

  const sessionPayload = useMemo(
    () =>
      JSON.stringify({
        cardsReviewed: cards.length,
        knownCount,
        reviewCount,
      }),
    [cards.length, knownCount, reviewCount],
  );

  const canSubmit = !readOnly && !dueLocked && attemptsRemaining > 0 && allReviewed;
  const disabled = readOnly || dueLocked || attemptsRemaining === 0;

  return (
    <div className="space-y-6">
      {isSubmittedNotice ? (
        <Alert variant="success">
          <AlertTitle>Session submitted</AlertTitle>
          <AlertDescription>Session submitted successfully.</AlertDescription>
        </Alert>
      ) : null}
      {readOnly ? (
        <Alert variant="accent">
          <AlertTitle>Preview mode</AlertTitle>
          <AlertDescription>
            Flashcards preview is read-only. Exit preview mode to return to teacher tools.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="rounded-2xl">
        <CardContent className="space-y-3 p-4 text-sm text-ui-muted">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Attempts used: {attemptsUsed}</Badge>
            <Badge variant="outline">Remaining: {attemptsRemaining}</Badge>
            <Badge variant="outline">
              Best score: {bestScore === null ? "Not available yet" : `${bestScore}%`}
            </Badge>
          </div>
          <p className="text-xs text-ui-muted">
            {dueLocked ? "Due date passed. New attempts are locked." : "Due date is still open."}
          </p>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-ui-muted">
                {knownCount + reviewCount} of {cards.length} reviewed
              </span>
              <span className="font-medium text-ui-primary">{completionPercent}%</span>
            </div>
            <Progress value={completionPercent} className="h-1.5" />
          </div>
        </CardContent>
      </Card>

      <form action={submitFlashcardsSession.bind(null, classId, assignmentId)} className="space-y-4">
        <input type="hidden" name="session_payload" value={sessionPayload} readOnly />

        <motion.div
          className="space-y-6"
          initial="initial"
          animate="enter"
          variants={STAGGER_CONTAINER}
        >
          {cards.map((card, index) => (
            <FlashCard
              key={card.id}
              card={card}
              index={index}
              status={cardStatus[card.id]}
              isFlipped={Boolean(flipped[card.id])}
              onFlip={() =>
                setFlipped((current) => ({ ...current, [card.id]: !current[card.id] }))
              }
              onMark={(id, status) =>
                setCardStatus((current) => ({ ...current, [id]: status }))
              }
              disabled={disabled}
            />
          ))}
        </motion.div>

        <div className="pt-2">
          <PendingSubmitButton
            label="Submit Session"
            pendingLabel="Submitting..."
            disabled={!canSubmit}
            variant="warm"
            className="w-full sm:w-auto"
          />
          {!canSubmit && !readOnly && !dueLocked && attemptsRemaining > 0 && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-ui-muted">
              <AppIcons.help className="h-3.5 w-3.5" />
              Mark all cards as &ldquo;Known&rdquo; or &ldquo;Needs review&rdquo; before submitting.
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
