"use client";

import { useMemo, useState } from "react";
import { motion } from "motion/react";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";
import { submitFlashcardsSession } from "@/app/classes/[classId]/flashcards/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
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
};

type CardStatus = "known" | "review";

export default function FlashcardsAssignmentPanel({
  classId,
  assignmentId,
  cards,
  attemptLimit,
  attemptsUsed,
  bestScore,
  dueLocked,
  isSubmittedNotice,
}: FlashcardsAssignmentPanelProps) {
  const [cardStatus, setCardStatus] = useState<Record<string, CardStatus | undefined>>({});
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});

  const attemptsRemaining = Math.max(attemptLimit - attemptsUsed, 0);
  const allReviewed = cards.every((card) => Boolean(cardStatus[card.id]));
  const knownCount = cards.filter((card) => cardStatus[card.id] === "known").length;
  const reviewCount = cards.filter((card) => cardStatus[card.id] === "review").length;
  const completionPercent = cards.length > 0 ? Math.round((knownCount + reviewCount) / cards.length * 100) : 0;

  const sessionPayload = useMemo(
    () =>
      JSON.stringify({
        cardsReviewed: cards.length,
        knownCount,
        reviewCount,
      }),
    [cards.length, knownCount, reviewCount],
  );

  const canSubmit = !dueLocked && attemptsRemaining > 0 && allReviewed;

  return (
    <div className="space-y-6">
      {isSubmittedNotice ? (
        <Alert variant="success">
          <AlertTitle>Session submitted</AlertTitle>
          <AlertDescription>Session submitted successfully.</AlertDescription>
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
          <div className="space-y-2">
            <p className="text-xs text-ui-muted">
              Progress: {knownCount} known, {reviewCount} to review
            </p>
            <Progress value={completionPercent} />
          </div>
        </CardContent>
      </Card>

      <form action={submitFlashcardsSession.bind(null, classId, assignmentId)} className="space-y-4">
        <input type="hidden" name="session_payload" value={sessionPayload} readOnly />

        <motion.div
          className="space-y-4"
          initial="initial"
          animate="enter"
          variants={STAGGER_CONTAINER}
        >
          {cards.map((card, index) => (
            <motion.section key={card.id} variants={STAGGER_ITEM}>
              <Card className="rounded-2xl">
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-ui-primary">Card {index + 1}</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setFlipped((current) => ({ ...current, [card.id]: !current[card.id] }))
                      }
                    >
                      {flipped[card.id] ? "Show front" : "Show back"}
                    </Button>
                  </div>

                  <div className="mt-3 rounded-xl border border-default bg-[var(--surface-muted)] px-3 py-3 text-sm text-ui-primary">
                    {flipped[card.id] ? card.back : card.front}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={cardStatus[card.id] === "known" ? "secondary" : "outline"}
                      disabled={dueLocked || attemptsRemaining === 0}
                      onClick={() =>
                        setCardStatus((current) => ({ ...current, [card.id]: "known" }))
                      }
                      className={cardStatus[card.id] === "known" ? "text-emerald-700" : undefined}
                    >
                      I know this
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={cardStatus[card.id] === "review" ? "warm" : "outline"}
                      disabled={dueLocked || attemptsRemaining === 0}
                      onClick={() =>
                        setCardStatus((current) => ({ ...current, [card.id]: "review" }))
                      }
                    >
                      Needs review
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.section>
          ))}
        </motion.div>

        <PendingSubmitButton
          label="Submit Session"
          pendingLabel="Submitting..."
          disabled={!canSubmit}
          variant="warm"
          className="w-full sm:w-auto"
        />
      </form>
    </div>
  );
}
