"use client";

import { useMemo, useState } from "react";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";
import {
  createFlashcardsAssignment,
  publishFlashcardsActivity,
  saveFlashcardsDraft,
} from "@/app/classes/[classId]/flashcards/actions";

type EditableCard = {
  front: string;
  back: string;
};

type FlashcardsDraftEditorProps = {
  classId: string;
  activityId: string;
  initialTitle: string;
  initialInstructions: string;
  initialCards: EditableCard[];
  isPublished: boolean;
};

function emptyCard(): EditableCard {
  return {
    front: "",
    back: "",
  };
}

export default function FlashcardsDraftEditor({
  classId,
  activityId,
  initialTitle,
  initialInstructions,
  initialCards,
  isPublished,
}: FlashcardsDraftEditorProps) {
  const [title, setTitle] = useState(initialTitle);
  const [instructions, setInstructions] = useState(initialInstructions);
  const [cards, setCards] = useState<EditableCard[]>(
    initialCards.length > 0 ? initialCards : [emptyCard()],
  );

  const payload = useMemo(
    () =>
      JSON.stringify({
        title,
        instructions,
        cards: cards.map((card) => ({
          front: card.front,
          back: card.back,
        })),
      }),
    [instructions, cards, title],
  );

  const updateCard = (index: number, next: Partial<EditableCard>) => {
    setCards((current) => current.map((card, position) => (position === index ? { ...card, ...next } : card)));
  };

  const addCard = () => {
    setCards((current) => [...current, emptyCard()]);
  };

  const removeCard = (index: number) => {
    setCards((current) => {
      if (current.length === 1) {
        return current;
      }
      return current.filter((_, position) => position !== index);
    });
  };

  return (
    <div className="space-y-8">
      <form action={saveFlashcardsDraft.bind(null, classId, activityId)} className="space-y-6">
        <input type="hidden" name="flashcards_payload" value={payload} readOnly />

        <div className="space-y-2">
          <label className="text-sm text-slate-300" htmlFor="flashcards-title">
            Flashcards Title
          </label>
          <input
            id="flashcards-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={isPublished}
            className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-70"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm text-slate-300" htmlFor="flashcards-instructions">
            Instructions
          </label>
          <textarea
            id="flashcards-instructions"
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            rows={3}
            disabled={isPublished}
            className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-70"
          />
        </div>

        <div className="space-y-4">
          {cards.map((card, cardIndex) => (
            <section
              key={`card-${cardIndex}`}
              className="rounded-2xl border border-white/10 bg-slate-950/40 p-4"
            >
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-200">Card {cardIndex + 1}</p>
                <button
                  type="button"
                  onClick={() => removeCard(cardIndex)}
                  disabled={isPublished || cards.length === 1}
                  className="rounded-lg border border-rose-500/40 px-3 py-1 text-xs text-rose-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Remove
                </button>
              </div>

              <div className="space-y-3">
                <div className="space-y-1">
                  <label
                    className="text-xs uppercase tracking-[0.2em] text-slate-500"
                    htmlFor={`flashcard-front-${cardIndex}`}
                  >
                    Front
                  </label>
                  <textarea
                    id={`flashcard-front-${cardIndex}`}
                    value={card.front}
                    onChange={(event) => updateCard(cardIndex, { front: event.target.value })}
                    rows={2}
                    disabled={isPublished}
                    className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-70"
                  />
                </div>

                <div className="space-y-1">
                  <label
                    className="text-xs uppercase tracking-[0.2em] text-slate-500"
                    htmlFor={`flashcard-back-${cardIndex}`}
                  >
                    Back
                  </label>
                  <textarea
                    id={`flashcard-back-${cardIndex}`}
                    value={card.back}
                    onChange={(event) => updateCard(cardIndex, { back: event.target.value })}
                    rows={3}
                    disabled={isPublished}
                    className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-70"
                  />
                </div>
              </div>
            </section>
          ))}
        </div>

        {!isPublished ? (
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={addCard}
              className="rounded-xl border border-white/20 px-4 py-2 text-sm text-slate-200 hover:border-white/40"
            >
              Add Card
            </button>
            <PendingSubmitButton
              label="Save Draft"
              pendingLabel="Saving..."
              className="rounded-xl bg-cyan-400/90 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-cyan-400/50"
            />
          </div>
        ) : null}
      </form>

      <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
        <h2 className="text-lg font-semibold">Publish and Assign</h2>
        <p className="mt-2 text-sm text-slate-400">
          Publish to lock card content, then create a whole-class assignment.
        </p>

        <div className="mt-4 flex flex-wrap gap-3">
          {!isPublished ? (
            <form action={publishFlashcardsActivity.bind(null, classId, activityId)}>
              <PendingSubmitButton
                label="Publish Flashcards"
                pendingLabel="Publishing..."
                className="rounded-xl bg-emerald-400/90 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-emerald-400/50"
              />
            </form>
          ) : (
            <span className="rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-200">
              Flashcards are published
            </span>
          )}

          <form
            action={createFlashcardsAssignment.bind(null, classId, activityId)}
            className="flex flex-wrap items-center gap-3"
          >
            <input
              name="due_at"
              type="datetime-local"
              className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
            />
            <PendingSubmitButton
              label="Create Assignment"
              pendingLabel="Creating..."
              disabled={!isPublished}
              className="rounded-xl bg-cyan-400/90 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-cyan-400/50"
            />
          </form>
        </div>
      </div>
    </div>
  );
}
