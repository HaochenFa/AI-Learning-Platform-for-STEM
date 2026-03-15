import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listWorkspaceParticipantsViaPython,
  sendWorkspaceMessageViaPython,
} from "@/lib/chat/python-workspace";

type TimeoutError = Error & { code?: string };

function makeAbortablePendingFetch() {
  return vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      const onAbort = () => {
        const abortError = new Error("Aborted");
        abortError.name = "AbortError";
        reject(abortError);
      };

      if (signal?.aborted) {
        onAbort();
        return;
      }

      signal?.addEventListener("abort", onAbort, { once: true });
    });
  });
}

async function expectTimeout(promise: Promise<unknown>) {
  const handled = promise.catch((value) => value as TimeoutError);
  const error = (await handled) as TimeoutError;
  expect(error.code).toBe("timeout");
  return error.message;
}

describe("python workspace timeout handling", () => {
  beforeEach(() => {
    process.env.PYTHON_BACKEND_URL = "http://localhost:8001";
    delete process.env.PYTHON_BACKEND_API_KEY;
    delete process.env.PYTHON_BACKEND_MATERIAL_TIMEOUT_MS;
    delete process.env.PYTHON_BACKEND_CHAT_TIMEOUT_MS;
    delete process.env.PYTHON_BACKEND_CHAT_ENGINE;
    delete process.env.PYTHON_BACKEND_CHAT_TOOL_MODE;
    delete process.env.PYTHON_BACKEND_CHAT_TOOL_CATALOG;
    delete process.env.AI_REQUEST_TIMEOUT_MS;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses chat timeout for workspace message sends", async () => {
    process.env.PYTHON_BACKEND_CHAT_TIMEOUT_MS = "42000";
    process.env.PYTHON_BACKEND_MATERIAL_TIMEOUT_MS = "7000";
    vi.stubGlobal("fetch", makeAbortablePendingFetch());

    const request = sendWorkspaceMessageViaPython({
      classId: "class-1",
      userId: "student-1",
      accessToken: "session-token",
      sessionId: "session-1",
      message: "Help me solve this derivative.",
    });

    const timeoutMessage = expectTimeout(request);
    await vi.advanceTimersByTimeAsync(42000);
    const message = await timeoutMessage;
    expect(message).toContain("42000ms");
  });

  it("keeps material timeout for non-chat workspace requests", async () => {
    process.env.PYTHON_BACKEND_CHAT_TIMEOUT_MS = "42000";
    process.env.PYTHON_BACKEND_MATERIAL_TIMEOUT_MS = "7000";
    vi.stubGlobal("fetch", makeAbortablePendingFetch());

    const request = listWorkspaceParticipantsViaPython({
      classId: "class-1",
      userId: "teacher-1",
      accessToken: "session-token",
    });

    const timeoutMessage = expectTimeout(request);
    await vi.advanceTimersByTimeAsync(7000);
    const message = await timeoutMessage;
    expect(message).toContain("7000ms");
  });

  it("forwards orchestration options for workspace message sends", async () => {
    process.env.PYTHON_BACKEND_CHAT_ENGINE = "langgraph_v1";
    process.env.PYTHON_BACKEND_CHAT_TOOL_MODE = "plan";
    process.env.PYTHON_BACKEND_CHAT_TOOL_CATALOG = "grounding_context.read,web.search";
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({
        ok: true,
        data: {
          response: {
            answer: "Response",
            safety: "ok",
            citations: [],
          },
          user_message: {
            id: "msg-user",
            session_id: body.session_id,
            class_id: body.class_id,
            author_user_id: body.user_id,
            author_kind: "student",
            content: body.message,
            citations: [],
            safety: null,
            provider: null,
            model: null,
            prompt_tokens: null,
            completion_tokens: null,
            total_tokens: null,
            latency_ms: null,
            created_at: "2026-03-13T00:00:00.000Z",
          },
          assistant_message: {
            id: "msg-assistant",
            session_id: body.session_id,
            class_id: body.class_id,
            author_user_id: null,
            author_kind: "assistant",
            content: "Response",
            citations: [],
            safety: "ok",
            provider: "openrouter",
            model: "gpt-5-mini",
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
            latency_ms: 10,
            created_at: "2026-03-13T00:00:01.000Z",
          },
        },
      }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await sendWorkspaceMessageViaPython({
      classId: "class-1",
      userId: "student-1",
      accessToken: "session-token",
      sessionId: "session-1",
      message: "Help me solve this derivative.",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}"));
    expect(requestBody).toMatchObject({
      class_id: "class-1",
      user_id: "student-1",
      session_id: "session-1",
      message: "Help me solve this derivative.",
      tool_mode: "plan",
      tool_catalog: ["grounding_context.read", "web.search"],
      orchestration_hints: expect.objectContaining({
        engine: "langgraph_v1",
      }),
    });
  });
});
