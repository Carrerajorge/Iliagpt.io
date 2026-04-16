import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MessageItem } from "../MessageItem";

vi.mock("../UserMessage", () => ({
  UserMessage: () => <div data-testid="user-message" />,
}));

vi.mock("../AssistantMessage", () => ({
  AssistantMessage: ({ message }: any) => (
    <div data-testid="assistant-message-artifact-count">
      {Array.isArray(message.artifacts) ? message.artifacts.length : message.artifact ? 1 : 0}
    </div>
  ),
}));

function buildProps(message: any) {
  return {
    message,
    msgIndex: 0,
    totalMessages: 1,
    assistantMsgNumber: 1,
    variant: "default" as const,
    editingMessageId: null,
    editContent: "",
    copiedMessageId: null,
    messageFeedback: {},
    speakingMessageId: null,
    isGeneratingImage: false,
    pendingGeneratedImage: null,
    latestGeneratedImageRef: { current: null },
    aiState: "idle" as const,
    regeneratingMsgIndex: null,
    handleCopyMessage: vi.fn(),
    handleStartEdit: vi.fn(),
    handleCancelEdit: vi.fn(),
    handleSendEdit: vi.fn(),
    handleFeedback: vi.fn(),
    handleRegenerate: vi.fn(),
    handleShare: vi.fn(),
    handleReadAloud: vi.fn(),
    handleOpenDocumentPreview: vi.fn(),
    handleOpenFileAttachmentPreview: vi.fn(),
    handleDownloadImage: vi.fn(),
    setLightboxImage: vi.fn(),
    handleReopenDocument: vi.fn(),
    minimizedDocument: null,
    onRestoreDocument: vi.fn(),
    setEditContent: vi.fn(),
    onAgentCancel: vi.fn(),
    onAgentRetry: vi.fn(),
    onAgentArtifactPreview: vi.fn(),
    onSuperAgentCancel: vi.fn(),
    onSuperAgentRetry: vi.fn(),
    onQuestionClick: vi.fn(),
    onUserRetrySend: vi.fn(),
    onToolConfirm: vi.fn(),
    onToolDeny: vi.fn(),
  };
}

describe("MessageItem", () => {
  it("rerenders assistant messages when artifact payloads are added after the initial summary", () => {
    const initialMessage = {
      id: "assistant-1",
      role: "assistant" as const,
      content: "Se generaron 2 archivos listos para descargar.",
      timestamp: new Date("2026-04-11T15:58:00.000Z"),
    };

    const { rerender } = render(<MessageItem {...buildProps(initialMessage)} />);

    expect(screen.getByTestId("assistant-message-artifact-count")).toHaveTextContent("0");

    rerender(
      <MessageItem
        {...buildProps({
          ...initialMessage,
          artifacts: [
            {
              artifactId: "artifact-word",
              type: "document",
              mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              downloadUrl: "/api/office-engine/runs/run-docx/artifacts/exported",
            },
            {
              artifactId: "artifact-excel",
              type: "spreadsheet",
              mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              downloadUrl: "/api/office-engine/runs/run-xlsx/artifacts/exported",
            },
          ],
        })}
      />,
    );

    expect(screen.getByTestId("assistant-message-artifact-count")).toHaveTextContent("2");
  });
});
