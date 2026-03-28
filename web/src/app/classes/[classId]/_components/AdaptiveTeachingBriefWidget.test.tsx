/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdaptiveTeachingBriefWidget } from "./AdaptiveTeachingBriefWidget";
import {
  refreshClassTeachingBrief,
  type TeachingBriefActionResult,
} from "@/lib/actions/teaching-brief";

vi.mock("@/lib/actions/teaching-brief", async () => {
  const actual = await vi.importActual<typeof import("@/lib/actions/teaching-brief")>(
    "@/lib/actions/teaching-brief",
  );
  return {
    ...actual,
    refreshClassTeachingBrief: vi.fn(),
  };
});

function makeState(
  overrides: Partial<TeachingBriefActionResult> = {},
): TeachingBriefActionResult {
  return {
    status: "ready",
    generatedAt: "2026-03-24T09:42:00Z",
    isStale: false,
    isRefreshing: false,
    hasEvidence: true,
    error: null,
    payload: {
      summary: "Students can recall Newton's laws, but force-pair explanations are still shaky.",
      strongestAction: "Model one free-body diagram before partner practice.",
      attentionItems: ["Force-pair language", "Net force reasoning"],
      misconceptions: [
        {
          topicId: "topic-1",
          topicTitle: "Newton's Third Law",
          description: "Students think the larger object exerts the larger force.",
        },
      ],
      studentsToWatch: [
        {
          studentId: "student-1",
          displayName: "Alex P.",
          reason: "Low completion and weak apply-level quiz performance.",
        },
      ],
      nextStep: "Start class with a one-question misconception check.",
      recommendedActivity: {
        type: "quiz",
        reason: "A short retrieval quiz can confirm whether the misconception is shrinking.",
      },
      evidenceBasis: "Based on recent assignment scores and class chat participation.",
    },
    ...overrides,
  };
}

describe("AdaptiveTeachingBriefWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders no data yet when there is not enough evidence", () => {
    render(
      <AdaptiveTeachingBriefWidget
        state={makeState({
          status: "no_data",
          generatedAt: null,
          hasEvidence: false,
          payload: null,
        })}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText(/no data yet/i)).toBeInTheDocument();
    expect(screen.getByText(/not enough student activity/i)).toBeInTheDocument();
  });

  it("renders the empty CTA when evidence exists but no brief has been generated", () => {
    render(
      <AdaptiveTeachingBriefWidget
        state={makeState({
          status: "empty",
          generatedAt: null,
          payload: null,
        })}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /create today's brief/i })).toBeInTheDocument();
  });

  it("renders the summary and strongest action in the collapsed memo view", () => {
    render(
      <AdaptiveTeachingBriefWidget state={makeState()} onRefresh={vi.fn()} />,
    );

    expect(screen.getByText(/force-pair explanations are still shaky/i)).toBeInTheDocument();
    expect(screen.getByText(/model one free-body diagram before partner practice/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /expand/i })).toBeInTheDocument();
  });

  it("shows compact metadata and subtle refreshing state while keeping stale summary visible", () => {
    render(
      <AdaptiveTeachingBriefWidget
        state={makeState({
          status: "generating",
          isStale: true,
          isRefreshing: true,
          generatedAt: "2026-03-23T09:42:00Z",
        })}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText(/refreshing/i)).toBeInTheDocument();
    expect(screen.getByText(/outdated/i)).toBeInTheDocument();
    expect(screen.getByText(/force-pair explanations are still shaky/i)).toBeInTheDocument();
  });

  it("reveals detailed sections when expanded", async () => {
    const user = userEvent.setup();

    render(
      <AdaptiveTeachingBriefWidget state={makeState()} onRefresh={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: /expand/i }));

    expect(screen.getByText(/what needs attention/i)).toBeInTheDocument();
    expect(screen.getByText(/likely misconceptions/i)).toBeInTheDocument();
    expect(screen.getByText(/who to watch/i)).toBeInTheDocument();
    expect(screen.getByText(/suggested next step/i)).toBeInTheDocument();
    expect(screen.getByText(/recommended follow-up activity/i)).toBeInTheDocument();
    expect(screen.getByText(/evidence basis/i)).toBeInTheDocument();
  });

  it("keeps stale content visible on a soft error", () => {
    render(
      <AdaptiveTeachingBriefWidget
        state={makeState({
          status: "error",
          isStale: true,
          error: "Refresh failed.",
        })}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText(/refresh failed/i)).toBeInTheDocument();
    expect(screen.getByText(/force-pair explanations are still shaky/i)).toBeInTheDocument();
  });

  it("triggers one background refresh on mount when the brief is stale", async () => {
    vi.mocked(refreshClassTeachingBrief).mockResolvedValue(
      makeState({
        status: "ready",
        isStale: false,
        isRefreshing: false,
      }),
    );

    render(
      <AdaptiveTeachingBriefWidget
        classId="11111111-1111-1111-1111-111111111111"
        state={makeState({
          status: "ready",
          isStale: true,
          isRefreshing: false,
          generatedAt: "2026-03-23T09:42:00Z",
        })}
      />,
    );

    await waitFor(() => {
      expect(refreshClassTeachingBrief).toHaveBeenCalledTimes(1);
    });
    expect(refreshClassTeachingBrief).toHaveBeenCalledWith(
      "11111111-1111-1111-1111-111111111111",
    );
  });

  it("falls back to refreshClassTeachingBrief when Refresh brief is clicked without onRefresh", async () => {
    const user = userEvent.setup();
    vi.mocked(refreshClassTeachingBrief).mockResolvedValue(
      makeState({
        summary: undefined,
      } as never),
    );

    render(
      <AdaptiveTeachingBriefWidget
        classId="11111111-1111-1111-1111-111111111111"
        state={makeState()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /refresh brief/i }));

    expect(refreshClassTeachingBrief).toHaveBeenCalledWith(
      "11111111-1111-1111-1111-111111111111",
    );
  });

  it("does not auto-refresh repeatedly after a failed stale refresh", async () => {
    vi.mocked(refreshClassTeachingBrief).mockResolvedValue(
      makeState({
        status: "error",
        isStale: true,
        isRefreshing: false,
        error: "Refresh failed.",
      }),
    );

    render(
      <AdaptiveTeachingBriefWidget
        classId="11111111-1111-1111-1111-111111111111"
        state={makeState({
          isStale: true,
          isRefreshing: false,
          generatedAt: "2026-03-23T09:42:00Z",
        })}
      />,
    );

    await waitFor(() => {
      expect(refreshClassTeachingBrief).toHaveBeenCalledTimes(1);
    });
  });

  it("renders name-only students-to-watch entries when expanded", async () => {
    const user = userEvent.setup();

    render(
      <AdaptiveTeachingBriefWidget
        state={makeState({
          payload: {
            ...makeState().payload!,
            studentsToWatch: [{ studentId: "", displayName: "Jordan K.", reason: "" }],
          },
        })}
        onRefresh={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /expand/i }));

    expect(screen.getByText(/jordan k/i)).toBeInTheDocument();
  });

  it("shows a compact error state when a refresh request rejects and no payload exists", async () => {
    const user = userEvent.setup();
    vi.mocked(refreshClassTeachingBrief).mockRejectedValue(new Error("Network broke"));

    render(
      <AdaptiveTeachingBriefWidget
        classId="11111111-1111-1111-1111-111111111111"
        state={makeState({
          status: "empty",
          generatedAt: null,
          payload: null,
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: /create today's brief/i }));

    await waitFor(() => {
      expect(screen.getByText(/network broke/i)).toBeInTheDocument();
    });
  });
});



