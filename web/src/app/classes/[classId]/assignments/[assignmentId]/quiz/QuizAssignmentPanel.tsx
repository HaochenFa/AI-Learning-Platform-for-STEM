"use client";

import { useMemo, useState } from "react";
import { motion } from "motion/react";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";
import { submitQuizAttempt } from "@/app/classes/[classId]/quiz/actions";
import { AppIcons } from "@/components/icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
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
  readOnly?: boolean;
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
  readOnly = false,
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
  const answeredCount = questions.filter((question) => Boolean(answers[question.id])).length;
  const canSubmit = !readOnly && !dueLocked && attemptsRemaining > 0 && allAnswered;

  return (
    <div className="space-y-6">
      {isSubmittedNotice ? (
        <Alert variant="success">
          <AlertTitle>Attempt submitted</AlertTitle>
          <AlertDescription>Attempt submitted successfully.</AlertDescription>
        </Alert>
      ) : null}
      {readOnly ? (
        <Alert variant="accent">
          <AlertTitle>Preview mode</AlertTitle>
          <AlertDescription>
            Quiz preview is read-only. Exit preview mode to return to teacher tools.
          </AlertDescription>
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
          {!readOnly && !dueLocked && attemptsRemaining > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-ui-muted">
                  {answeredCount} of {questions.length} answered
                </span>
                <span className="font-medium text-ui-primary">
                  {questions.length > 0 ? Math.round((answeredCount / questions.length) * 100) : 0}%
                </span>
              </div>
              <Progress value={questions.length > 0 ? (answeredCount / questions.length) * 100 : 0} className="h-1.5" />
            </div>
          )}
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
              <Card
                className={cn(
                  "rounded-2xl transition-shadow duration-200",
                  !answers[question.id] && answeredCount > 0 && "ring-1 ring-[var(--accent-primary)]/20",
                )}
              >
                <CardContent className="p-4">
                  <p className="text-sm font-semibold text-ui-primary">
                    {questionIndex + 1}. {question.question}
                  </p>

                  <div className="mt-3 space-y-2">
                    {question.choices.map((choice) => {
                      const isSelected = answers[question.id] === choice;
                      return (
                        <label
                          key={`${question.id}-${choice}`}
                          className={cn(
                            "group flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-all duration-150",
                            isSelected
                              ? "border-accent bg-accent-soft text-accent-strong"
                              : "border-default bg-[var(--surface-muted)] text-ui-primary hover:border-accent hover:bg-accent-soft hover:text-accent",
                          )}
                        >
                          {/* Custom radio indicator */}
                          <span
                            className={cn(
                              "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-150",
                              isSelected
                                ? "border-[var(--accent-primary)] bg-[var(--accent-primary)]"
                                : "border-[var(--border-default)] group-hover:border-[color-mix(in_srgb,var(--accent-primary)_45%,#ffffff)]",
                            )}
                          >
                            {isSelected && (
                              <span className="h-1.5 w-1.5 rounded-full bg-white" />
                            )}
                          </span>
                          <input
                            type="radio"
                            name={`question-${question.id}`}
                            checked={isSelected}
                            onChange={() =>
                              setAnswers((current) => ({
                                ...current,
                                [question.id]: choice,
                              }))
                            }
                            disabled={readOnly || dueLocked || attemptsRemaining === 0}
                            className="sr-only"
                          />
                          <span>{choice}</span>
                        </label>
                      );
                    })}
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
