import "server-only";

export type PythonBackendMode = "python_only";

export function isPythonOnlyMode() {
  return resolvePythonBackendEnabled();
}

export function resolvePythonBackendEnabled() {
  return Boolean(process.env.PYTHON_BACKEND_URL?.trim());
}

export function resolvePythonBackendStrict() {
  return resolvePythonBackendEnabled();
}

export function normalizeBooleanEnv(value: string | undefined, fallback: boolean) {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}
