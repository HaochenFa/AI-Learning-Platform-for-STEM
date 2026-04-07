/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";

const pushMock = vi.fn();
const refreshMock = vi.fn();
const uploadToSignedUrlMock = vi.fn();

vi.mock("@/app/classes/actions", () => ({
  prepareMaterialUpload: vi.fn(),
  finalizeMaterialUpload: vi.fn(),
  triggerMaterialProcessing: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
  }),
  usePathname: () => "/classes/class-1",
}));

vi.mock("@/lib/supabase/client", () => ({
  createBrowserSupabaseClient: () => ({
    storage: {
      from: () => ({
        uploadToSignedUrl: uploadToSignedUrlMock,
      }),
    },
  }),
}));

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MaterialUploadForm from "./MaterialUploadForm";
import {
  finalizeMaterialUpload,
  prepareMaterialUpload,
  triggerMaterialProcessing,
} from "@/app/classes/actions";

describe("MaterialUploadForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadToSignedUrlMock.mockResolvedValue({ data: { path: "ok" }, error: null });
  });

  it("keeps failed files visible, removes successful files, and wakes the worker once", async () => {
    const user = userEvent.setup();
    const firstFile = new File(["alpha"], "lecture-a.pdf", { type: "application/pdf" });
    const secondFile = new File(["beta"], "lecture-b.pdf", { type: "application/pdf" });

    vi.mocked(prepareMaterialUpload)
      .mockResolvedValueOnce({
        ok: true,
        materialId: "mat-a",
        storagePath: "classes/class-1/mat-a/lecture-a.pdf",
        signedUrl: "https://storage.example.com/a",
        uploadToken: "token-a",
      })
      .mockResolvedValueOnce({
        ok: true,
        materialId: "mat-b",
        storagePath: "classes/class-1/mat-b/lecture-b.pdf",
        signedUrl: "https://storage.example.com/b",
        uploadToken: "token-b",
      });

    vi.mocked(finalizeMaterialUpload)
      .mockResolvedValueOnce({
        ok: true,
        materialId: "mat-a",
        uploadNotice: "processing",
      })
      .mockResolvedValueOnce({
        ok: false,
        error: "Processing could not be started. Please delete this file and upload it again.",
      });

    vi.mocked(triggerMaterialProcessing).mockResolvedValue({ ok: true });

    render(<MaterialUploadForm classId="class-1" />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, [firstFile, secondFile]);

    await user.click(screen.getByRole("button", { name: /upload 2 files/i }));

    await waitFor(() => {
      expect(screen.getByText("Batch upload finished with issues")).toBeInTheDocument();
    });

    expect(screen.getByText("1 uploaded, 1 failed.")).toBeInTheDocument();
    expect(screen.queryByText("lecture-a.pdf")).not.toBeInTheDocument();
    expect(screen.getByText("lecture-b.pdf")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Processing could not be started. Please delete this file and upload it again.",
      ),
    ).toBeInTheDocument();

    expect(triggerMaterialProcessing).toHaveBeenCalledTimes(1);
    expect(triggerMaterialProcessing).toHaveBeenCalledWith("class-1", 1);
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(pushMock).not.toHaveBeenCalled();
    expect(uploadToSignedUrlMock).toHaveBeenCalledTimes(2);
  });
});
