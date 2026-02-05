import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

function randomJoinCode() {
  return `DBG${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      { ok: false, error: userError?.message ?? "No user" },
      { status: 401 },
    );
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const { data: requestingUserId, error: requestingUserIdError } =
    await supabase.rpc("requesting_user_id");

  const joinCode = randomJoinCode();
  const { data, error } = await supabase.rpc("create_class", {
    p_title: "Debug Class",
    p_description: "Debug insert from /api/debug/insert-class",
    p_subject: null,
    p_level: null,
    p_join_code: joinCode,
  });

  let directInsertResult: null | {
    ok: boolean;
    status: number;
    error?: string;
  } = null;
  let directAuthContext: null | {
    ok: boolean;
    status: number;
    data?: unknown;
    error?: string;
  } = null;
  let directRequestingUserIdValue: string | null = null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && anonKey && session?.access_token) {
    try {
      const authRes = await fetch(`${url}/rest/v1/rpc/requesting_user_id`, {
        method: "POST",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      if (!authRes.ok) {
        const text = await authRes.text();
        directAuthContext = { ok: false, status: authRes.status, error: text };
      } else {
        const json = await authRes.json();
        directAuthContext = { ok: true, status: authRes.status, data: json };
      }

      const directData = directAuthContext?.data;
      if (typeof directData === "string") {
        directRequestingUserIdValue = directData;
      } else if (Array.isArray(directData) && typeof directData[0] === "string") {
        directRequestingUserIdValue = directData[0];
      }

      const res = await fetch(`${url}/rest/v1/classes?select=id`, {
        method: "POST",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
          Prefer: "return=representation, missing=default",
        },
        body: JSON.stringify({
          title: "Debug Direct Insert",
          description: "Debug insert via direct fetch",
          join_code: randomJoinCode(),
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        directInsertResult = { ok: false, status: res.status, error: text };
      } else {
        directInsertResult = { ok: true, status: res.status };
      }
    } catch (directError) {
      directInsertResult = {
        ok: false,
        status: 0,
        error: directError instanceof Error ? directError.message : "Direct insert failed",
      };
    }
  }

  if (error || !data) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message ?? "Insert failed",
        code: error?.code ?? null,
        details: error?.details ?? null,
        hint: error?.hint ?? null,
        requestingUserId,
        requestingUserIdError: requestingUserIdError?.message ?? null,
        userId: user.id,
        directInsertResult,
        directAuthContext: directAuthContext
          ? { ok: directAuthContext.ok, status: directAuthContext.status }
          : null,
        directRequestingUserId: directRequestingUserIdValue,
      },
      { status: 400 },
    );
  }

  const { error: deleteError } = await supabase.from("classes").delete().eq("id", data);

  if (deleteError) {
    return NextResponse.json(
      {
        ok: false,
        insertedId: data,
        deleteError: deleteError.message,
        directInsertResult,
        directAuthContext: directAuthContext
          ? { ok: directAuthContext.ok, status: directAuthContext.status }
          : null,
        directRequestingUserId: directRequestingUserIdValue,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    insertedId: data,
    deleteError: null,
    directInsertResult,
    directAuthContext: directAuthContext
      ? { ok: directAuthContext.ok, status: directAuthContext.status }
      : null,
    directRequestingUserId: directRequestingUserIdValue,
  });
}
