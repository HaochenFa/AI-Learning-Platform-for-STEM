"use server";

import { redirect } from "next/navigation";
import { requireVerifiedUser } from "@/lib/auth/session";
import type { CanvasSpec } from "@/lib/chat/types";

export type BloomLevel = "remember" | "understand" | "apply" | "analyze" | "evaluate" | "create";

export type ClassInsightsPayload = {
  generated_at: string;
  class_summary: {
    student_count: number;
    avg_score: number;
    completion_rate: number;
    at_risk_count: number;
    avg_chat_messages: number;
    is_empty: boolean;
  };
  topics: Array<{
    topic_id: string;
    title: string;
    bloom_levels: BloomLevel[];
    avg_score: number;
    attempt_count: number;
    status: "good" | "warning" | "critical";
  }>;
  bloom_breakdown: Partial<Record<BloomLevel, number | null>>;
  students: Array<{
    student_id: string;
    display_name: string;
    avg_score: number;
    completion_rate: number;
    chat_message_count: number;
    risk_level: "low" | "medium" | "high";
    activity_breakdown: Array<{
      activity_id: string;
      title: string;
      score: number;
      attempts: number;
    }>;
    ai_mini_summary: string | null;
  }>;
  ai_narrative: {
    executive_summary: string;
    key_findings: string[];
    interventions: Array<{
      type: "generate_quiz";
      topic_id: string;
      topic_title: string;
      reason: string;
      suggested_action: string;
    }>;
  } | null;
};

export type InsightsResult =
  | { ok: true; data: ClassInsightsPayload }
  | { ok: false; error: string };

export async function getClassInsights(
  classId: string,
  forceRefresh = false,
): Promise<InsightsResult> {
  let userId: string;
  try {
    const auth = await requireVerifiedUser({ accountType: "teacher" });
    userId = auth.user.id;
  } catch {
    redirect("/login");
  }

  const baseUrl = process.env.PYTHON_BACKEND_URL?.trim();
  if (!baseUrl) {
    return { ok: false, error: "Backend not configured." };
  }

  const apiKey = process.env.PYTHON_BACKEND_API_KEY?.trim();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);

  try {
    const response = await fetch(
      `${baseUrl.replace(/\/+$/, "")}/v1/analytics/class-insights`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
        body: JSON.stringify({
          user_id: userId,
          class_id: classId,
          force_refresh: forceRefresh,
        }),
        signal: controller.signal,
      },
    );

    clearTimeout(timer);

    type Envelope = { ok?: boolean; data?: ClassInsightsPayload; error?: { message?: string } };
    const payload = (await response.json().catch(() => null)) as Envelope | null;

    if (!response.ok || !payload?.ok || !payload.data) {
      return {
        ok: false,
        error: payload?.error?.message ?? `Insights request failed (${response.status}).`,
      };
    }

    return { ok: true, data: payload.data };
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: "Insights request timed out. Please try again." };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to load class insights.",
    };
  }
}

export type DataQueryResult =
  | { ok: true; spec: CanvasSpec }
  | { ok: false; error: string };

export async function queryClassData(
  classId: string,
  query: string,
): Promise<DataQueryResult> {
  const safeQuery = query.trim().slice(0, 500);
  if (!safeQuery) {
    return { ok: false, error: "Query cannot be empty." };
  }

  let userId: string;
  try {
    const auth = await requireVerifiedUser({ accountType: "teacher" });
    userId = auth.user.id;
  } catch {
    redirect("/login");
  }

  const baseUrl = process.env.PYTHON_BACKEND_URL?.trim();
  if (!baseUrl) {
    return { ok: false, error: "Backend not configured." };
  }

  const apiKey = process.env.PYTHON_BACKEND_API_KEY?.trim();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(
      `${baseUrl.replace(/\/+$/, "")}/v1/analytics/data-query`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
        body: JSON.stringify({
          user_id: userId,
          class_id: classId,
          query: safeQuery,
        }),
        signal: controller.signal,
      },
    );

    clearTimeout(timer);

    type Envelope = { ok?: boolean; data?: { spec?: CanvasSpec }; error?: { message?: string } };
    const payload = (await response.json().catch(() => null)) as Envelope | null;

    if (!response.ok || !payload?.ok || !payload.data?.spec) {
      return {
        ok: false,
        error: payload?.error?.message ?? `Data query request failed (${response.status}).`,
      };
    }

    return { ok: true, spec: payload.data.spec };
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: "Data query request timed out. Please try again." };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to query class data.",
    };
  }
}
