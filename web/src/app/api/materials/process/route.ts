import { NextResponse } from "next/server";

export const runtime = "nodejs";

const JOB_BATCH_SIZE = Number(process.env.MATERIAL_JOB_BATCH ?? 3);

async function handleProcessRequest(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const provided = getCronSecretFromRequest(req);
    if (provided !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  return proxyMaterialProcessToPython();
}

async function proxyMaterialProcessToPython() {
  const baseUrl = process.env.PYTHON_BACKEND_URL?.trim();
  if (!baseUrl) {
    return NextResponse.json(
      { error: "PYTHON_BACKEND_URL is not configured." },
      { status: 500 },
    );
  }

  const apiKey = process.env.PYTHON_BACKEND_API_KEY?.trim();
  const timeoutMs = resolvePythonMaterialTimeoutMs();
  let didTimeout = false;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/v1/materials/process`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
      body: JSON.stringify({
        batch_size: JOB_BATCH_SIZE,
      }),
      signal: controller.signal,
    });
    const payload = await safeJson(response);
    if (!response.ok || !payload?.ok || !payload.data) {
      return NextResponse.json(
        {
          error:
            payload?.error?.message ??
            `Python backend material processing failed with status ${response.status}.`,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      processed: payload.data.processed ?? 0,
      failures: Array.isArray(payload.data.errors) ? payload.data.errors : [],
      succeeded: payload.data.succeeded ?? 0,
      failed: payload.data.failed ?? 0,
      retried: payload.data.retried ?? 0,
    });
  } catch (error) {
    if (didTimeout || (error instanceof Error && error.name === "AbortError")) {
      return NextResponse.json(
        { error: `Python backend material processing timed out after ${timeoutMs}ms.` },
        { status: 504 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Python backend material processing failed." },
      { status: 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}

function resolvePythonMaterialTimeoutMs() {
  const parsed = Number(process.env.PYTHON_BACKEND_MATERIAL_TIMEOUT_MS ?? "15000");
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 15000;
  }
  return Math.floor(parsed);
}

async function safeJson(response: Response) {
  try {
    return (await response.json()) as {
      ok?: boolean;
      data?: {
        processed?: number;
        succeeded?: number;
        failed?: number;
        retried?: number;
        errors?: string[];
      };
      error?: {
        message?: string;
      };
    };
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  return handleProcessRequest(req);
}

export async function POST(req: Request) {
  return handleProcessRequest(req);
}

function getCronSecretFromRequest(req: Request) {
  const headerSecret = req.headers.get("x-cron-secret");
  if (headerSecret) {
    return headerSecret;
  }

  const authorization = req.headers.get("authorization");
  if (!authorization) {
    return null;
  }
  const match = authorization.match(/^Bearer\s+(.+?)\s*$/i);
  return match?.[1]?.trim() ?? null;
}
