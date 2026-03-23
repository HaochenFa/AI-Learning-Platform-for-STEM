"use client";

import { useMemo, useState } from "react";
import { motion } from "motion/react";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";
import {
  createFlashcardsAssignment,
  publishFlashcardsActivity,
  saveFlashcardsDraft,
} from "@/app/classes/[classId]/flashcards/actions";
import { AppIcons } from "@/components/icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { STAGGER_CONTAINER, STAGGER_ITEM } from "@/lib/motion/presets";

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
  hasSubmissions?: boolean;
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
  hasSubmissions = false,
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
    setCards((current) =>
      current.map((card, position) => (position === index ? { ...card, ...next } : card)),
    );
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
      {isPublished && hasSubmissions ? (
        <Alert variant="warning">
          <AlertTitle>Flashcards have student submissions</AlertTitle>
          <AlertDescription>
            Editing cards may affect review accuracy for existing submissions. Changes are saved immediately.
          </AlertDescription>
        </Alert>
      ) : isPublished ? (
        <Alert variant="accent">
          <AlertTitle>Flashcards are published</AlertTitle>
          <AlertDescription>
            You can still edit cards before students submit.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="rounded-3xl">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2">
            <AppIcons.flashcards className="h-5 w-5" />
            {isPublished ? "Flashcard Content" : "Flashcards Draft"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <form action={saveFlashcardsDraft.bind(null, classId, activityId)} className="space-y-6">
            <input type="hidden" name="flashcards_payload" value={payload} readOnly />

            <div className="space-y-2">
              <Label htmlFor="flashcards-title">Flashcards Title</Label>
              <Input
                id="flashcards-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}

              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="flashcards-instructions">Instructions</Label>
              <Textarea
                id="flashcards-instructions"
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
                rows={3}

              />
            </div>

            <motion.div
              className="space-y-4"
              initial="initial"
              animate="enter"
              variants={STAGGER_CONTAINER}
            >
              {cards.map((card, cardIndex) => (
                <motion.section key={`card-${cardIndex}`} variants={STAGGER_ITEM}>
                  <Card className="rounded-2xl bg-[var(--surface-muted)]">
                    <CardContent className="p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-ui-subtle">Card {cardIndex + 1}</p>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => removeCard(cardIndex)}
                          disabled={cards.length === 1}
                        >
                          Remove
                        </Button>
                      </div>

                      <div className="space-y-3">
                        <div className="space-y-1">
                          <Label
                            className="text-xs uppercase tracking-[0.2em]"
                            htmlFor={`flashcard-front-${cardIndex}`}
                          >
                            Front
                          </Label>
                          <Textarea
                            id={`flashcard-front-${cardIndex}`}
                            value={card.front}
                            onChange={(event) => updateCard(cardIndex, { front: event.target.value })}
                            rows={2}
            
                          />
                        </div>

                        <div className="space-y-1">
                          <Label
                            className="text-xs uppercase tracking-[0.2em]"
                            htmlFor={`flashcard-back-${cardIndex}`}
                          >
                            Back
                          </Label>
                          <Textarea
                            id={`flashcard-back-${cardIndex}`}
                            value={card.back}
                            onChange={(event) => updateCard(cardIndex, { back: event.target.value })}
                            rows={3}
            
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.section>
              ))}
            </motion.div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" onClick={addCard}>
                <AppIcons.add className="h-4 w-4" />
                Add Card
              </Button>
              <PendingSubmitButton
                label={isPublished ? "Save Changes" : "Save Draft"}
                pendingLabel={isPublished ? "Saving Changes..." : "Saving..."}
                variant="warm"
              />
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle>Publish and Assign</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-ui-muted">
            Publish to lock card content, then create a whole-class assignment.
          </p>

          <div className="mt-4 flex flex-wrap gap-3">
            {!isPublished ? (
              <form action={publishFlashcardsActivity.bind(null, classId, activityId)}>
                <PendingSubmitButton
                  label="Publish Flashcards"
                  pendingLabel="Publishing..."
                  variant="warm"
                />
              </form>
            ) : (
              <Badge variant="success">Flashcards are published</Badge>
            )}

            <form
              action={createFlashcardsAssignment.bind(null, classId, activityId)}
              className="flex flex-wrap items-center gap-3"
            >
              <Input name="due_at" type="datetime-local" />
              <PendingSubmitButton
                label="Create Assignment"
                pendingLabel="Creating..."
                disabled={!isPublished}
                variant="warm"
              />
            </form>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
