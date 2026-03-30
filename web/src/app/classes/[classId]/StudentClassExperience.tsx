"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import AuthHeader from "@/app/components/AuthHeader";
import ClassWorkspaceShell from "@/app/classes/[classId]/_components/ClassWorkspaceShell";
import ClassChatWorkspace from "@/app/classes/[classId]/chat/ClassChatWorkspace";
import TransientFeedbackAlert from "@/components/ui/transient-feedback-alert";
import { AppIcons } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

type ActivityAssignmentSummary = {
  assignmentId: string;
  title: string;
  dueAt: string | null;
  activityType: "chat" | "quiz" | "flashcards";
  status?: string;
};

/**
 * Identifies which workspace is currently focused.
 *
 * `null` (stored as `FocusWidget | null` in state) means the widget card grid
 * is shown. A non-null value collapses the grid into `ClassWorkspaceShell`
 * with the matching workspace rendered as the `main` slot.
 */
type FocusWidget = "chat" | "chat_assignments" | "quizzes" | "flashcards" | "blueprint";

/**
 * Props for the student class hub.
 *
 * - `initialView` — pre-selects a widget on mount; used for `?view=chat` deep-links
 *   so the AI Chat workspace opens immediately without a grid tap.
 * - `isPreviewMode` — true when a teacher is viewing via `?as=student`; shows a
 *   dismissal banner and appends `?as=student` to all assignment links so the
 *   teacher stays in preview mode when navigating into individual activities.
 */
type StudentClassExperienceProps = {
  classId: string;
  classTitle: string;
  subject: string | null;
  level: string | null;
  publishedBlueprint: boolean;
  errorMessage: string | null;
  uploadNotice: string | null;
  totalAssignments: number;
  chatAssignments: ActivityAssignmentSummary[];
  quizAssignments: ActivityAssignmentSummary[];
  flashcardsAssignments: ActivityAssignmentSummary[];
  initialView?: "chat" | null;
  isPreviewMode?: boolean;
};

function formatDueDate(value: string | null) {
  if (!value) return "No due date";
  return `Due ${new Date(value).toLocaleString()}`;
}

function formatAssignmentStatus(value: string | null | undefined) {
  const status = value ?? "assigned";
  if (status === "in_progress") return "In progress";
  if (status === "submitted") return "Submitted";
  if (status === "reviewed") return "Reviewed";
  return "Assigned";
}

function getStatusPillClass(status: string | undefined) {
  const s = status ?? "assigned";
  if (s === "submitted" || s === "reviewed")
    return "border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success-fg)]";
  if (s === "in_progress") return "border-accent/30 bg-accent-soft text-accent";
  return "border-default bg-[var(--surface-muted)] text-ui-muted";
}

function AssignmentRow({
  assignment,
  href,
}: {
  assignment: ActivityAssignmentSummary;
  href: string;
}) {
  const ActivityIcon =
    assignment.activityType === "chat"
      ? AppIcons.chat
      : assignment.activityType === "quiz"
        ? AppIcons.quiz
        : AppIcons.flashcards;

  return (
    <Link
      href={href}
      className="ui-motion-lift group flex items-center gap-3 rounded-2xl border border-default bg-[var(--surface-card,white)] p-3 hover:-translate-y-0.5 hover:border-accent hover:shadow-md"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-muted)] text-ui-muted transition-colors duration-200 group-hover:bg-accent-soft group-hover:text-accent">
        <ActivityIcon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ui-primary transition-colors duration-200 group-hover:text-accent">
          {assignment.title}
        </p>
        <p className="text-xs text-ui-muted">{formatDueDate(assignment.dueAt)}</p>
      </div>
      <span
        className={cn(
          "shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
          getStatusPillClass(assignment.status),
        )}
      >
        {formatAssignmentStatus(assignment.status)}
      </span>
    </Link>
  );
}

/**
 * Client-side student class hub with a `FocusWidget` state machine.
 *
 * **FocusWidget state machine:**
 * `activeWidget === null` → shows the widget card grid (home view).
 * `activeWidget !== null` → collapses into `ClassWorkspaceShell` with the
 *   selected workspace in the `main` slot and a sidebar tool-switcher.
 *
 * **URL synchronisation:**
 * A `useEffect` keeps the `?view=chat` param in sync with `activeWidget` so
 * the AI Chat workspace can be deep-linked and the browser back button works.
 * Only `"chat"` is persisted in the URL; other widget states are transient.
 *
 * **Preview mode:**
 * When `isPreviewMode` is true, a teacher is previewing the student view via
 * `?as=student`. A dismissal banner is shown, breadcrumbs point to the teacher
 * dashboard, and `previewQuerySuffix` appends `?as=student` to assignment links.
 */
export default function StudentClassExperience({
  classId,
  classTitle,
  subject,
  level,
  publishedBlueprint,
  errorMessage,
  uploadNotice,
  totalAssignments,
  chatAssignments,
  quizAssignments,
  flashcardsAssignments,
  initialView = null,
  isPreviewMode = false,
}: StudentClassExperienceProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [activeWidget, setActiveWidget] = useState<FocusWidget | null>(
    initialView === "chat" ? "chat" : null,
  );
  const previewQuerySuffix = isPreviewMode ? "?as=student" : "";
  const dashboardHref = isPreviewMode ? "/teacher/dashboard" : "/student/dashboard";

  // Keep ?view= in sync with activeWidget so the AI Chat workspace can be
  // deep-linked. Only "chat" is persisted; other widgets don't update the URL.
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

  const widgetItems: Array<{
    key: FocusWidget;
    title: string;
    description: string;
    icon: LucideIcon;
    count?: number;
  }> = useMemo(
    () => [
      {
        key: "chat",
        title: "AI Chat",
        description: "Learn, review, and consolidate knowledge in a ChatGPT-style workspace.",
        icon: AppIcons.chat,
      },
      {
        key: "chat_assignments",
        title: "Chat Assignments",
        description: "Complete graded chat assignments and submit your reflections.",
        icon: AppIcons.chat,
        count: chatAssignments.length,
      },
      {
        key: "quizzes",
        title: "Quizzes",
        description: "Track attempts, feedback, and best-score progress.",
        icon: AppIcons.quiz,
        count: quizAssignments.length,
      },
      {
        key: "flashcards",
        title: "Flashcards",
        description: "Practice retention with assignment flashcard sessions.",
        icon: AppIcons.flashcards,
        count: flashcardsAssignments.length,
      },
      {
        key: "blueprint",
        title: "Blueprint",
        description: "Reference the published class blueprint and learning objectives.",
        icon: AppIcons.classes,
      },
    ],
    [chatAssignments.length, quizAssignments.length, flashcardsAssignments.length],
  );

  const renderAssignmentList = (
    assignments: ActivityAssignmentSummary[],
    emptyMessage: string,
    pathFor: (assignmentId: string) => string,
  ) =>
    assignments.length > 0 ? (
      <div className="space-y-2 stagger-children">
        {assignments.slice(0, 8).map((assignment) => (
          <AssignmentRow
            key={assignment.assignmentId}
            assignment={assignment}
            href={pathFor(assignment.assignmentId)}
          />
        ))}
      </div>
    ) : (
      <p className="rounded-2xl border border-dashed border-default bg-[var(--surface-muted)] p-4 text-sm text-ui-muted">
        {emptyMessage}
      </p>
    );

  const renderFocusedMain = () => {
    if (activeWidget === "chat") {
      return publishedBlueprint ? (
        <ClassChatWorkspace classId={classId} />
      ) : (
        <div className="status-warning rounded-2xl p-4 text-sm">
          AI Chat unlocks after your teacher publishes the class blueprint.
        </div>
      );
    }

    if (activeWidget === "chat_assignments") {
      return (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-ui-primary">Your chat assignments</h3>
          {renderAssignmentList(
            chatAssignments,
            "No chat assignments yet. Use AI Chat while you wait.",
            (assignmentId) =>
              `/classes/${classId}/assignments/${assignmentId}/chat${previewQuerySuffix}`,
          )}
        </div>
      );
    }

    if (activeWidget === "quizzes") {
      return (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-ui-primary">Your quizzes</h3>
          {renderAssignmentList(
            quizAssignments,
            "No quiz assignments yet. Your teacher will publish them here.",
            (assignmentId) =>
              `/classes/${classId}/assignments/${assignmentId}/quiz${previewQuerySuffix}`,
          )}
        </div>
      );
    }

    if (activeWidget === "flashcards") {
      return (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-ui-primary">Your flashcards</h3>
          {renderAssignmentList(
            flashcardsAssignments,
            "No flashcard assignments yet. Your teacher will publish them here.",
            (assignmentId) =>
              `/classes/${classId}/assignments/${assignmentId}/flashcards${previewQuerySuffix}`,
          )}
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-ui-primary">Published blueprint</h3>
        {publishedBlueprint ? (
          <div className="rounded-2xl border border-accent bg-accent-soft p-4 text-sm text-accent-strong">
            Use the blueprint to align your questions, quizzes, and revision plan.
            <div className="mt-4">
              <Button asChild variant="outline" size="sm">
                <Link href={`/classes/${classId}/blueprint/published`}>View published blueprint</Link>
              </Button>
            </div>
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed border-default bg-[var(--surface-muted)] p-4 text-sm text-ui-muted">
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
        accountType={isPreviewMode ? "teacher" : "student"}
        classContext={{ classId, isTeacher: false, preserveStudentPreview: isPreviewMode }}
        breadcrumbs={[{ label: "Dashboard", href: dashboardHref }, { label: classTitle }]}
      />

      {isPreviewMode && (
        <div className="flex items-center justify-center gap-4 status-warning px-4 py-3 text-center text-sm font-medium shadow-sm">
          <span>Previewing as a student</span>
          <Link
            href={`/classes/${classId}`}
            className="rounded-full border border-current/30 bg-current/10 px-4 py-1.5 text-xs font-semibold transition-colors hover:bg-current/20"
          >
            Exit Preview
          </Link>
        </div>
      )}

      <div className="mx-auto w-full max-w-6xl px-6 py-16">
        <header className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ui-subtle">
            Student Hub
          </p>
          <h1 className="editorial-title mt-2 text-4xl text-ui-primary">{classTitle}</h1>
          <p className="mt-1.5 text-sm text-ui-muted">
            {subject || "General"} · {level || "Mixed level"}
          </p>
          {totalAssignments > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-ui-primary">
                {totalAssignments} {totalAssignments === 1 ? "activity" : "activities"} assigned
              </span>
              <span className="text-ui-subtle">·</span>
              {chatAssignments.length > 0 && (
                <span className="pill-chat inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold">
                  {chatAssignments.length} chat
                </span>
              )}
              {quizAssignments.length > 0 && (
                <span className="pill-quiz inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold">
                  {quizAssignments.length} quiz
                </span>
              )}
              {flashcardsAssignments.length > 0 && (
                <span className="pill-flashcards inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold">
                  {flashcardsAssignments.length} flash
                </span>
              )}
            </div>
          )}
        </header>

        {errorMessage ? (
          <TransientFeedbackAlert variant="error" message={errorMessage} className="mb-6" />
        ) : null}

        {uploadNotice ? (
          <div className="notice-warm mb-6 rounded-xl px-4 py-3 text-sm">{uploadNotice}</div>
        ) : null}

        <AnimatePresence mode="wait" initial={false}>
          {!activeWidget ? (
            <motion.section
              key="widget-grid"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.24, ease: [0.22, 0.61, 0.36, 1] }}
              className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
            >
              {widgetItems.map((widget, idx) => {
                const Icon = widget.icon;
                return (
                  <motion.button
                    key={widget.key}
                    type="button"
                    onClick={() => setActiveWidget(widget.key)}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.06, duration: 0.28, ease: [0.22, 0.61, 0.36, 1] }}
                    className="ui-motion-lift group rounded-3xl border border-default bg-[var(--surface-card,white)] p-6 text-left hover:-translate-y-0.5 hover:border-accent hover:shadow-md"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--surface-muted)] text-ui-muted transition-colors duration-200 group-hover:bg-accent-soft group-hover:text-accent">
                        <Icon className="h-5 w-5" />
                      </div>
                      {widget.count !== undefined && widget.count > 0 && (
                        <span className="inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
                          {widget.count}
                        </span>
                      )}
                    </div>
                    <h2 className="mt-4 text-base font-semibold text-ui-primary transition-colors duration-200 group-hover:text-accent">
                      {widget.title}
                    </h2>
                    <p className="mt-1.5 text-sm text-ui-muted">{widget.description}</p>
                    <span className="mt-5 inline-flex items-center gap-1 text-xs font-semibold text-accent transition-opacity duration-200 group-hover:opacity-80">
                      Open workspace →
                    </span>
                  </motion.button>
                );
              })}
            </motion.section>
          ) : (
            <motion.div
              key="workspace-shell"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.24, ease: [0.22, 0.61, 0.36, 1] }}
            >
              <ClassWorkspaceShell
                title={widgetItems.find((item) => item.key === activeWidget)?.title ?? "Workspace"}
                subtitle="Switch tools from the sidebar while keeping your workspace context."
                onExit={() => setActiveWidget(null)}
                main={renderFocusedMain()}
                sidebar={
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-ui-subtle">
                      Class tools
                    </h3>
                    {widgetItems.map((widget) => {
                      const Icon = widget.icon;
                      const isActive = widget.key === activeWidget;
                      return (
                        <button
                          key={widget.key}
                          type="button"
                          onClick={() => setActiveWidget(widget.key)}
                          className={cn(
                            "w-full rounded-xl border px-3 py-2.5 text-left text-sm transition-colors duration-150",
                            isActive
                              ? "border-accent bg-accent-soft"
                              : "border-default bg-[var(--surface-muted)] hover:border-accent hover:bg-accent-soft",
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <Icon
                              className={cn(
                                "h-3.5 w-3.5 shrink-0",
                                isActive ? "text-accent" : "text-ui-muted",
                              )}
                            />
                            <p
                              className={cn(
                                "font-semibold",
                                isActive ? "text-accent-strong" : "text-ui-primary",
                              )}
                            >
                              {widget.title}
                            </p>
                            {widget.count !== undefined && widget.count > 0 && (
                              <span className="ml-auto text-xs font-medium text-ui-muted">
                                {widget.count}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                }
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
