import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentPreview } from "./DocumentPreview";

const fetchArtifactResponseMock = vi.fn();
const downloadArtifactMock = vi.fn();
const renderAsyncMock = vi.fn(async (_data, container: HTMLElement) => {
  const content = document.createElement("div");
  content.textContent = "Rendered DOCX preview";
  container.appendChild(content);
});

const filePreviewSurfaceMock = vi.fn(({ preview }: any) => (
  <div data-testid="file-preview-surface-mock">{preview?.html || preview?.type}</div>
));

vi.mock("@/lib/localArtifactAccess", () => ({
  fetchArtifactResponse: (...args: unknown[]) => fetchArtifactResponseMock(...args),
  downloadArtifact: (...args: unknown[]) => downloadArtifactMock(...args),
}));

vi.mock("docx-preview", () => ({
  renderAsync: (...args: unknown[]) => renderAsyncMock(...args),
}));

vi.mock("@/components/FilePreviewSurface", () => ({
  FilePreviewSurface: (props: unknown) => filePreviewSurfaceMock(props),
}));

describe("DocumentPreview", () => {
  beforeEach(() => {
    fetchArtifactResponseMock.mockReset();
    downloadArtifactMock.mockReset();
    renderAsyncMock.mockClear();
    filePreviewSurfaceMock.mockClear();
  });

  it("renders DOCX content into the mounted preview container", async () => {
    fetchArtifactResponseMock.mockResolvedValue(
      new Response(new Blob(["fake-docx"], { type: "application/octet-stream" }), {
        status: 200,
      }),
    );

    render(<DocumentPreview url="/api/office-engine/runs/run-1/artifacts/preview" type="docx" title="Admin" />);

    await waitFor(() => {
      expect(renderAsyncMock).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("document-preview-docx-canvas")).toHaveTextContent(
        "Rendered DOCX preview",
      );
    });
  });

  it("prefers the native DOCX renderer over structured HTML when the file URL exists", async () => {
    fetchArtifactResponseMock.mockResolvedValue(
      new Response(new Blob(["fake-docx"], { type: "application/octet-stream" }), {
        status: 200,
      }),
    );

    render(
      <DocumentPreview
        url="/api/office-engine/runs/run-1/artifacts/repacked"
        type="docx"
        title="Admin"
        html="<article><h1>Vista previa HTML</h1></article>"
      />,
    );

    await waitFor(() => {
      expect(renderAsyncMock).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("document-preview-docx")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("document-preview-html")).not.toBeInTheDocument();
  });

  it("renders HTML previews directly for PPTX artifacts", () => {
    render(
      <DocumentPreview
        url="/api/artifacts/ventas-ejecutivas.pptx"
        type="pptx"
        title="Ventas"
        html="<div>Preview PPT ventas CAC</div>"
      />,
    );

    expect(screen.getByTestId("document-preview-html")).toBeInTheDocument();
    expect(filePreviewSurfaceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        preview: { type: "pptx", html: "<div>Preview PPT ventas CAC</div>" },
        variant: "modal",
      }),
    );
  });

  it("shows an explicit error when no URL is provided and there is no HTML preview", () => {
    render(<DocumentPreview url="" type="pdf" title="Sin URL" />);

    expect(screen.getByTestId("document-preview-error")).toHaveTextContent(
      "No document URL provided",
    );
  });

  it("falls back to an office download card for PPTX files without HTML preview", () => {
    render(
      <DocumentPreview
        url="/api/artifacts/ventas-ejecutivas.pptx"
        type="pptx"
        title="Ventas Ejecutivas"
      />,
    );

    expect(screen.getByTestId("document-preview-office")).toBeInTheDocument();
    expect(screen.getByText(/Preview is not available for/i)).toBeInTheDocument();
  });

  it("downloads fallback office artifacts through the local artifact helper", () => {
    render(
      <DocumentPreview
        url="/api/artifacts/ventas-ejecutivas.pptx"
        type="pptx"
        title="Ventas Ejecutivas"
      />,
    );

    fireEvent.click(screen.getByTestId("button-download-document"));

    expect(downloadArtifactMock).toHaveBeenCalledWith(
      "/api/artifacts/ventas-ejecutivas.pptx",
      "Ventas Ejecutivas.pptx",
    );
  });
});
