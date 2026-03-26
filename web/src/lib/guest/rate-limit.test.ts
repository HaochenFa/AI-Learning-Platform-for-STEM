import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(),
}));

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { checkGuestRateLimit, incrementGuestUsage } from "./rate-limit";

function makeSupabase(counterRow: Record<string, number>, options?: {
  maybeSingleError?: { message: string } | null;
  rpcError?: { message: string } | null;
}) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: counterRow,
      error: options?.maybeSingleError ?? null,
    }),
  };

  const supabase = {
    from: vi.fn().mockReturnValue(builder),
    rpc: vi.fn().mockResolvedValue({ data: null, error: options?.rpcError ?? null }),
  };

  vi.mocked(createServerSupabaseClient).mockResolvedValue(supabase as never);
  return { supabase };
}

describe("checkGuestRateLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows guest chat when usage is below the limit", async () => {
    makeSupabase({ chat_messages_used: 12 });

    const result = await checkGuestRateLimit("sandbox-1", "chat");

    expect(result).toEqual({ allowed: true });
  });

  it("blocks guest chat when usage reaches the limit", async () => {
    makeSupabase({ chat_messages_used: 50 });

    const result = await checkGuestRateLimit("sandbox-1", "chat");

    expect(result.allowed).toBe(false);
    expect(result).toMatchObject({
      message: expect.stringContaining("Create a free account"),
    });
  });

  it("fails closed when the guest usage row cannot be loaded", async () => {
    makeSupabase(
      { chat_messages_used: 0 },
      {
        maybeSingleError: { message: "read failed" },
      },
    );

    const result = await checkGuestRateLimit("sandbox-1", "chat");

    expect(result).toEqual({
      allowed: false,
      message: "We couldn't verify your guest usage right now. Please try again.",
    });
  });

  it("always blocks guest embedding operations", async () => {
    makeSupabase({});

    const result = await checkGuestRateLimit("sandbox-1", "embedding");

    expect(result.allowed).toBe(false);
    expect(result).toMatchObject({
      message: expect.stringContaining("embedding operations"),
    });
  });
});

describe("incrementGuestUsage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("increments the matching usage counter through the sandbox rpc", async () => {
    const { supabase } = makeSupabase({});

    await incrementGuestUsage("sandbox-1", "quiz");

    expect(supabase.rpc).toHaveBeenCalledWith("increment_guest_ai_usage", {
      p_sandbox_id: "sandbox-1",
      p_feature: "quiz",
    });
  });

  it("throws when the guest usage rpc fails", async () => {
    makeSupabase(
      {},
      {
        rpcError: { message: "rpc failed" },
      },
    );

    await expect(incrementGuestUsage("sandbox-1", "quiz")).rejects.toThrow("rpc failed");
  });
});
