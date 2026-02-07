import type { QuizAnswerInput } from "@/lib/activities/types";
import type { QuizGenerationPayload, QuizQuestion } from "@/lib/quiz/types";

export const DEFAULT_QUIZ_QUESTION_COUNT = 10;
export const MIN_QUIZ_QUESTIONS = 1;
export const MAX_QUIZ_QUESTIONS = 20;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeChoice(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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

function isLowQualityDistractor(value: string) {
  const normalized = normalizeText(value);
  return (
    normalized === "all of the above" ||
    normalized === "none of the above" ||
    normalized === "all of these" ||
    normalized === "none of these"
  );
}

export function parseQuestionCount(raw: FormDataEntryValue | null) {
  if (!raw || typeof raw !== "string" || !raw.trim()) {
    return DEFAULT_QUIZ_QUESTION_COUNT;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new Error("Question count must be an integer.");
  }

  if (parsed < MIN_QUIZ_QUESTIONS || parsed > MAX_QUIZ_QUESTIONS) {
    throw new Error(
      `Question count must be between ${MIN_QUIZ_QUESTIONS} and ${MAX_QUIZ_QUESTIONS}.`,
    );
  }

  return parsed;
}

export function parseDueAt(raw: FormDataEntryValue | null) {
  if (!raw || typeof raw !== "string" || !raw.trim()) {
    return null;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Due date is invalid.");
  }
  return date.toISOString();
}

export function parseOptionalScore(raw: FormDataEntryValue | null) {
  if (!raw || typeof raw !== "string" || !raw.trim()) {
    return null;
  }
  const value = Number(raw);
  if (Number.isNaN(value)) {
    throw new Error("Score must be a number.");
  }
  if (value < 0 || value > 100) {
    throw new Error("Score must be between 0 and 100.");
  }
  return value;
}

export function parseHighlights(raw: FormDataEntryValue | null) {
  if (!raw || typeof raw !== "string") {
    return [];
  }
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 10);
}

export function validateQuizGenerationPayload(
  payload: unknown,
): { ok: true; value: QuizGenerationPayload } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!payload || typeof payload !== "object") {
    return { ok: false, errors: ["Payload must be an object."] };
  }

  const data = payload as QuizGenerationPayload;
  const normalizedQuestions: QuizGenerationPayload["questions"] = [];
  const stemSet = new Set<string>();
  if (!Array.isArray(data.questions) || data.questions.length < MIN_QUIZ_QUESTIONS) {
    errors.push("questions must be a non-empty array.");
  } else if (data.questions.length > MAX_QUIZ_QUESTIONS) {
    errors.push(`questions cannot exceed ${MAX_QUIZ_QUESTIONS}.`);
  } else {
    data.questions.forEach((question, index) => {
      const errorsBeforeQuestion = errors.length;
      if (!isNonEmptyString(question.question)) {
        errors.push(`questions[${index}].question is required.`);
        return;
      }
      const normalizedStem = normalizeText(question.question);
      if (stemSet.has(normalizedStem)) {
        errors.push(`questions[${index}].question duplicates an earlier stem.`);
      }
      stemSet.add(normalizedStem);

      let normalizedChoices: string[] = [];
      if (!Array.isArray(question.choices) || question.choices.length !== 4) {
        errors.push(`questions[${index}].choices must contain exactly 4 options.`);
      } else {
        normalizedChoices = question.choices.map((choice) => normalizeChoice(choice));
        if (normalizedChoices.some((choice) => !choice)) {
          errors.push(`questions[${index}].choices cannot be empty.`);
        }
        if (new Set(normalizedChoices.map((choice) => normalizeText(choice))).size !== normalizedChoices.length) {
          errors.push(`questions[${index}].choices must be unique.`);
        }
        if (normalizedChoices.some((choice) => isLowQualityDistractor(choice))) {
          errors.push(`questions[${index}].choices include low-quality distractors.`);
        }
      }
      if (!isNonEmptyString(question.answer)) {
        errors.push(`questions[${index}].answer is required.`);
      } else {
        const answer = question.answer.trim();
        const matches = normalizedChoices.filter((choice) => choice === answer).length;
        if (matches !== 1) {
          errors.push(`questions[${index}].answer must exactly match one choice.`);
        }
      }
      if (!isNonEmptyString(question.explanation)) {
        errors.push(`questions[${index}].explanation is required.`);
      } else if (wordCount(question.explanation) < 6) {
        errors.push(`questions[${index}].explanation must be at least 6 words.`);
      }

      if (errors.length === errorsBeforeQuestion) {
        normalizedQuestions.push({
          question: question.question.trim(),
          choices: normalizedChoices,
          answer: question.answer.trim(),
          explanation: question.explanation.trim(),
        });
      }
    });
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { questions: normalizedQuestions } };
}

export function parseQuizDraftPayload(raw: FormDataEntryValue | null) {
  if (!raw || typeof raw !== "string") {
    throw new Error("Quiz payload is required.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Quiz payload must be valid JSON.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Quiz payload is invalid.");
  }

  const title = (parsed as { title?: unknown }).title;
  const instructions = (parsed as { instructions?: unknown }).instructions;
  const questions = (parsed as { questions?: unknown }).questions;

  if (!isNonEmptyString(title)) {
    throw new Error("Quiz title is required.");
  }
  if (!isNonEmptyString(instructions)) {
    throw new Error("Quiz instructions are required.");
  }
  if (!Array.isArray(questions) || questions.length < MIN_QUIZ_QUESTIONS) {
    throw new Error("At least one quiz question is required.");
  }

  const normalizedQuestions: Omit<QuizQuestion, "id">[] = questions.map((question, index) => {
    if (!question || typeof question !== "object") {
      throw new Error(`Question ${index + 1} is invalid.`);
    }

    const prompt = (question as { question?: unknown }).question;
    const choices = (question as { choices?: unknown }).choices;
    const answer = (question as { answer?: unknown }).answer;
    const explanation = (question as { explanation?: unknown }).explanation;

    if (!isNonEmptyString(prompt)) {
      throw new Error(`Question ${index + 1} prompt is required.`);
    }

    if (!Array.isArray(choices) || choices.length !== 4) {
      throw new Error(`Question ${index + 1} must include exactly 4 choices.`);
    }
    const normalizedChoices = choices.map((choice) => normalizeChoice(choice)).filter(Boolean);
    if (normalizedChoices.length !== 4 || new Set(normalizedChoices).size !== 4) {
      throw new Error(`Question ${index + 1} choices must be non-empty and unique.`);
    }

    if (!isNonEmptyString(answer) || !normalizedChoices.includes(answer.trim())) {
      throw new Error(`Question ${index + 1} answer must match one choice.`);
    }

    if (!isNonEmptyString(explanation)) {
      throw new Error(`Question ${index + 1} explanation is required.`);
    }

    return {
      question: prompt.trim(),
      choices: normalizedChoices,
      answer: answer.trim(),
      explanation: explanation.trim(),
      orderIndex: index,
    };
  });

  return {
    title: title.trim(),
    instructions: instructions.trim(),
    questions: normalizedQuestions,
  };
}

export function parseQuizAnswers(raw: FormDataEntryValue | null): QuizAnswerInput[] {
  if (!raw || typeof raw !== "string") {
    throw new Error("Quiz answers are required.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Quiz answers must be valid JSON.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Quiz answers must be an array.");
  }

  const answers = parsed.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`Answer ${index + 1} is invalid.`);
    }
    const questionId = (item as { questionId?: unknown }).questionId;
    const selectedChoice = (item as { selectedChoice?: unknown }).selectedChoice;
    if (!isNonEmptyString(questionId) || !isNonEmptyString(selectedChoice)) {
      throw new Error(`Answer ${index + 1} is incomplete.`);
    }
    return {
      questionId: questionId.trim(),
      selectedChoice: selectedChoice.trim(),
    };
  });

  return answers;
}
