const SEED_STORAGE_PREFIX = "guest-seed/";

export function buildGuestStoragePath(classId: string, sandboxId: string, filename: string) {
  return `classes/${classId}/sandboxes/${sandboxId}/${filename}`;
}

export function isGuestSafeStoragePath(path: string, sandboxId: string) {
  if (path.startsWith(SEED_STORAGE_PREFIX)) {
    return true;
  }

  const segments = path.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return false;
  }

  return (
    segments.length >= 5 &&
    segments[0] === "classes" &&
    segments[2] === "sandboxes" &&
    segments[3] === sandboxId
  );
}

export function assertGuestSafeSignedUrl(storagePath: string, sandboxId: string) {
  if (!isGuestSafeStoragePath(storagePath, sandboxId)) {
    throw new Error(`Storage path ${storagePath} is not accessible in guest mode.`);
  }
}
