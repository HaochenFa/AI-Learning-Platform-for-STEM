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
      <div className="rounded-2xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-700">
        Student always-on chats are visible here for coaching and support. This view is read-only.
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="space-y-2">
        <label className="text-sm text-slate-600" htmlFor="chat-monitor-student">
          Student
        </label>
        <select
          id="chat-monitor-student"
          value={selectedUserId}
          onChange={(event) => setSelectedUserId(event.target.value)}
          disabled={isPending || participants.length === 0}
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-60"
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
        <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          Select a student to view chat history.
        </p>
      )}
    </div>
  );
}
