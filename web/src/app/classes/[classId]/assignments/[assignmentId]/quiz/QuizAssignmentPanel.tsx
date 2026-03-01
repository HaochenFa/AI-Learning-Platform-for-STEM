"use client";

import { useMemo, useState } from "react";
import { motion } from "motion/react";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";
import { submitQuizAttempt } from "@/app/classes/[classId]/quiz/actions";
import { AppIcons } from "@/components/icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { STAGGER_CONTAINER, STAGGER_ITEM } from "@/lib/motion/presets";

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
        <Alert variant="success">
          <AlertTitle>Attempt submitted</AlertTitle>
          <AlertDescription>Attempt submitted successfully.</AlertDescription>
        </Alert>
      ) : null}

      <Card className="rounded-2xl">
        <CardContent className="space-y-2 p-4 text-sm text-ui-muted">
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
        </CardContent>
      </Card>

      <form action={submitQuizAttempt.bind(null, classId, assignmentId)} className="space-y-4">
        <input type="hidden" name="answers" value={serializedAnswers} readOnly />

        <motion.div
          className="space-y-4"
          initial="initial"
          animate="enter"
          variants={STAGGER_CONTAINER}
        >
          {questions.map((question, questionIndex) => (
            <motion.section key={question.id} variants={STAGGER_ITEM}>
              <Card className="rounded-2xl">
                <CardContent className="p-4">
                  <p className="text-sm font-semibold text-ui-primary">
                    {questionIndex + 1}. {question.question}
                  </p>

                  <div className="mt-3 space-y-2">
                    {question.choices.map((choice) => (
                      <label
                        key={`${question.id}-${choice}`}
                        className="flex cursor-pointer items-start gap-2 rounded-xl border border-default bg-[var(--surface-muted)] px-3 py-2 text-sm text-ui-subtle transition-colors hover:border-accent hover:bg-accent-soft"
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
                          className="mt-0.5 accent-[var(--accent)]"
                        />
                        <span>{choice}</span>
                      </label>
                    ))}
                  </div>

                  {revealAnswers ? (
                    <Alert variant="accent" className="mt-3">
                      <AlertTitle>Correct answer: {question.answer ?? "Unavailable"}</AlertTitle>
                      {question.explanation ? (
                        <AlertDescription>{question.explanation}</AlertDescription>
                      ) : null}
                    </Alert>
                  ) : null}
                </CardContent>
              </Card>
            </motion.section>
          ))}
        </motion.div>

        <PendingSubmitButton
          label="Submit Attempt"
          pendingLabel="Submitting..."
          disabled={!canSubmit}
          variant="warm"
          className="w-full sm:w-auto"
        />
        {!canSubmit ? (
          <p className="flex items-center gap-2 text-xs text-ui-muted">
            <AppIcons.help className="h-3.5 w-3.5" />
            Complete all questions and ensure attempts are available before submitting.
          </p>
        ) : null}
      </form>
    </div>
  );
}
