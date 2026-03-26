"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";

const GUEST_LIMITS = {
  chat: {
    column: "chat_messages_used",
    limit: 50,
    label: "chat messages",
  },
  quiz: {
    column: "quiz_generations_used",
    limit: 5,
    label: "quiz generations",
  },
  flashcards: {
    column: "flashcard_generations_used",
    limit: 10,
    label: "flashcard generations",
  },
  blueprint: {
    column: "blueprint_regenerations_used",
    limit: 3,
    label: "blueprint regenerations",
  },
  embedding: {
    column: null,
    limit: 0,
    label: "embedding operations",
  },
} as const;

export type GuestFeature = keyof typeof GUEST_LIMITS;

type RateLimitResult =
  | { allowed: true }
  | {
      allowed: false;
      message: string;
    };

export async function checkGuestRateLimit(
  sandboxId: string,
  feature: GuestFeature,
): Promise<RateLimitResult> {
  const config = GUEST_LIMITS[feature];

  if (!config.column) {
    return {
      allowed: false,
      message: `Guest mode does not support ${config.label}. Create a free account to continue.`,
    };
  }

  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from("guest_sandboxes")
    .select(config.column)
    .eq("id", sandboxId)
    .maybeSingle<Record<string, number>>();

  const used = data?.[config.column] ?? 0;
  if (used >= config.limit) {
    return {
      allowed: false,
      message: `You've used all ${config.limit} guest ${config.label}. Create a free account to keep going.`,
    };
  }

  return { allowed: true };
}

export async function incrementGuestUsage(
  sandboxId: string,
  feature: Exclude<GuestFeature, "embedding">,
): Promise<void> {
  const supabase = await createServerSupabaseClient();
  await supabase.rpc("increment_guest_ai_usage", {
    p_sandbox_id: sandboxId,
    p_feature: feature,
  });
}
