"use client";

import { useMemo, useState } from "react";
import { motion } from "motion/react";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";
import {
  createQuizAssignment,
  publishQuizActivity,
  saveQuizDraft,
} from "@/app/classes/[classId]/quiz/actions";
import { AppIcons } from "@/components/icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { STAGGER_CONTAINER, STAGGER_ITEM } from "@/lib/motion/presets";

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
  hasSubmissions?: boolean;
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
  hasSubmissions = false,
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
      current.map((question, position) =>
        position === index ? { ...question, ...next } : question,
      ),
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
          question.answer && question.choices[choiceIndex] === question.answer
            ? value
            : question.answer;
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
      {isPublished && hasSubmissions ? (
        <Alert variant="warning">
          <AlertTitle>Quiz has student submissions</AlertTitle>
          <AlertDescription>
            Editing questions may affect grading accuracy for existing submissions. Changes are saved immediately.
          </AlertDescription>
        </Alert>
      ) : isPublished ? (
        <Alert variant="accent">
          <AlertTitle>Quiz is published</AlertTitle>
          <AlertDescription>
            You can still edit questions before students submit.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="rounded-3xl">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2">
            <AppIcons.quiz className="h-5 w-5" />
            {isPublished ? "Quiz Content" : "Quiz Draft"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <form action={saveQuizDraft.bind(null, classId, activityId)} className="space-y-6">
            <input type="hidden" name="quiz_payload" value={payload} readOnly />

            <div className="space-y-2">
              <Label htmlFor="quiz-title">Quiz Title</Label>
              <Input
                id="quiz-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}

              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="quiz-instructions">Instructions</Label>
              <Textarea
                id="quiz-instructions"
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
              {questions.map((question, questionIndex) => (
                <motion.section key={`question-${questionIndex}`} variants={STAGGER_ITEM}>
                  <Card className="rounded-2xl bg-[var(--surface-muted)]">
                    <CardContent className="p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-ui-subtle">
                          Question {questionIndex + 1}
                        </p>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => removeQuestion(questionIndex)}
                          disabled={questions.length === 1}
                        >
                          Remove
                        </Button>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs uppercase tracking-[0.2em]">Prompt</Label>
                        <Textarea
                          value={question.question}
                          onChange={(event) =>
                            updateQuestion(questionIndex, {
                              question: event.target.value,
                            })
                          }
                          rows={2}
          
                        />
                      </div>

                      <div className="mt-4 space-y-3">
                        {question.choices.map((choice, choiceIndex) => (
                          <div key={`choice-${questionIndex}-${choiceIndex}`} className="space-y-1">
                            <Label className="text-xs uppercase tracking-[0.2em]">
                              Choice {choiceIndex + 1}
                            </Label>
                            <Input
                              value={choice}
                              onChange={(event) =>
                                updateChoice(questionIndex, choiceIndex, event.target.value)
                              }
              
                            />
                          </div>
                        ))}
                      </div>

                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <div className="space-y-1">
                          <Label className="text-xs uppercase tracking-[0.2em]">
                            Correct Answer
                          </Label>
                          <select
                            value={question.answer}
                            onChange={(event) =>
                              updateQuestion(questionIndex, {
                                answer: event.target.value,
                              })
                            }
            
                            className="flex h-10 w-full min-w-0 rounded-xl border border-default bg-[var(--surface-card,white)] px-3 py-2 text-sm text-ui-primary shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <option value="">Select a correct answer</option>
                            {question.choices.map((choice, choiceIndex) => (
                              <option
                                key={`answer-option-${questionIndex}-${choiceIndex}`}
                                value={choice}
                              >
                                {choice || `Choice ${choiceIndex + 1}`}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs uppercase tracking-[0.2em]">Explanation</Label>
                          <Textarea
                            value={question.explanation}
                            onChange={(event) =>
                              updateQuestion(questionIndex, {
                                explanation: event.target.value,
                              })
                            }
                            rows={2}
            
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.section>
              ))}
            </motion.div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" onClick={addQuestion}>
                <AppIcons.add className="h-4 w-4" />
                Add Question
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
            Publish to lock question content, then create a whole-class assignment.
          </p>

          <div className="mt-4 flex flex-wrap gap-3">
            {!isPublished ? (
              <form action={publishQuizActivity.bind(null, classId, activityId)}>
                <PendingSubmitButton
                  label="Publish Quiz"
                  pendingLabel="Publishing..."
                  variant="warm"
                />
              </form>
            ) : (
              <Badge variant="success">Quiz is published</Badge>
            )}

            <form
              action={createQuizAssignment.bind(null, classId, activityId)}
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
