import {
  dedupeMessagesByIdentity,
  dedupeRenderableMessages,
  persistedMessageSupersedesOptimistic,
} from "@/lib/chatMessageIdentity";

describe("chatMessageIdentity", () => {
  it("merges optimistic and persisted messages that share request identity", () => {
    const deduped = dedupeMessagesByIdentity([
      {
        id: "temp-user-1",
        clientTempId: "temp-user-1",
        clientRequestId: "cr_1",
        requestId: "req_1",
        role: "user",
        content: "Hola",
        timestamp: "2026-04-06T12:00:00.000Z",
        deliveryStatus: "sending",
      } as any,
      {
        id: "msg_server_1",
        clientTempId: "temp-user-1",
        clientRequestId: "cr_1",
        requestId: "req_1",
        role: "user",
        content: "Hola",
        timestamp: "2026-04-06T12:00:01.000Z",
        deliveryStatus: "sent",
      } as any,
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]).toMatchObject({
      id: "msg_server_1",
      clientTempId: "temp-user-1",
      clientRequestId: "cr_1",
      requestId: "req_1",
      deliveryStatus: "sent",
    });
  });

  it("rewrites assistant userMessageId aliases to the canonical persisted user id", () => {
    const deduped = dedupeMessagesByIdentity([
      {
        id: "temp-user-1",
        clientTempId: "temp-user-1",
        clientRequestId: "cr_1",
        role: "user",
        content: "Hola",
        timestamp: "2026-04-06T12:00:00.000Z",
      } as any,
      {
        id: "assistant-1",
        role: "assistant",
        content: "Respuesta",
        timestamp: "2026-04-06T12:00:02.000Z",
        userMessageId: "temp-user-1",
      } as any,
      {
        id: "msg_server_1",
        clientTempId: "temp-user-1",
        clientRequestId: "cr_1",
        role: "user",
        content: "Hola",
        timestamp: "2026-04-06T12:00:01.000Z",
      } as any,
    ]);

    expect(deduped).toHaveLength(2);
    expect(deduped.find((message) => message.role === "assistant")?.userMessageId).toBe("msg_server_1");
  });

  it("removes render-time assistant duplicates within a 5 second window", () => {
    const deduped = dedupeRenderableMessages([
      {
        id: "assistant-temp",
        role: "assistant",
        content: "Respuesta final",
        timestamp: "2026-04-06T12:00:05.100Z",
      } as any,
      {
        id: "assistant-server",
        role: "assistant",
        content: "Respuesta final",
        timestamp: "2026-04-06T12:00:09.900Z",
      } as any,
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].id).toBe("assistant-server");
  });

  it("dedupes messages that share the same requestId even with distant timestamps", () => {
    const deduped = dedupeRenderableMessages([
      {
        id: "assistant-temp",
        role: "assistant",
        requestId: "req_same",
        content: "Respuesta parcial",
        timestamp: "2026-04-06T12:00:05.100Z",
      } as any,
      {
        id: "assistant-server",
        role: "assistant",
        requestId: "req_same",
        content: "Respuesta final",
        timestamp: "2026-04-06T12:01:05.100Z",
      } as any,
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]).toMatchObject({
      id: "assistant-server",
      requestId: "req_same",
      content: "Respuesta final",
    });
  });

  it("treats assistant replies with the same userMessageId and content as duplicates", () => {
    const deduped = dedupeMessagesByIdentity([
      {
        id: "assistant-local",
        role: "assistant",
        userMessageId: "user_123",
        content: "Hola. Es un gusto saludarte, ¿en qué puedo ayudarte hoy?",
        timestamp: "2026-04-07T00:51:01.000Z",
      } as any,
      {
        id: "assistant-server",
        role: "assistant",
        userMessageId: "user_123",
        content: "Hola. Es un gusto saludarte, ¿en qué puedo ayudarte hoy?",
        timestamp: "2026-04-07T00:51:12.000Z",
      } as any,
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].id).toBe("assistant-server");
  });

  it("removes consecutive assistant duplicates even when they arrive far apart", () => {
    const deduped = dedupeRenderableMessages([
      {
        id: "assistant-first",
        role: "assistant",
        content: "Actualmente estoy esperando tu próxima instrucción.",
        timestamp: "2026-04-07T15:51:01.000Z",
      } as any,
      {
        id: "assistant-second",
        role: "assistant",
        content: "Actualmente estoy esperando tu próxima instrucción.",
        timestamp: "2026-04-07T15:52:18.000Z",
      } as any,
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].id).toBe("assistant-second");
  });

  it("preserves artifact payloads when a duplicate assistant summary arrives without metadata", () => {
    const deduped = dedupeRenderableMessages([
      {
        id: "assistant-rich",
        role: "assistant",
        userMessageId: "user_123",
        content: "Se generaron 2 archivos listos para descargar.",
        timestamp: "2026-04-11T15:36:29.245Z",
        artifact: { artifactId: "artifact-word", type: "document" },
        artifacts: [
          { artifactId: "artifact-word", type: "document" },
          { artifactId: "artifact-excel", type: "spreadsheet" },
        ],
      } as any,
      {
        id: "assistant-empty",
        role: "assistant",
        userMessageId: "user_123",
        content: "Se generaron 2 archivos listos para descargar.",
        timestamp: "2026-04-11T15:36:29.305Z",
      } as any,
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].artifact).toEqual({ artifactId: "artifact-word", type: "document" });
    expect(deduped[0].artifacts).toEqual([
      { artifactId: "artifact-word", type: "document" },
      { artifactId: "artifact-excel", type: "spreadsheet" },
    ]);
  });

  it("does not treat a persisted assistant summary without artifacts as a replacement for a richer optimistic message", () => {
    expect(
      persistedMessageSupersedesOptimistic(
        {
          id: "assistant-rich",
          role: "assistant",
          userMessageId: "user_123",
          content: "Se generaron 2 archivos listos para descargar.",
          artifacts: [
            { artifactId: "artifact-word", type: "document", downloadUrl: "/api/docx" },
            { artifactId: "artifact-excel", type: "spreadsheet", downloadUrl: "/api/xlsx" },
          ],
        } as any,
        {
          id: "assistant-persisted",
          role: "assistant",
          userMessageId: "user_123",
          content: "Se generaron 2 archivos listos para descargar.",
        } as any,
      ),
    ).toBe(false);
  });

  it("allows cleanup once the persisted assistant summary carries the same artifact payload", () => {
    expect(
      persistedMessageSupersedesOptimistic(
        {
          id: "assistant-rich",
          role: "assistant",
          userMessageId: "user_123",
          content: "Se generaron 2 archivos listos para descargar.",
          artifacts: [
            { artifactId: "artifact-word", type: "document", downloadUrl: "/api/docx" },
            { artifactId: "artifact-excel", type: "spreadsheet", downloadUrl: "/api/xlsx" },
          ],
        } as any,
        {
          id: "assistant-persisted",
          role: "assistant",
          userMessageId: "user_123",
          content: "Se generaron 2 archivos listos para descargar.",
          artifacts: [
            { artifactId: "artifact-word", type: "document", downloadUrl: "/api/docx" },
            { artifactId: "artifact-excel", type: "spreadsheet", downloadUrl: "/api/xlsx" },
          ],
        } as any,
      ),
    ).toBe(true);
  });

  it("preserves identical assistant replies when a user message exists between them", () => {
    const deduped = dedupeRenderableMessages([
      {
        id: "assistant-first",
        role: "assistant",
        content: "Listo.",
        timestamp: "2026-04-07T15:51:01.000Z",
      } as any,
      {
        id: "user-middle",
        role: "user",
        content: "Hazlo de nuevo",
        timestamp: "2026-04-07T15:51:20.000Z",
      } as any,
      {
        id: "assistant-second",
        role: "assistant",
        content: "Listo.",
        timestamp: "2026-04-07T15:51:40.000Z",
      } as any,
    ]);

    expect(deduped).toHaveLength(3);
  });
});
