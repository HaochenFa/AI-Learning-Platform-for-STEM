import type { FlashcardsGenerationPayload } from "@/lib/flashcards/types";

export const DEFAULT_FLASHCARD_COUNT = 12;
export const MIN_FLASHCARDS = 1;
export const MAX_FLASHCARDS = 30;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(value: string) {
  if (!value.trim()) {
    return 0;
  }
  return value.trim().split(/\s+/).length;
}

export function parseCardCount(raw: FormDataEntryValue | null) {
  if (!raw || typeof raw !== "string" || !raw.trim()) {
    return DEFAULT_FLASHCARD_COUNT;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new Error("Card count must be an integer.");
  }
  if (parsed < MIN_FLASHCARDS || parsed > MAX_FLASHCARDS) {
    throw new Error(`Card count must be between ${MIN_FLASHCARDS} and ${MAX_FLASHCARDS}.`);
  }
  return parsed;
}

export function validateFlashcardsGenerationPayload(
  payload: unknown
): { ok: true; value: FlashcardsGenerationPayload } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!payload || typeof payload !== "object") {
    return { ok: false, errors: ["Payload must be an object."] };
  }

  const data = payload as FlashcardsGenerationPayload;
  const normalizedCards: FlashcardsGenerationPayload["cards"] = [];
  const frontSet = new Set<string>();
  if (!Array.isArray(data.cards) || data.cards.length < MIN_FLASHCARDS) {
    errors.push("cards must be a non-empty array.");
  } else if (data.cards.length > MAX_FLASHCARDS) {
    errors.push(`cards cannot exceed ${MAX_FLASHCARDS}.`);
  } else {
    data.cards.forEach((card, index) => {
      const errorsBeforeCard = errors.length;
      if (!isNonEmptyString(card.front)) {
        errors.push(`cards[${index}].front is required.`);
        return;
      }
      const normalizedFront = normalizeText(card.front);
      if (frontSet.has(normalizedFront)) {
        errors.push(`cards[${index}].front duplicates an earlier front.`);
      }
      frontSet.add(normalizedFront);

      if (!isNonEmptyString(card.back)) {
        errors.push(`cards[${index}].back is required.`);
      } else if (wordCount(card.back) < 3) {
        errors.push(`cards[${index}].back must be at least 3 words.`);
      }

      if (errors.length === errorsBeforeCard) {
        normalizedCards.push({
          front: card.front.trim(),
          back: card.back.trim(),
        });
      }
    });
  }

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: { cards: normalizedCards } };
}

export function parseFlashcardsDraftPayload(raw: FormDataEntryValue | null) {
  if (!raw || typeof raw !== "string") {
    throw new Error("Flashcards payload is required.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Flashcards payload must be valid JSON.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Flashcards payload is invalid.");
  }

  const title = (parsed as { title?: unknown }).title;
  const instructions = (parsed as { instructions?: unknown }).instructions;
  const cards = (parsed as { cards?: unknown }).cards;

  if (!isNonEmptyString(title)) {
    throw new Error("Flashcards title is required.");
  }
  if (!isNonEmptyString(instructions)) {
    throw new Error("Flashcards instructions are required.");
  }
  if (!Array.isArray(cards) || cards.length < MIN_FLASHCARDS) {
    throw new Error("At least one flashcard is required.");
  }
  if (cards.length > MAX_FLASHCARDS) {
    throw new Error(`Flashcards cannot exceed ${MAX_FLASHCARDS} cards.`);
  }

  const normalizedCards = cards.map((card, index) => {
    if (!card || typeof card !== "object") {
      throw new Error(`Card ${index + 1} is invalid.`);
    }

    const front = (card as { front?: unknown }).front;
    const back = (card as { back?: unknown }).back;
    if (!isNonEmptyString(front)) {
      throw new Error(`Card ${index + 1} front is required.`);
    }
    if (!isNonEmptyString(back)) {
      throw new Error(`Card ${index + 1} back is required.`);
    }
    return {
      front: front.trim(),
      back: back.trim(),
      orderIndex: index,
    };
  });

  return {
    title: title.trim(),
    instructions: instructions.trim(),
    cards: normalizedCards,
  };
}

export function parseFlashcardsSessionPayload(raw: FormDataEntryValue | null) {
  if (!raw || typeof raw !== "string") {
    throw new Error("Flashcards session payload is required.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Flashcards session payload must be valid JSON.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Flashcards session payload is invalid.");
  }

  const cardsReviewed = (parsed as { cardsReviewed?: unknown }).cardsReviewed;
  const knownCount = (parsed as { knownCount?: unknown }).knownCount;
  const reviewCount = (parsed as { reviewCount?: unknown }).reviewCount;

  if (typeof cardsReviewed !== "number" || !Number.isFinite(cardsReviewed) || cardsReviewed <= 0) {
    throw new Error("Cards reviewed count is required.");
  }
  if (typeof knownCount !== "number" || !Number.isFinite(knownCount) || knownCount < 0) {
    throw new Error("Known count is required.");
  }
  if (typeof reviewCount !== "number" || !Number.isFinite(reviewCount) || reviewCount < 0) {
    throw new Error("Review count is required.");
  }
  if (knownCount + reviewCount !== cardsReviewed) {
    throw new Error("Flashcards totals do not match the cards reviewed.");
  }

  return {
    cardsReviewed,
    knownCount,
    reviewCount,
  };
}
