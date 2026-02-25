"use client";

import { useMemo, useState, useTransition } from "react";
import { sendOpenPracticeMessage } from "@/app/classes/[classId]/chat/actions";
import type { ChatTurn } from "@/lib/chat/types";
import { MAX_CHAT_MESSAGE_CHARS } from "@/lib/chat/validation";

type OpenPracticeChatPanelProps = {
  classId: string;
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function OpenPracticeChatPanel({ classId }: OpenPracticeChatPanelProps) {
  const [transcript, setTranscript] = useState<ChatTurn[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const serializedTranscript = useMemo(() => JSON.stringify(transcript), [transcript]);

  const handleSendMessage = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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

      const result = await sendOpenPracticeMessage(classId, formData);
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

      setTranscript((current) => [...current, studentTurn, assistantTurn]);
      setMessage("");
    });
  };

  return (
    <div className="space-y-4">
      <div className="status-warning rounded-xl px-4 py-3 text-xs">
        Open practice chat is not saved. Use chat assignments when you need a graded submission.
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="max-h-104 space-y-3 overflow-y-auto rounded-3xl border border-default bg-[var(--surface-muted)] p-4">
        {transcript.length === 0 ? (
          <p className="text-sm text-ui-muted">
            Ask a question grounded in your class materials and published blueprint.
          </p>
        ) : (
          transcript.map((turn, index) => (
            <div
              key={`${turn.role}-${turn.createdAt}-${index}`}
              className={`rounded-2xl border p-4 ${
                turn.role === "student"
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-default bg-white text-ui-primary"
              }`}
            >
              <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-[0.2em]">
                <span>{turn.role === "student" ? "You" : "AI Tutor"}</span>
                <span className="text-ui-muted">{formatDate(turn.createdAt)}</span>
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
            </div>
          ))
        )}
      </div>

      <form className="space-y-3" onSubmit={handleSendMessage}>
        <input type="hidden" name="transcript" value={serializedTranscript} readOnly />
        <label className="text-sm text-ui-muted" htmlFor="open-practice-message">
          Message
        </label>
        <textarea
          id="open-practice-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          maxLength={MAX_CHAT_MESSAGE_CHARS}
          rows={4}
          placeholder="Ask a focused question about your class materials..."
          className="w-full rounded-xl border border-default bg-white px-4 py-3 text-sm text-ui-primary outline-none focus-ring-warm"
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-ui-muted">
            {message.length}/{MAX_CHAT_MESSAGE_CHARS}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setTranscript([]);
                setError(null);
              }}
              className="rounded-xl border border-default px-4 py-2 text-xs font-medium text-ui-muted hover:border-accent hover:bg-accent-soft"
            >
              Clear
            </button>
            <button
              type="submit"
              disabled={isPending || !message.trim()}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-ui-primary disabled:cursor-not-allowed disabled:bg-accent-soft"
            >
              {isPending ? "Thinking..." : "Send"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
