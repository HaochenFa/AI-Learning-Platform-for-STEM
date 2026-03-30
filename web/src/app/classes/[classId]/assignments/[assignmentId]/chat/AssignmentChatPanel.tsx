"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { motion } from "motion/react";
import PendingSubmitButton from "@/app/components/PendingSubmitButton";
import { sendAssignmentMessage, submitChatAssignment, generateCanvasAction } from "@/app/classes/[classId]/chat/actions";
import { GenerativeCanvas } from "@/components/canvas";
import { AppIcons } from "@/components/icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import type { CanvasSpec, ChatTurn } from "@/lib/chat/types";
import { MAX_CHAT_MESSAGE_CHARS, MAX_REFLECTION_CHARS } from "@/lib/chat/validation";
import { FADE_UP_VARIANTS, STAGGER_CONTAINER, STAGGER_ITEM } from "@/lib/motion/presets";
import { formatDate } from "@/lib/chat/format";

type AssignmentChatPanelProps = {
  classId: string;
  assignmentId: string;
  instructions: string;
  initialTranscript: ChatTurn[];
  initialReflection: string;
  isSubmitted: boolean;
};

/**
 * State machine for a generative canvas panel attached to an AI response.
 *
 * - `"loading"` — canvas generation is in-flight; show a skeleton.
 * - `"revealed"` — generation succeeded; `spec` holds the layout descriptor.
 * - `"error"` — generation failed; render the canvas in an error state with an inline error banner.
 */
type CanvasEntry = {
  state: "loading" | "revealed" | "error";
  spec: CanvasSpec | null;
};

/**
 * Chat UI for a graded assignment session.
 *
 * **Two-form architecture:**
 * 1. Chat form — sends student messages and requests/loads AI replies via
 *    `sendAssignmentMessage`. Wrapped in `startTransition` to keep the
 *    reflection textarea and other UI interactive during the server round-trip.
 * 2. Submit form — persists the reflection and submits the full transcript via
 *    `submitChatAssignment`. Once submitted, both forms become read-only.
 *
 * **`useTransition` rationale:**
 * The AI round-trip is wrapped in `startTransition` so React marks the update
 * as non-urgent. `isPending` drives the button's loading state without blocking
 * unrelated parts of the page (e.g., typing in the reflection textarea).
 *
 * **`canvasRequestRef` deduplication:**
 * Each AI response may include a `canvas_hint` that triggers an async canvas
 * generation call. `canvasRequestRef` maps `assistantIndex → requestId` using a
 * `useRef` (not state) so the async IIFE can read the latest value synchronously
 * to detect and discard stale responses without causing extra re-renders.
 *
 * @param classId The class UUID — forwarded to server actions for RLS.
 * @param assignmentId The assignment UUID — forwarded to server actions.
 * @param instructions The teacher-authored assignment prompt shown at the top.
 * @param initialTranscript Prior turns loaded server-side (for returning students).
 * @param initialReflection Prior reflection text — pre-fills the reflection textarea.
 * @param isSubmitted When `true`, locks both forms; the submit button label changes.
 */
export default function AssignmentChatPanel({
  classId,
  assignmentId,
  instructions,
  initialTranscript,
  initialReflection,
  isSubmitted,
}: AssignmentChatPanelProps) {
  const [transcript, setTranscript] = useState<ChatTurn[]>(initialTranscript);
  const [reflection, setReflection] = useState(initialReflection);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [canvasMap, setCanvasMap] = useState<Map<number, CanvasEntry>>(new Map());
  // canvasRequestRef maps assistantIndex → requestId.
  // Using a ref (not state) lets the async canvas IIFE read the latest value
  // synchronously inside the closure without triggering extra re-renders on update.
  const canvasRequestRef = useRef(new Map<number, number>());

  const serializedTranscript = useMemo(() => JSON.stringify(transcript), [transcript]);

  const handleSend = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitted) {
      return;
    }

    const trimmed = message.trim();
    if (!trimmed) {
      return;
    }

    const studentTurn: ChatTurn = {
      role: "student",
      message: trimmed,
      createdAt: new Date().toISOString(),
    };

    startTransition(async () => {
      setError(null);
      const formData = new FormData();
      formData.set("message", trimmed);
      formData.set("transcript", JSON.stringify([...transcript, studentTurn]));

      const result = await sendAssignmentMessage(classId, assignmentId, formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      const assistantTurn: ChatTurn = {
        role: "assistant",
        message: result.response.answer,
        createdAt: new Date().toISOString(),
        citations: result.response.citations.map((citation) => ({
          sourceLabel: citation.sourceLabel,
          snippet: citation.rationale,
        })),
      };

      const nextTranscript = [...transcript, studentTurn, assistantTurn];
      setTranscript(nextTranscript);
      setMessage("");

      const canvasHint = result.response.canvas_hint;
      if (canvasHint) {
        const assistantIndex = nextTranscript.length - 1;
        // Increment requestId so any prior in-flight canvas call for this
        // turn is recognised as stale and its result discarded on arrival.
        const requestId = (canvasRequestRef.current.get(assistantIndex) ?? 0) + 1;
        canvasRequestRef.current.set(assistantIndex, requestId);

        // --- Canvas phase: loading ---
        setCanvasMap((current) => {
          const next = new Map(current);
          next.set(assistantIndex, { state: "loading", spec: null });
          return next;
        });

        void (async () => {
          try {
            const canvasResult = await generateCanvasAction(classId, canvasHint, {
              studentQuestion: trimmed,
              aiAnswer: result.response.answer,
            });
            // --- Stale-request guard ---
            // Discard the result if another canvas request superseded this one.
            if (canvasRequestRef.current.get(assistantIndex) !== requestId) return;
            setCanvasMap((current) => {
              const next = new Map(current);
              if (canvasResult.ok) {
                next.set(assistantIndex, { state: "revealed", spec: canvasResult.spec });
              } else {
                next.set(assistantIndex, { state: "error", spec: null });
              }
              return next;
            });
          } catch {
            if (canvasRequestRef.current.get(assistantIndex) !== requestId) return;
            setCanvasMap((current) => {
              const next = new Map(current);
              next.set(assistantIndex, { state: "error", spec: null });
              return next;
            });
          }
        })();
      }
    });
  };

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl border-accent">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Assignment Instructions</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 text-sm text-accent">{instructions}</CardContent>
      </Card>

      {error ? (
        <Alert variant="error">
          <AlertTitle>Message failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="rounded-3xl">
        <CardContent className="p-4">
          <ScrollArea className="max-h-104 rounded-2xl border border-default bg-[var(--surface-muted)] p-3">
            {transcript.length === 0 ? (
              <p className="text-sm text-ui-muted">Start by asking your first assignment question.</p>
            ) : (
              <motion.div
                className="space-y-3"
                initial="initial"
                animate="enter"
                variants={STAGGER_CONTAINER}
              >
                {transcript.map((turn, index) => (
                  <motion.div
                    key={`${turn.role}-${turn.createdAt}-${index}`}
                    variants={STAGGER_ITEM}
                    className={`rounded-2xl border p-4 ${
                      turn.role === "student"
                        ? "border-accent bg-accent-soft text-accent"
                        : "border-default bg-[var(--surface-card,white)] text-ui-primary"
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <Badge variant={turn.role === "student" ? "default" : "secondary"}>
                        {turn.role === "student" ? "You" : "AI Tutor"}
                      </Badge>
                      <span className="text-xs text-ui-muted">{formatDate(turn.createdAt)}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm">{turn.message}</p>
                    {turn.citations && turn.citations.length > 0 ? (
                      <ul className="mt-3 space-y-1 text-xs text-ui-muted">
                        {turn.citations.map((citation) => (
                          <li key={`${citation.sourceLabel}-${citation.snippet ?? ""}`}>
                            {citation.sourceLabel}
                            {citation.snippet ? `: ${citation.snippet}` : ""}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {turn.role === "assistant" && canvasMap.has(index) ? (
                      (() => {
                        const entry = canvasMap.get(index);
                        return entry ? <GenerativeCanvas state={entry.state} spec={entry.spec} /> : null;
                      })()
                    ) : null}
                  </motion.div>
                ))}
              </motion.div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      <motion.form className="space-y-3" onSubmit={handleSend} initial="initial" animate="enter" variants={FADE_UP_VARIANTS}>
        <Label htmlFor="assignment-chat-message">Message</Label>
        <Textarea
          id="assignment-chat-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          maxLength={MAX_CHAT_MESSAGE_CHARS}
          rows={4}
          disabled={isSubmitted}
          placeholder="Continue the assignment conversation..."
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-ui-muted">
            {message.length}/{MAX_CHAT_MESSAGE_CHARS}
          </p>
          <Button type="submit" disabled={isPending || isSubmitted || !message.trim()} variant="warm">
            {isPending ? (
              <>
                <AppIcons.loading className="h-4 w-4 animate-spin" />
                Thinking...
              </>
            ) : (
              <>
                <AppIcons.send className="h-4 w-4" />
                Send
              </>
            )}
          </Button>
        </div>
      </motion.form>

      <motion.form
        action={submitChatAssignment.bind(null, classId, assignmentId)}
        className="space-y-3"
        initial="initial"
        animate="enter"
        variants={FADE_UP_VARIANTS}
      >
        <input type="hidden" name="transcript" value={serializedTranscript} readOnly />
        <div className="space-y-2">
          <Label htmlFor="assignment-reflection">Reflection</Label>
          <Textarea
            id="assignment-reflection"
            name="reflection"
            value={reflection}
            onChange={(event) => setReflection(event.target.value)}
            maxLength={MAX_REFLECTION_CHARS}
            rows={4}
            disabled={isSubmitted}
            placeholder="What did you learn from this chat?"
          />
          <p className="text-xs text-ui-muted">
            {reflection.length}/{MAX_REFLECTION_CHARS}
          </p>
        </div>
        <PendingSubmitButton
          label={isSubmitted ? "Submitted" : "Submit Assignment"}
          pendingLabel="Submitting..."
          disabled={isSubmitted}
          variant="warm"
          className="w-full sm:w-auto"
        />
      </motion.form>
    </div>
  );
}
