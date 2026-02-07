export type Flashcard = {
  id: string;
  front: string;
  back: string;
  orderIndex: number;
};

export type FlashcardsGenerationCard = {
  front: string;
  back: string;
};

export type FlashcardsGenerationPayload = {
  title?: string;
  instructions?: string;
  cards: FlashcardsGenerationCard[];
};

export type FlashcardsActivityConfig = {
  mode: "assignment";
  cardCount: number;
  attemptLimit: number;
  instructions: string;
};
