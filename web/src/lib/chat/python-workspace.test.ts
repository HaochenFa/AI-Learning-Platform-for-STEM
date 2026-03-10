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
});
