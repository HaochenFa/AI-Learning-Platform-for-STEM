"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  archiveClassChatSession,
  createClassChatSession,
  listClassChatMessages,
  listClassChatSessions,
  sendClassChatMessage,
} from "@/app/classes/[classId]/chat/workspace-actions";
import type { ClassChatMessage, ClassChatMessagesPageInfo, ClassChatSession } from "@/lib/chat/types";
import { MAX_CHAT_MESSAGE_CHARS } from "@/lib/chat/validation";

type ClassChatWorkspaceProps = {
  classId: string;
  ownerUserId?: string;
  readOnly?: boolean;
  heading?: string;
};

const CLIENT_COMPACTION_HINT_TURNS = 24;

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ClassChatWorkspace({
  classId,
  ownerUserId,
  readOnly = false,
  heading,
}: ClassChatWorkspaceProps) {
  const [sessions, setSessions] = useState<ClassChatSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ClassChatMessage[]>([]);
  const [pageInfo, setPageInfo] = useState<ClassChatMessagesPageInfo>({ hasMore: false, nextCursor: null });
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [showCompactionStatus, setShowCompactionStatus] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [isSessionPending, startSessionTransition] = useTransition();
  const endOfMessagesRef = useRef<HTMLDivElement | null>(null);
  const skipAutoScrollRef = useRef(false);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
  );

  useEffect(() => {
    if (skipAutoScrollRef.current) {
      skipAutoScrollRef.current = false;
      return;
    }
    endOfMessagesRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, showCompactionStatus]);

  useEffect(() => {
    startSessionTransition(async () => {
      setError(null);
      const result = await listClassChatSessions(classId, ownerUserId);
      if (!result.ok) {
        setError(result.error);
        setSessions([]);
        setSelectedSessionId(null);
        setMessages([]);
        setPageInfo({ hasMore: false, nextCursor: null });
        return;
      }

      const nextSessions = result.data.sessions;
      setSessions(nextSessions);

      if (nextSessions.length === 0 && !readOnly) {
        const created = await createClassChatSession(classId);
        if (!created.ok) {
          setError(created.error);
          return;
        }
        setSessions([created.data.session]);
        setSelectedSessionId(created.data.session.id);
        return;
      }

      setSelectedSessionId((current) => {
        if (current && nextSessions.some((session) => session.id === current)) {
          return current;
        }
        if (!nextSessions[0]?.id) {
          setMessages([]);
          setPageInfo({ hasMore: false, nextCursor: null });
        }
        return nextSessions[0]?.id ?? null;
      });
    });
  }, [classId, ownerUserId, readOnly]);

  useEffect(() => {
    if (!selectedSessionId) {
      return;
    }

    startSessionTransition(async () => {
      const result = await listClassChatMessages(classId, selectedSessionId, ownerUserId);
      if (!result.ok) {
        setError(result.error);
        setMessages([]);
        setPageInfo({ hasMore: false, nextCursor: null });
        return;
      }
      setError(null);
      setStatusNotice(null);
      setMessages(result.data.messages);
      setPageInfo(result.data.pageInfo);
    });
  }, [classId, selectedSessionId, ownerUserId]);

  const handleNewChat = () => {
    if (readOnly) {
      return;
    }
    startSessionTransition(async () => {
      const result = await createClassChatSession(classId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSessions((current) => [result.data.session, ...current]);
      setSelectedSessionId(result.data.session.id);
      setMessages([]);
      setPageInfo({ hasMore: false, nextCursor: null });
      setStatusNotice(null);
      setError(null);
    });
  };

  const handleArchiveSession = (sessionId: string) => {
    if (readOnly) {
      return;
    }
    startSessionTransition(async () => {
      const result = await archiveClassChatSession(classId, sessionId);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      setSessions((current) => {
        const remainingSessions = current.filter((session) => session.id !== result.data.sessionId);
        setSelectedSessionId((currentSelectedSessionId) => {
          if (currentSelectedSessionId !== result.data.sessionId) {
            return currentSelectedSessionId;
          }
          setMessages([]);
          setPageInfo({ hasMore: false, nextCursor: null });
          setStatusNotice(null);
          return remainingSessions[0]?.id ?? null;
        });
        return remainingSessions;
      });
    });
  };

  const handleLoadOlder = () => {
    if (!selectedSessionId || !pageInfo.hasMore || !pageInfo.nextCursor || isLoadingMore) {
      return;
    }
    setIsLoadingMore(true);
    startSessionTransition(async () => {
      try {
        const result = await listClassChatMessages(classId, selectedSessionId, ownerUserId, {
          beforeCursor: pageInfo.nextCursor,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }

        skipAutoScrollRef.current = true;
        setMessages((current) => {
          const existing = new Set(current.map((item) => item.id));
          const older = result.data.messages.filter((item) => !existing.has(item.id));
          return [...older, ...current];
        });
        setPageInfo(result.data.pageInfo);
        setError(null);
      } catch {
        setError("Unable to load older messages right now. Please try again.");
      } finally {
        setIsLoadingMore(false);
      }
    });
  };

  const handleSend = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (readOnly || !selectedSessionId) {
      return;
    }

    const trimmed = message.trim();
    if (!trimmed) {
      return;
    }

    startTransition(async () => {
      setError(null);
      setStatusNotice(null);
      const shouldShowCompactionHint = messages.length >= CLIENT_COMPACTION_HINT_TURNS;
      setShowCompactionStatus(shouldShowCompactionHint);
      const formData = new FormData();
      formData.set("message", trimmed);

      const result = await sendClassChatMessage(classId, selectedSessionId, formData);
      if (!result.ok) {
        setError(result.error);
        setShowCompactionStatus(false);
        return;
      }

      setMessages((current) => [...current, result.data.userMessage, result.data.assistantMessage]);
      setSessions((current) => {
        const target = current.find((session) => session.id === selectedSessionId);
        if (!target) {
          return current;
        }

        const updated = {
          ...target,
          lastMessageAt: result.data.assistantMessage.createdAt,
        };

        return [updated, ...current.filter((session) => session.id !== selectedSessionId)];
      });
      if (result.data.contextMeta.compacted) {
        const compactedAtLabel = result.data.contextMeta.compactedAt
          ? new Date(result.data.contextMeta.compactedAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })
          : null;
        setStatusNotice(
          compactedAtLabel
            ? `Context compacted at ${compactedAtLabel} to preserve long-chat memory.`
            : "Context compacted to preserve long-chat memory.",
        );
      }
      setShowCompactionStatus(false);
      setMessage("");
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="rounded-3xl border border-slate-200 bg-white p-4">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-600">Chats</h3>
          {!readOnly ? (
            <button
              type="button"
              onClick={handleNewChat}
              className="rounded-lg border border-cyan-400/40 px-2.5 py-1 text-xs font-semibold text-cyan-700 hover:bg-cyan-400/10"
            >
              New
            </button>
          ) : null}
        </div>

        <div className="space-y-2">
          {sessions.length > 0 ? (
            sessions.map((session) => {
              const isSelected = selectedSessionId === session.id;
              return (
                <div
                  key={session.id}
                  className={`rounded-xl border px-3 py-2 ${
                    isSelected
                      ? "border-cyan-400/50 bg-cyan-400/10"
                      : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedSessionId(session.id)}
                    className="w-full text-left"
                  >
                    <p className="truncate text-sm font-medium text-slate-900">{session.title}</p>
                    <p className="mt-1 text-xs text-slate-500">{formatDateTime(session.lastMessageAt)}</p>
                  </button>
                  {!readOnly ? (
                    <button
                      type="button"
                      onClick={() => handleArchiveSession(session.id)}
                      className="mt-2 text-xs text-rose-700 hover:text-rose-700"
                    >
                      Archive
                    </button>
                  ) : null}
                </div>
              );
            })
          ) : (
            <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
              {isSessionPending ? "Loading chats..." : "No chat sessions yet."}
            </p>
          )}
        </div>
      </aside>

      <section className="rounded-3xl border border-slate-200 bg-white p-4">
        <header className="mb-4 border-b border-slate-200 pb-4">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Always-on AI Chat</p>
          <h2 className="mt-1 text-xl font-semibold text-slate-900">
            {heading || selectedSession?.title || "Class conversation"}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Chat responses are grounded in your published blueprint and class materials.
          </p>
        </header>

        {error ? (
          <div className="mb-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {statusNotice ? (
          <div className="mb-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-xs text-amber-100">
            {statusNotice}
          </div>
        ) : null}

        <div className="max-h-[32rem] space-y-3 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-4">
          {pageInfo.hasMore ? (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={handleLoadOlder}
                disabled={isLoadingMore}
                className="rounded-full border border-white/20 px-4 py-1 text-xs text-slate-600 hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLoadingMore ? "Loading older messages..." : "Load older messages"}
              </button>
            </div>
          ) : null}

          {messages.length === 0 ? (
            <p className="text-sm text-slate-500">
              {isSessionPending ? "Loading conversation..." : "Start the conversation with a focused question."}
            </p>
          ) : (
            messages.map((turn) => (
              <div key={turn.id} className={turn.authorKind === "assistant" ? "flex justify-center" : "flex justify-end"}>
                {turn.authorKind === "assistant" ? (
                  <article className="w-full max-w-3xl text-slate-900">
                    <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-[0.2em] text-slate-500">
                      <span>AI Tutor</span>
                      <span>{formatTime(turn.createdAt)}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-[15px] leading-7 text-slate-900">{turn.content}</p>
                    {turn.citations.length > 0 ? (
                      <ul className="mt-3 space-y-1 text-xs text-slate-500">
                        {turn.citations.map((citation) => (
                          <li key={`${turn.id}-${citation.sourceLabel}-${citation.snippet ?? ""}`}>
                            {citation.sourceLabel}
                            {citation.snippet ? `: ${citation.snippet}` : ""}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </article>
                ) : (
                  <article className="max-w-[85%] rounded-2xl border border-cyan-400/30 bg-cyan-400/10 p-4 text-cyan-700">
                    <div className="mb-2 flex items-center justify-between gap-4 text-xs uppercase tracking-[0.2em] text-cyan-700">
                      <span>{turn.authorKind === "teacher" ? "Teacher" : "You"}</span>
                      <span className="text-cyan-600">{formatTime(turn.createdAt)}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm">{turn.content}</p>
                  </article>
                )}
              </div>
            ))
          )}

          {showCompactionStatus ? (
            <div className="flex justify-center">
              <div
                className="w-full max-w-3xl rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-amber-100"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="inline-flex h-5 w-5 animate-spin rounded-full border-2 border-amber-200/20 border-t-amber-200"
                    aria-hidden="true"
                  />
                  <p className="text-sm italic">Compacting our conversation so we can keep chatting...</p>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/30" aria-hidden="true">
                  <div className="h-full w-1/2 animate-pulse rounded-full bg-amber-100/80" />
                </div>
              </div>
            </div>
          ) : null}

          <div ref={endOfMessagesRef} />
        </div>

        {!readOnly ? (
          <form className="mt-4 space-y-3" onSubmit={handleSend}>
            <label className="text-sm text-slate-600" htmlFor="always-on-chat-message">
              Message
            </label>
            <textarea
              id="always-on-chat-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={MAX_CHAT_MESSAGE_CHARS}
              rows={4}
              placeholder="Ask a question to learn, review, or consolidate your understanding..."
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-slate-500">
                {message.length}/{MAX_CHAT_MESSAGE_CHARS}
              </p>
              <button
                type="submit"
                disabled={isPending || !message.trim() || !selectedSessionId}
                className="rounded-xl bg-cyan-400/90 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:bg-cyan-400/40"
              >
                {isPending ? "Thinking..." : "Send"}
              </button>
            </div>
          </form>
        ) : (
          <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
            Read-only monitor mode. Students can continue chatting in their own workspace.
          </p>
        )}
      </section>
    </div>
  );
}
