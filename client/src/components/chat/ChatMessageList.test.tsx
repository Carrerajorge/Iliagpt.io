import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatMessageList } from "./ChatMessageList";
import type { Message } from "@/hooks/use-chats";

vi.mock("react-virtuoso", () => ({
  Virtuoso: ({ data, itemContent, components }: any) => (
    <div data-testid="virtuoso-mock">
      {data.map((msg: any, index: number) => (
        <div key={msg.id ?? index}>{itemContent(index, msg)}</div>
      ))}
      {components?.Footer ? <components.Footer /> : null}
    </div>
  ),
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

vi.mock("./MessageItem", () => ({
  MessageItem: ({ message }: { message: Message }) => <div>{message.content}</div>,
}));

vi.mock("@/components/suggested-replies", () => ({
  SuggestedReplies: () => null,
  generateSuggestions: () => [],
}));

vi.mock("@/components/markdown-renderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
  MarkdownErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/clientIntentDetector", () => ({
  detectClientIntent: () => undefined,
}));

vi.mock("@/lib/logger", () => ({
  messageLogger: {
    debug: vi.fn(),
  },
}));

describe("ChatMessageList", () => {
  it("renders safely when active steps use title/message instead of legacy step", () => {
    const messages: Message[] = [
      {
        id: "user-1",
        role: "user",
        content: "hola",
        timestamp: new Date(),
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: "respuesta",
        timestamp: new Date(),
      },
    ];

    render(
      <ChatMessageList
        messages={messages}
        variant="default"
        editingMessageId={null}
        editContent=""
        setEditContent={() => {}}
        copiedMessageId={null}
        messageFeedback={{}}
        speakingMessageId={null}
        isGeneratingImage={false}
        pendingGeneratedImage={null}
        latestGeneratedImageRef={{ current: null }}
        streamingContent=""
        aiState="thinking"
        regeneratingMsgIndex={null}
        handleCopyMessage={() => {}}
        handleStartEdit={() => {}}
        handleCancelEdit={() => {}}
        handleSendEdit={() => {}}
        handleFeedback={() => {}}
        handleRegenerate={() => {}}
        handleShare={() => {}}
        handleReadAloud={() => {}}
        handleOpenDocumentPreview={() => {}}
        handleOpenFileAttachmentPreview={() => {}}
        handleDownloadImage={() => {}}
        setLightboxImage={() => {}}
        aiProcessSteps={[
          { status: "active", title: "Buscando contexto" },
          { status: "pending", message: "Generando respuesta" },
        ]}
      />,
    );

    expect(screen.getByText("hola")).toBeInTheDocument();
    expect(screen.getByText("respuesta")).toBeInTheDocument();
    expect(screen.getByText("buscando contexto")).toBeInTheDocument();
  });
});
