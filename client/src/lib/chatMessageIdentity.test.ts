import {
  dedupeMessagesByIdentity,
  dedupeRenderableMessages,
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

  it("removes render-time duplicates with same role, content and second bucket", () => {
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
        timestamp: "2026-04-06T12:00:05.900Z",
      } as any,
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].id).toBe("assistant-server");
  });
});
