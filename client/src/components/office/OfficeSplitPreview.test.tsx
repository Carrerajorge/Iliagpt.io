import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OfficeSplitPreview } from "./OfficeSplitPreview";

const downloadArtifactMock = vi.fn();
const documentPreviewMock = vi.fn();

vi.mock("@/lib/localArtifactAccess", () => ({
  downloadArtifact: (...args: unknown[]) => downloadArtifactMock(...args),
}));

vi.mock("@/components/document/DocumentPreview", () => ({
  DocumentPreview: (props: unknown) => {
    documentPreviewMock(props);
    return <div data-testid="document-preview-mock" />;
  },
}));

describe("OfficeSplitPreview", () => {
  beforeEach(() => {
    downloadArtifactMock.mockReset();
    documentPreviewMock.mockReset();
  });

  it("renders split preview metadata and wires the structured preview to DocumentPreview", () => {
    render(
      <OfficeSplitPreview
        document={{
          type: "word",
          title: "Administracion IA",
          previewUrl: "/api/office-engine/runs/run-1/artifacts/preview",
          downloadUrl: "/api/office-engine/runs/run-1/artifacts/exported",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          fileName: "administracion-ia.docx",
        }}
        onClose={() => {}}
      />,
    );

    expect(screen.getByTestId("chat-artifact-split-preview")).toBeInTheDocument();
    expect(screen.getByText("Administracion IA")).toBeInTheDocument();
    expect(screen.getByText(/wordprocessingml\.document/i)).toBeInTheDocument();
    expect(documentPreviewMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/office-engine/runs/run-1/artifacts/preview",
        type: "docx",
        title: "Administracion IA",
        className: "h-full",
      }),
    );
  });

  it("downloads the exported artifact and closes on demand", () => {
    const onClose = vi.fn();

    render(
      <OfficeSplitPreview
        document={{
          type: "excel",
          title: "Administracion IA",
          previewUrl: "/api/office-engine/runs/run-2/artifacts/preview",
          downloadUrl: "/api/office-engine/runs/run-2/artifacts/exported",
          fileName: "administracion-ia.xlsx",
        }}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByTestId("chat-artifact-download-button"));
    expect(downloadArtifactMock).toHaveBeenCalledWith(
      "/api/office-engine/runs/run-2/artifacts/exported",
      "administracion-ia.xlsx",
    );

    fireEvent.click(screen.getByTestId("chat-artifact-close-button"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("passes PPT previewHtml through as a structured pptx preview", () => {
    render(
      <OfficeSplitPreview
        document={{
          type: "ppt",
          title: "Ventas Ejecutivas",
          previewHtml: "<div>Preview PPT ventas CAC</div>",
          downloadUrl: "/api/artifacts/ventas-ejecutivas.pptx",
          fileName: "ventas-ejecutivas.pptx",
        }}
        onClose={() => {}}
      />,
    );

    expect(documentPreviewMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/artifacts/ventas-ejecutivas.pptx",
        type: "pptx",
        html: "<div>Preview PPT ventas CAC</div>",
      }),
    );
  });

  it("falls back to the download URL when previewUrl is missing", () => {
    render(
      <OfficeSplitPreview
        document={{
          type: "pdf",
          title: "Reporte",
          downloadUrl: "/api/artifacts/reporte.pdf",
          fileName: "reporte.pdf",
        }}
        onClose={() => {}}
      />,
    );

    expect(documentPreviewMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/artifacts/reporte.pdf",
        type: "pdf",
      }),
    );
  });

  it("uses the document title as a download fallback when fileName is absent", () => {
    render(
      <OfficeSplitPreview
        document={{
          type: "word",
          title: "Administracion IA",
          previewUrl: "/api/office-engine/runs/run-3/artifacts/preview",
          downloadUrl: "/api/office-engine/runs/run-3/artifacts/exported",
        }}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("chat-artifact-download-button"));

    expect(downloadArtifactMock).toHaveBeenCalledWith(
      "/api/office-engine/runs/run-3/artifacts/exported",
      "Administracion IA",
    );
  });

  it("shows the active preview badge when a preview source exists", () => {
    render(
      <OfficeSplitPreview
        document={{
          type: "word",
          title: "Administracion IA",
          previewUrl: "/api/office-engine/runs/run-4/artifacts/preview",
          downloadUrl: "/api/office-engine/runs/run-4/artifacts/exported",
          fileName: "administracion-ia.docx",
        }}
        onClose={() => {}}
      />,
    );

    expect(screen.getByTestId("chat-artifact-preview-button")).toHaveTextContent("Preview activo");
  });
});
