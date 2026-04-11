import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AssistantMessage } from "../AssistantMessage";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock("@/hooks/use-chats", () => ({
  getGeneratedImage: vi.fn(() => undefined),
  storeGeneratedImage: vi.fn(),
  storeLastGeneratedImageInfo: vi.fn(),
}));

vi.mock("@/stores/super-agent-store", () => ({
  useSuperAgentRun: vi.fn(() => null),
}));

vi.mock("@/components/markdown-renderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
  MarkdownErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ui/uncertainty-badge", () => ({
  UncertaintyBadge: () => null,
}));

vi.mock("@/components/ui/verification-badge", () => ({
  VerificationBadge: () => null,
}));

vi.mock("@/components/super-agent-display", () => ({
  SuperAgentDisplay: () => null,
}));

vi.mock("@/components/retrieval-vis", () => ({
  RetrievalVis: () => null,
}));

vi.mock("@/components/news-cards", () => ({
  NewsCards: () => null,
}));

vi.mock("@/components/code-execution-block", () => ({
  CodeExecutionBlock: () => null,
}));

vi.mock("@/components/artifact-viewer", () => ({
  ArtifactViewer: () => null,
}));

vi.mock("@/components/figma-block", () => ({
  FigmaBlock: () => null,
}));

vi.mock("@/components/inline-google-form-preview", () => ({
  InlineGoogleFormPreview: () => null,
}));

vi.mock("@/components/inline-gmail-preview", () => ({
  InlineGmailPreview: () => null,
}));

vi.mock("@/components/FilePreviewSurface", () => ({
  FilePreviewSurface: () => <div data-testid="file-preview-surface" />,
}));

vi.mock("@/lib/filePreviewTypes", () => ({
  isRenderablePreview: (preview: any) => Boolean(preview?.html),
}));

vi.mock("@/components/office/OfficeStepsPanel", () => ({
  OfficeStepsPanel: () => <div data-testid="office-steps-panel" />,
}));

vi.mock("@/components/sources-panel", () => ({
  SourcesPanel: () => null,
}));

vi.mock("@/contexts/PlatformSettingsContext", () => ({
  usePlatformSettings: () => ({ settings: { timezone_default: "America/La_Paz" } }),
}));

vi.mock("@/contexts/SettingsContext", () => ({
  useSettingsContext: () => ({ settings: { codeInterpreter: false } }),
}));

vi.mock("@/components/ilia-ad-banner", () => ({
  IliaAdBanner: () => null,
}));

vi.mock("@/lib/localArtifactAccess", () => ({
  downloadArtifact: vi.fn(() => Promise.resolve()),
}));

vi.mock("../MessageParts", () => ({
  parseDocumentBlocks: (content: string) => ({ text: content, documents: [] }),
  extractCodeBlocks: () => [],
  formatMessageTime: () => "15:22",
  CleanDataTableComponents: () => null,
  AttachmentList: () => null,
  ActionToolbar: () => null,
}));

vi.mock("../AgentRunContent", () => ({
  AgentRunContent: () => null,
}));

vi.mock("../AgentRunTimeline", () => ({
  AgentRunTimeline: () => null,
}));

vi.mock("../AgentStateIndicator", () => ({
  AgentStateIndicator: () => null,
}));

describe("AssistantMessage", () => {
  it("rerenders when artifact metadata is added after the initial assistant summary", () => {
    const baseProps = {
      msgIndex: 0,
      totalMessages: 1,
      assistantMsgNumber: 1,
      variant: "default" as const,
      copiedMessageId: null,
      messageFeedback: {},
      speakingMessageId: null,
      aiState: "idle" as const,
      isRegenerating: false,
      isGeneratingImage: false,
      pendingGeneratedImage: null,
      latestGeneratedImageRef: { current: null },
      onCopyMessage: () => {},
      onFeedback: () => {},
      onRegenerate: () => {},
      onShare: () => {},
      onReadAloud: () => {},
      onOpenDocumentPreview: () => {},
      onDownloadImage: () => {},
      onOpenLightbox: () => {},
      onReopenDocument: () => {},
    };
    const initialMessage = {
      id: "assistant-late-artifacts",
      role: "assistant" as const,
      content: "Se generaron 2 archivos listos para descargar.",
      timestamp: new Date("2026-04-11T15:22:00.000Z"),
    };

    const { rerender } = render(
      <AssistantMessage
        {...baseProps}
        message={initialMessage}
      />,
    );

    expect(screen.queryByText("Documento Word")).not.toBeInTheDocument();

    rerender(
      <AssistantMessage
        {...baseProps}
        message={{
          ...initialMessage,
          artifacts: [
            {
              artifactId: "artifact-word",
              type: "document",
              mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              downloadUrl: "/api/office-engine/runs/run-docx/artifacts/exported",
              previewUrl: "/api/office-engine/runs/run-docx/artifacts/preview",
              previewHtml: "<article>word preview</article>",
              filename: "mercado.docx",
              name: "mercado.docx",
            },
            {
              artifactId: "artifact-excel",
              type: "spreadsheet",
              mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              downloadUrl: "/api/office-engine/runs/run-xlsx/artifacts/exported",
              previewUrl: "/api/office-engine/runs/run-xlsx/artifacts/preview",
              previewHtml: "<section>excel preview</section>",
              filename: "ventas.xlsx",
              name: "ventas.xlsx",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Documento Word")).toBeInTheDocument();
    expect(screen.getByText("Hoja de cálculo Excel")).toBeInTheDocument();
  });

  it("renders multiple document artifacts and routes preview actions per artifact", () => {
    const onReopenDocument = vi.fn();

    render(
      <AssistantMessage
        message={{
          id: "assistant-1",
          role: "assistant",
          content: "Se generaron 2 archivos listos para descargar.",
          timestamp: new Date("2026-04-11T15:22:00.000Z"),
          artifacts: [
            {
              artifactId: "artifact-word",
              type: "document",
              mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              downloadUrl: "/api/office-engine/runs/run-docx/artifacts/exported",
              previewUrl: "/api/office-engine/runs/run-docx/artifacts/preview",
              previewHtml: "<article>word preview</article>",
              filename: "mercado.docx",
              name: "mercado.docx",
              metadata: { officeRunId: "run-docx" },
            },
            {
              artifactId: "artifact-excel",
              type: "spreadsheet",
              mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              downloadUrl: "/api/office-engine/runs/run-xlsx/artifacts/exported",
              previewUrl: "/api/office-engine/runs/run-xlsx/artifacts/preview",
              previewHtml: "<section>excel preview</section>",
              filename: "ventas.xlsx",
              name: "ventas.xlsx",
              metadata: { officeRunId: "run-xlsx" },
            },
          ],
        }}
        msgIndex={0}
        totalMessages={1}
        assistantMsgNumber={1}
        variant="default"
        copiedMessageId={null}
        messageFeedback={{}}
        speakingMessageId={null}
        aiState="idle"
        isRegenerating={false}
        isGeneratingImage={false}
        pendingGeneratedImage={null}
        latestGeneratedImageRef={{ current: null }}
        onCopyMessage={() => {}}
        onFeedback={() => {}}
        onRegenerate={() => {}}
        onShare={() => {}}
        onReadAloud={() => {}}
        onOpenDocumentPreview={() => {}}
        onDownloadImage={() => {}}
        onOpenLightbox={() => {}}
        onReopenDocument={onReopenDocument}
      />,
    );

    expect(screen.getByText("Documento Word")).toBeInTheDocument();
    expect(screen.getByText("Hoja de cálculo Excel")).toBeInTheDocument();
    expect(screen.getAllByText("Ver")).toHaveLength(2);
    expect(screen.getAllByText("Preview")).toHaveLength(2);
    expect(screen.getAllByText("Descargar")).toHaveLength(2);
    expect(screen.getAllByTestId("file-preview-surface")).toHaveLength(2);

    fireEvent.click(screen.getAllByText("Ver")[1]);

    expect(onReopenDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "excel",
        fileName: "ventas.xlsx",
        downloadUrl: "/api/office-engine/runs/run-xlsx/artifacts/exported",
      }),
    );
  });
});
