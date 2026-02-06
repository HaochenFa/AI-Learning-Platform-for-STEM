"use client";

import { useMemo, useState } from "react";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";
import {
  createQuizAssignment,
  publishQuizActivity,
  saveQuizDraft,
} from "@/app/classes/[classId]/quiz/actions";

type EditableQuestion = {
  question: string;
  choices: [string, string, string, string];
  answer: string;
  explanation: string;
};

type QuizDraftEditorProps = {
  classId: string;
  activityId: string;
  initialTitle: string;
  initialInstructions: string;
  initialQuestions: EditableQuestion[];
  isPublished: boolean;
};

function emptyQuestion(): EditableQuestion {
  return {
    question: "",
    choices: ["", "", "", ""],
    answer: "",
    explanation: "",
  };
}

export default function QuizDraftEditor({
  classId,
  activityId,
  initialTitle,
  initialInstructions,
  initialQuestions,
  isPublished,
}: QuizDraftEditorProps) {
  const [title, setTitle] = useState(initialTitle);
  const [instructions, setInstructions] = useState(initialInstructions);
  const [questions, setQuestions] = useState<EditableQuestion[]>(
    initialQuestions.length > 0 ? initialQuestions : [emptyQuestion()],
  );

  const payload = useMemo(
    () =>
      JSON.stringify({
        title,
        instructions,
        questions: questions.map((question) => ({
          question: question.question,
          choices: question.choices,
          answer: question.answer,
          explanation: question.explanation,
        })),
      }),
    [instructions, questions, title],
  );

  const updateQuestion = (index: number, next: Partial<EditableQuestion>) => {
    setQuestions((current) =>
      current.map((question, position) => (position === index ? { ...question, ...next } : question)),
    );
  };

  const updateChoice = (questionIndex: number, choiceIndex: number, value: string) => {
    setQuestions((current) =>
      current.map((question, index) => {
        if (index !== questionIndex) {
          return question;
        }
        const nextChoices = [...question.choices] as [string, string, string, string];
        nextChoices[choiceIndex] = value;
        const nextAnswer =
          question.answer && question.choices[choiceIndex] === question.answer ? value : question.answer;
        return {
          ...question,
          choices: nextChoices,
          answer: nextAnswer,
        };
      }),
    );
  };

  const addQuestion = () => {
    setQuestions((current) => [...current, emptyQuestion()]);
  };

  const removeQuestion = (index: number) => {
    setQuestions((current) => {
      if (current.length === 1) {
        return current;
      }
      return current.filter((_, position) => position !== index);
    });
  };

  return (
    <div className="space-y-8">
      <form action={saveQuizDraft.bind(null, classId, activityId)} className="space-y-6">
        <input type="hidden" name="quiz_payload" value={payload} readOnly />

        <div className="space-y-2">
          <label className="text-sm text-slate-300" htmlFor="quiz-title">
            Quiz Title
          </label>
          <input
            id="quiz-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={isPublished}
            className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-70"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm text-slate-300" htmlFor="quiz-instructions">
            Instructions
          </label>
          <textarea
            id="quiz-instructions"
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            rows={3}
            disabled={isPublished}
            className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-70"
          />
        </div>

        <div className="space-y-4">
          {questions.map((question, questionIndex) => (
            <section
              key={`question-${questionIndex}`}
              className="rounded-2xl border border-white/10 bg-slate-950/40 p-4"
            >
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-200">Question {questionIndex + 1}</p>
                <button
                  type="button"
                  onClick={() => removeQuestion(questionIndex)}
                  disabled={isPublished || questions.length === 1}
                  className="rounded-lg border border-rose-500/40 px-3 py-1 text-xs text-rose-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Remove
                </button>
              </div>

              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-slate-500">Prompt</label>
                <textarea
                  value={question.question}
                  onChange={(event) =>
                    updateQuestion(questionIndex, {
                      question: event.target.value,
                    })
                  }
                  rows={2}
                  disabled={isPublished}
                  className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-70"
                />
              </div>

              <div className="mt-4 space-y-3">
                {question.choices.map((choice, choiceIndex) => (
                  <div key={`choice-${questionIndex}-${choiceIndex}`} className="space-y-1">
                    <label className="text-xs uppercase tracking-[0.2em] text-slate-500">
                      Choice {choiceIndex + 1}
                    </label>
                    <input
                      value={choice}
                      onChange={(event) =>
                        updateChoice(questionIndex, choiceIndex, event.target.value)
                      }
                      disabled={isPublished}
                      className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-70"
                    />
                  </div>
                ))}
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs uppercase tracking-[0.2em] text-slate-500">Correct Answer</label>
                  <select
                    value={question.answer}
                    onChange={(event) =>
                      updateQuestion(questionIndex, {
                        answer: event.target.value,
                      })
                    }
                    disabled={isPublished}
                    className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    <option value="">Select a correct answer</option>
                    {question.choices.map((choice, choiceIndex) => (
                      <option key={`answer-option-${questionIndex}-${choiceIndex}`} value={choice}>
                        {choice || `Choice ${choiceIndex + 1}`}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs uppercase tracking-[0.2em] text-slate-500">Explanation</label>
                  <textarea
                    value={question.explanation}
                    onChange={(event) =>
                      updateQuestion(questionIndex, {
                        explanation: event.target.value,
                      })
                    }
                    rows={2}
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
              onClick={addQuestion}
              className="rounded-xl border border-white/20 px-4 py-2 text-sm text-slate-200 hover:border-white/40"
            >
              Add Question
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
          Publish to lock question content, then create a whole-class assignment.
        </p>

        <div className="mt-4 flex flex-wrap gap-3">
          {!isPublished ? (
            <form action={publishQuizActivity.bind(null, classId, activityId)}>
              <PendingSubmitButton
                label="Publish Quiz"
                pendingLabel="Publishing..."
                className="rounded-xl bg-emerald-400/90 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-emerald-400/50"
              />
            </form>
          ) : (
            <span className="rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-200">
              Quiz is published
            </span>
          )}

          <form action={createQuizAssignment.bind(null, classId, activityId)} className="flex flex-wrap items-center gap-3">
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
