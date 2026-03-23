/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";

// ---------- module mocks (must be before component import) ----------
vi.mock("@/app/classes/actions", () => ({
  getMaterialSignedUrl: vi.fn(),
  deleteMaterial: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MaterialActionsMenu } from "./MaterialActionsMenu";
import { getMaterialSignedUrl } from "@/app/classes/actions";

// ---------- fixtures ----------
const pdfMaterial = {
  id: "mat-1",
  title: "Lecture 1.pdf",
  mime_type: "application/pdf",
  status: "ready",
  storage_path: "classes/cls-1/mat-1/lecture-1.pdf",
};

const docxMaterial = {
  id: "mat-2",
  title: "Notes.docx",
  mime_type:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  status: "ready",
  storage_path: "classes/cls-1/mat-2/notes.docx",
};

// ---------- helpers ----------
const FAKE_BLOB_URL = "blob:http://localhost/fake-blob-id";

async function openPreview(user: ReturnType<typeof userEvent.setup>) {
  // Open the dropdown
  const trigger = screen.getByRole("button", { name: "Material actions" });
  await user.click(trigger);

  // Click Preview menu item
  const previewItem = await screen.findByRole("menuitem", { name: /preview/i });
  await user.click(previewItem);
}

// ---------- lifecycle ----------
beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------- tests ----------
describe("MaterialActionsMenu preview flow", () => {
  it("fetches blob and displays iframe with blob URL for PDF preview", async () => {
    const user = userEvent.setup();

    // Use a deferred promise to control when getMaterialSignedUrl resolves,
    // so we can observe the loading state.
    let resolveSignedUrl!: (v: { ok: true; url: string }) => void;
    vi.mocked(getMaterialSignedUrl).mockImplementation(
      () => new Promise((r) => { resolveSignedUrl = r; }),
    );

    render(<MaterialActionsMenu classId="cls-1" material={pdfMaterial} />);
    await openPreview(user);

    // Loading state should appear while waiting for signed URL
    await waitFor(() => {
      expect(screen.getByText(/loading preview/i)).toBeInTheDocument();
    });

    // Now resolve the signed URL and set up fetch + blob mocks
    const blob = new Blob(["fake-pdf-content"], { type: "application/pdf" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(blob),
        headers: new Headers({ "content-length": "1024" }),
      }),
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue(FAKE_BLOB_URL);

    await act(async () => {
      resolveSignedUrl({ ok: true, url: "https://storage.example.com/signed-url" });
    });

    // Wait for iframe with blob URL
    await waitFor(() => {
      const iframe = document.querySelector("iframe");
      expect(iframe).not.toBeNull();
      expect(iframe!.getAttribute("src")).toBe(FAKE_BLOB_URL);
    });

    // iframe must NOT have sandbox attribute (would block PDF rendering)
    const iframe = document.querySelector("iframe")!;
    expect(iframe.hasAttribute("sandbox")).toBe(false);
  });

  it("shows fallback message for non-PDF files", async () => {
    const user = userEvent.setup();

    render(<MaterialActionsMenu classId="cls-1" material={docxMaterial} />);
    await openPreview(user);

    await waitFor(() => {
      expect(
        screen.getByText(/preview is not available for this file type/i),
      ).toBeInTheDocument();
    });
  });

  it("shows error when signed URL generation fails", async () => {
    const user = userEvent.setup();
    vi.mocked(getMaterialSignedUrl).mockResolvedValue({
      ok: false as const,
      error: "Material not found.",
    });

    render(<MaterialActionsMenu classId="cls-1" material={pdfMaterial} />);
    await openPreview(user);

    await waitFor(() => {
      expect(screen.getByText("Material not found.")).toBeInTheDocument();
    });
  });

  it("shows error when file fetch fails", async () => {
    const user = userEvent.setup();
    vi.mocked(getMaterialSignedUrl).mockResolvedValue({
      ok: true as const,
      url: "https://storage.example.com/signed-url",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        headers: new Headers(),
      }),
    );

    render(<MaterialActionsMenu classId="cls-1" material={pdfMaterial} />);
    await openPreview(user);

    await waitFor(() => {
      expect(
        screen.getByText("Failed to load file for preview."),
      ).toBeInTheDocument();
    });
  });

  it("revokes blob URL when dialog closes", async () => {
    const user = userEvent.setup();
    vi.mocked(getMaterialSignedUrl).mockResolvedValue({
      ok: true as const,
      url: "https://storage.example.com/signed-url",
    });
    const blob = new Blob(["fake-pdf"], { type: "application/pdf" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(blob),
        headers: new Headers({ "content-length": "512" }),
      }),
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue(FAKE_BLOB_URL);
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(
      () => {},
    );

    render(<MaterialActionsMenu classId="cls-1" material={pdfMaterial} />);
    await openPreview(user);

    // Wait for iframe to appear (blob loaded)
    await waitFor(() => {
      expect(document.querySelector("iframe")).not.toBeNull();
    });

    // Close the dialog via Escape key
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(revokeSpy).toHaveBeenCalledWith(FAKE_BLOB_URL);
    });
  });
});
