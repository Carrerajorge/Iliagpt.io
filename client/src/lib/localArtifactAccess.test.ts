import { beforeEach, describe, expect, it, vi } from "vitest";
import { downloadArtifact, fetchArtifactResponse } from "./localArtifactAccess";

const apiFetchMock = vi.fn();

vi.mock("@/lib/apiClient", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

describe("localArtifactAccess", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    vi.mocked(global.fetch).mockReset();
  });

  it("routes /api/artifacts requests through apiFetch", async () => {
    const response = new Response("ok", { status: 200 });
    apiFetchMock.mockResolvedValue(response);

    const result = await fetchArtifactResponse("/api/artifacts/report.docx/download");

    expect(apiFetchMock).toHaveBeenCalledWith("/api/artifacts/report.docx/download", undefined);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(result).toBe(response);
  });

  it("prefers the server Content-Disposition filename when downloading office artifacts", async () => {
    const response = new Response(new Blob(["docx-binary"], { type: "application/octet-stream" }), {
      status: 200,
      headers: {
        "Content-Disposition":
          "attachment; filename=\"fallback.docx\"; filename*=UTF-8''administracion-final.docx",
      },
    });
    vi.mocked(global.fetch).mockResolvedValue(response);

    const originalCreateElement = document.createElement.bind(document);
    let createdLink: HTMLAnchorElement | null = null;
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName.toLowerCase() === "a") {
        createdLink = element as HTMLAnchorElement;
      }
      return element;
    }) as typeof document.createElement);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await downloadArtifact("/api/office-engine/runs/run-1/artifacts/exported", "ignored-name.docx");

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/office-engine/runs/run-1/artifacts/exported",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(createdLink?.download).toBe("administracion-final.docx");
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });
});
