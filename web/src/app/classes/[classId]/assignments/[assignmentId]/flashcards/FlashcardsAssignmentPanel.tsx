"use client";

import { useMemo, useState } from "react";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";
import { submitFlashcardsSession } from "@/app/classes/[classId]/flashcards/actions";

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
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          Session submitted successfully.
        </div>
      ) : null}

      <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 text-sm text-slate-300">
        <p>Attempts used: {attemptsUsed}</p>
        <p>Attempts remaining: {attemptsRemaining}</p>
        <p>{dueLocked ? "Due date passed. New attempts are locked." : "Due date is still open."}</p>
        <p>Best score: {bestScore === null ? "Not available yet" : `${bestScore}%`}</p>
        <p>
          Progress: {knownCount} known, {reviewCount} to review
        </p>
      </div>

      <form action={submitFlashcardsSession.bind(null, classId, assignmentId)} className="space-y-4">
        <input type="hidden" name="session_payload" value={sessionPayload} readOnly />

        {cards.map((card, index) => (
          <section
            key={card.id}
            className="rounded-2xl border border-white/10 bg-slate-900/60 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-slate-100">Card {index + 1}</p>
              <button
                type="button"
                onClick={() =>
                  setFlipped((current) => ({ ...current, [card.id]: !current[card.id] }))
                }
                className="rounded-lg border border-white/10 px-3 py-1 text-xs text-slate-200 hover:border-white/30 hover:bg-white/5"
              >
                {flipped[card.id] ? "Show front" : "Show back"}
              </button>
            </div>

            <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/40 px-3 py-3 text-sm text-slate-100">
              {flipped[card.id] ? card.back : card.front}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={dueLocked || attemptsRemaining === 0}
                onClick={() =>
                  setCardStatus((current) => ({ ...current, [card.id]: "known" }))
                }
                className={`rounded-xl border px-3 py-1.5 text-xs font-semibold ${
                  cardStatus[card.id] === "known"
                    ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-200"
                    : "border-white/10 text-slate-200 hover:border-white/30 hover:bg-white/5"
                }`}
              >
                I know this
              </button>
              <button
                type="button"
                disabled={dueLocked || attemptsRemaining === 0}
                onClick={() =>
                  setCardStatus((current) => ({ ...current, [card.id]: "review" }))
                }
                className={`rounded-xl border px-3 py-1.5 text-xs font-semibold ${
                  cardStatus[card.id] === "review"
                    ? "border-cyan-400/40 bg-cyan-400/15 text-cyan-200"
                    : "border-white/10 text-slate-200 hover:border-white/30 hover:bg-white/5"
                }`}
              >
                Needs review
              </button>
            </div>
          </section>
        ))}

        <PendingSubmitButton
          label="Submit Session"
          pendingLabel="Submitting..."
          disabled={!canSubmit}
          className="rounded-xl bg-cyan-400/90 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-cyan-400/50"
        />
      </form>
    </div>
  );
}
