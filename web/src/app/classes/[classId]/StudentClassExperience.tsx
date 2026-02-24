"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import AuthHeader from "@/app/components/AuthHeader";
import ClassWorkspaceShell from "@/app/classes/[classId]/_components/ClassWorkspaceShell";
import ClassChatWorkspace from "@/app/classes/[classId]/chat/ClassChatWorkspace";

type ActivityAssignmentSummary = {
  assignmentId: string;
  title: string;
  dueAt: string | null;
  activityType: "chat" | "quiz" | "flashcards";
  status?: string;
};

type FocusWidget = "chat" | "chat_assignments" | "quizzes" | "flashcards" | "blueprint";

type StudentClassExperienceProps = {
  classId: string;
  classTitle: string;
  subject: string | null;
  level: string | null;
  publishedBlueprint: boolean;
  errorMessage: string | null;
  uploadNotice: string | null;
  chatAssignments: ActivityAssignmentSummary[];
  quizAssignments: ActivityAssignmentSummary[];
  flashcardsAssignments: ActivityAssignmentSummary[];
  initialView?: "chat" | null;
};

function formatDueDate(value: string | null) {
  if (!value) {
    return "No due date";
  }
  return `Due ${new Date(value).toLocaleString()}`;
}

function formatAssignmentStatus(value: string | null | undefined) {
  const status = value ?? "assigned";
  if (status === "in_progress") {
    return "In progress";
  }
  if (status === "submitted") {
    return "Submitted";
  }
  if (status === "reviewed") {
    return "Reviewed";
  }
  return "Assigned";
}

export default function StudentClassExperience({
  classId,
  classTitle,
  subject,
  level,
  publishedBlueprint,
  errorMessage,
  uploadNotice,
  chatAssignments,
  quizAssignments,
  flashcardsAssignments,
  initialView = null,
}: StudentClassExperienceProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [activeWidget, setActiveWidget] = useState<FocusWidget | null>(
    initialView === "chat" ? "chat" : null,
  );

  useEffect(() => {
    const currentView = searchParams.get("view");
    if (activeWidget === "chat" && currentView !== "chat") {
      const next = new URLSearchParams(searchParams.toString());
      next.set("view", "chat");
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
      return;
    }

    if (activeWidget !== "chat" && currentView === "chat") {
      const next = new URLSearchParams(searchParams.toString());
      next.delete("view");
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }
  }, [activeWidget, pathname, router, searchParams]);

  const widgetItems = useMemo(
    () => [
      {
        key: "chat" as const,
        title: "AI Chat",
        description: "Learn, review, and consolidate knowledge in a ChatGPT-style workspace.",
      },
      {
        key: "chat_assignments" as const,
        title: "Chat Assignments",
        description: "Complete graded chat assignments and submit your reflections.",
      },
      {
        key: "quizzes" as const,
        title: "Quizzes",
        description: "Track attempts, feedback, and best-score progress.",
      },
      {
        key: "flashcards" as const,
        title: "Flashcards",
        description: "Practice retention with assignment flashcard sessions.",
      },
      {
        key: "blueprint" as const,
        title: "Blueprint",
        description: "Reference the published class blueprint and learning objectives.",
      },
    ],
    [],
  );

  const renderAssignmentList = (
    assignments: ActivityAssignmentSummary[],
    emptyMessage: string,
    pathFor: (assignmentId: string) => string,
  ) =>
    assignments.length > 0 ? (
      <div className="space-y-3">
        {assignments.slice(0, 8).map((assignment) => (
          <div
            key={assignment.assignmentId}
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3"
          >
            <div>
              <p className="text-sm font-semibold text-slate-900">{assignment.title}</p>
              <p className="text-xs text-slate-500">
                {formatDueDate(assignment.dueAt)} · Status: {formatAssignmentStatus(assignment.status)}
              </p>
            </div>
            <Link
              href={pathFor(assignment.assignmentId)}
              className="rounded-lg border border-cyan-300 px-3 py-1.5 text-xs font-semibold text-cyan-700 hover:bg-cyan-50"
            >
              Open
            </Link>
          </div>
        ))}
      </div>
    ) : (
      <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        {emptyMessage}
      </p>
    );

  const renderFocusedMain = () => {
    if (activeWidget === "chat") {
      return publishedBlueprint ? (
        <ClassChatWorkspace classId={classId} />
      ) : (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-800">
          AI Chat unlocks after your teacher publishes the class blueprint.
        </div>
      );
    }

    if (activeWidget === "chat_assignments") {
      return (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-slate-900">Your chat assignments</h3>
          {renderAssignmentList(
            chatAssignments,
            "No chat assignments yet. Use AI Chat while you wait.",
            (assignmentId) => `/classes/${classId}/assignments/${assignmentId}/chat`,
          )}
        </div>
      );
    }

    if (activeWidget === "quizzes") {
      return (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-slate-900">Your quizzes</h3>
          {renderAssignmentList(
            quizAssignments,
            "No quiz assignments yet. Your teacher will publish them here.",
            (assignmentId) => `/classes/${classId}/assignments/${assignmentId}/quiz`,
          )}
        </div>
      );
    }

    if (activeWidget === "flashcards") {
      return (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-slate-900">Your flashcards</h3>
          {renderAssignmentList(
            flashcardsAssignments,
            "No flashcard assignments yet. Your teacher will publish them here.",
            (assignmentId) => `/classes/${classId}/assignments/${assignmentId}/flashcards`,
          )}
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-slate-900">Published blueprint</h3>
        {publishedBlueprint ? (
          <div className="rounded-2xl border border-cyan-300 bg-cyan-50 px-4 py-4 text-sm text-cyan-800">
            Use the blueprint to align your questions, quizzes, and revision plan.
            <div className="mt-4">
              <Link
                href={`/classes/${classId}/blueprint/published`}
                className="rounded-xl border border-cyan-300 px-4 py-2 text-xs font-semibold text-cyan-700 hover:bg-cyan-100"
              >
                View published blueprint
              </Link>
            </div>
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            Blueprint publication is pending. Ask your teacher when it will be available.
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="surface-page min-h-screen">
      <AuthHeader
        activeNav="dashboard"
        classContext={{ classId, isTeacher: false }}
        breadcrumbs={[{ label: "Dashboard", href: "/student/dashboard" }, { label: classTitle }]}
      />

      <div className="mx-auto w-full max-w-6xl px-6 py-16">
        <header className="mb-8 space-y-2">
          <p className="text-sm font-medium text-slate-500">Student Hub</p>
          <h1 className="text-3xl font-semibold text-slate-900">{classTitle}</h1>
          <p className="text-sm text-slate-500">
            {subject || "STEM"} · {level || "Mixed level"}
          </p>
        </header>

        {errorMessage ? (
          <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {errorMessage}
          </div>
        ) : null}

        {uploadNotice ? (
          <div className="mb-6 rounded-xl border border-cyan-300 bg-cyan-50 px-4 py-3 text-sm text-cyan-700">
            {uploadNotice}
          </div>
        ) : null}

        {!activeWidget ? (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {widgetItems.map((widget) => (
              <button
                key={widget.key}
                type="button"
                onClick={() => setActiveWidget(widget.key)}
                className="ui-motion-lift rounded-3xl border border-slate-200 bg-white p-6 text-left hover:-translate-y-0.5 hover:border-cyan-300"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Widget</p>
                <h2 className="mt-2 text-xl font-semibold text-slate-900">{widget.title}</h2>
                <p className="mt-3 text-sm text-slate-600">{widget.description}</p>
                <span className="mt-5 inline-flex rounded-xl border border-cyan-300 px-3 py-1.5 text-xs font-semibold text-cyan-700">
                  Open workspace
                </span>
              </button>
            ))}
          </section>
        ) : (
          <ClassWorkspaceShell
            title={widgetItems.find((item) => item.key === activeWidget)?.title ?? "Workspace"}
            subtitle="Switch tools from the sidebar while keeping your workspace context."
            onExit={() => setActiveWidget(null)}
            main={renderFocusedMain()}
            sidebar={
              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Class tools
                </h3>
                {widgetItems.map((widget) => (
                  <button
                    key={widget.key}
                    type="button"
                    onClick={() => setActiveWidget(widget.key)}
                    className={`w-full rounded-xl border px-3 py-2 text-left text-sm ${
                      widget.key === activeWidget
                        ? "border-cyan-300 bg-cyan-50 text-cyan-800"
                        : "border-slate-200 bg-white text-slate-700 hover:border-cyan-300 hover:bg-cyan-50"
                    }`}
                  >
                    <p className="font-semibold">{widget.title}</p>
                    <p className="mt-1 text-xs text-slate-500">{widget.description}</p>
                  </button>
                ))}
              </div>
            }
          />
        )}
      </div>
    </div>
  );
}
