"use client";

import { useMemo, useState } from "react";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";
import { submitQuizAttempt } from "@/app/classes/[classId]/quiz/actions";

type QuizQuestionView = {
  id: string;
  question: string;
  choices: string[];
  answer?: string;
  explanation?: string;
};

type QuizAssignmentPanelProps = {
  classId: string;
  assignmentId: string;
  questions: QuizQuestionView[];
  latestAnswers: Record<string, string>;
  attemptLimit: number;
  attemptsUsed: number;
  bestScore: number | null;
  dueLocked: boolean;
  revealAnswers: boolean;
  isSubmittedNotice: boolean;
};

export default function QuizAssignmentPanel({
  classId,
  assignmentId,
  questions,
  latestAnswers,
  attemptLimit,
  attemptsUsed,
  bestScore,
  dueLocked,
  revealAnswers,
  isSubmittedNotice,
}: QuizAssignmentPanelProps) {
  const [answers, setAnswers] = useState<Record<string, string>>(latestAnswers);

  const attemptsRemaining = Math.max(attemptLimit - attemptsUsed, 0);
  const serializedAnswers = useMemo(
    () =>
      JSON.stringify(
        questions
          .filter((question) => answers[question.id])
          .map((question) => ({
            questionId: question.id,
            selectedChoice: answers[question.id],
          })),
      ),
    [answers, questions],
  );

  const allAnswered = questions.every((question) => Boolean(answers[question.id]));
  const canSubmit = !dueLocked && attemptsRemaining > 0 && allAnswered;

  return (
    <div className="space-y-6">
      {isSubmittedNotice ? (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          Attempt submitted successfully.
        </div>
      ) : null}

      <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 text-sm text-slate-300">
        <p>Attempts used: {attemptsUsed}</p>
        <p>Attempts remaining: {attemptsRemaining}</p>
        <p>{dueLocked ? "Due date passed. New attempts are locked." : "Due date is still open."}</p>
        <p>Best score: {bestScore === null ? "Not available yet" : `${bestScore}%`}</p>
      </div>

      <form action={submitQuizAttempt.bind(null, classId, assignmentId)} className="space-y-4">
        <input type="hidden" name="answers" value={serializedAnswers} readOnly />

        {questions.map((question, questionIndex) => (
          <section
            key={question.id}
            className="rounded-2xl border border-white/10 bg-slate-900/60 p-4"
          >
            <p className="text-sm font-semibold text-slate-100">
              {questionIndex + 1}. {question.question}
            </p>

            <div className="mt-3 space-y-2">
              {question.choices.map((choice) => (
                <label
                  key={`${question.id}-${choice}`}
                  className="flex cursor-pointer items-start gap-2 rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-200"
                >
                  <input
                    type="radio"
                    name={`question-${question.id}`}
                    checked={answers[question.id] === choice}
                    onChange={() =>
                      setAnswers((current) => ({
                        ...current,
                        [question.id]: choice,
                      }))
                    }
                    disabled={dueLocked || attemptsRemaining === 0}
                  />
                  <span>{choice}</span>
                </label>
              ))}
            </div>

            {revealAnswers ? (
              <div className="mt-3 rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-sm text-cyan-100">
                <p className="font-medium">Correct answer: {question.answer ?? "Unavailable"}</p>
                {question.explanation ? (
                  <p className="mt-1 text-cyan-50/90">{question.explanation}</p>
                ) : null}
              </div>
            ) : null}
          </section>
        ))}

        <PendingSubmitButton
          label="Submit Attempt"
          pendingLabel="Submitting..."
          disabled={!canSubmit}
          className="rounded-xl bg-cyan-400/90 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-cyan-400/50"
        />
      </form>
    </div>
  );
}
