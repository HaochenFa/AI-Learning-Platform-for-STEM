"use client";

import { useEffect, useState, useTransition } from "react";
import { listClassChatParticipants } from "@/app/classes/[classId]/chat/workspace-actions";
import ClassChatWorkspace from "@/app/classes/[classId]/chat/ClassChatWorkspace";
import type { ClassChatParticipant } from "@/lib/chat/types";

type TeacherChatMonitorPanelProps = {
  classId: string;
};

export default function TeacherChatMonitorPanel({ classId }: TeacherChatMonitorPanelProps) {
  const [participants, setParticipants] = useState<ClassChatParticipant[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      const result = await listClassChatParticipants(classId);
      if (!result.ok) {
        setError(result.error);
        setParticipants([]);
        setSelectedUserId("");
        return;
      }

      setError(null);
      setParticipants(result.data.participants);
      setSelectedUserId((current) => current || result.data.participants[0]?.userId || "");
    });
  }, [classId]);

  return (
    <div className="space-y-4" id="teacher-chat-monitor">
      <div className="notice-warm rounded-2xl px-4 py-3 text-sm">
        Student always-on chats are visible here for coaching and support. This view is read-only.
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="space-y-2">
        <label className="text-sm text-ui-muted" htmlFor="chat-monitor-student">
          Student
        </label>
        <select
          id="chat-monitor-student"
          value={selectedUserId}
          onChange={(event) => setSelectedUserId(event.target.value)}
          disabled={isPending || participants.length === 0}
          className="input-shell w-full rounded-xl px-4 py-2 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
        >
          {participants.length === 0 ? (
            <option value="">No students yet</option>
          ) : (
            participants.map((participant) => (
              <option key={participant.userId} value={participant.userId}>
                {participant.displayName}
              </option>
            ))
          )}
        </select>
      </div>

      {selectedUserId ? (
        <ClassChatWorkspace
          classId={classId}
          ownerUserId={selectedUserId}
          readOnly
          heading="Student chat history"
        />
      ) : (
        <p className="rounded-xl border border-dashed border-default bg-[var(--surface-muted)] px-4 py-6 text-sm text-ui-muted">
          Select a student to view chat history.
        </p>
      )}
    </div>
  );
}
