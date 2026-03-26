const SEED_STORAGE_PREFIX = "guest-seed/";

export function buildGuestStoragePath(classId: string, sandboxId: string, filename: string) {
  return `classes/${classId}/sandboxes/${sandboxId}/${filename}`;
}

export function isGuestSafeStoragePath(path: string, sandboxId: string) {
  return (
    path.startsWith(SEED_STORAGE_PREFIX) ||
    path.includes(`/sandboxes/${sandboxId}/`)
  );
}

export function assertGuestSafeSignedUrl(storagePath: string, sandboxId: string) {
  if (!isGuestSafeStoragePath(storagePath, sandboxId)) {
    throw new Error(`Storage path ${storagePath} is not accessible in guest mode.`);
  }
}
