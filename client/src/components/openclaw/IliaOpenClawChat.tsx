import { useEffect, useRef, useState } from "react";
import { Send, Loader2, Zap, AlertCircle } from "lucide-react";

type ChatMessage = { id: string; role: "user" | "assistant"; content: string; streaming?: boolean };
type GatewayInfo = { token: string; wsUrl: string; userId: string };

export function IliaOpenClawChat() {
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const nextIdRef = useRef(1);
  const pendingRunRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    let closed = false;
    let ws: WebSocket | null = null;

    (async () => {
      setStatus("connecting");
      try {
        const res = await fetch("/api/openclaw/gateway-token", { credentials: "include" });
        if (!res.ok) throw new Error(`Token fetch failed: ${res.status}`);
        const info: GatewayInfo = await res.json();

        if (closed) return;
        ws = new WebSocket(info.wsUrl);
        wsRef.current = ws;

        ws.addEventListener("open", () => {
          const id = nextIdRef.current++;
          ws!.send(JSON.stringify({
            type: "request",
            id,
            method: "connect",
            params: { client: { name: "iliagpt-chat", role: "control" }, auth: { token: info.token } },
          }));
        });

        ws.addEventListener("message", (ev) => {
          let msg: any;
          try { msg = JSON.parse(ev.data); } catch { return; }

          if (msg.type === "res" && msg.id === 1) {
            if (msg.ok && msg.payload?.auth?.accepted) {
              setStatus("connected");
            } else {
              setStatus("error");
              setErrMsg("No se pudo autenticar el gateway");
            }
            return;
          }

          if (msg.type === "event" && msg.event === "chat") {
            const state = msg.payload?.state;
            const text = msg.payload?.message?.content?.[0]?.text || "";
            const runId = msg.payload?.runId;

            if (state === "delta") {
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last && last.role === "assistant" && last.streaming && last.id === runId) {
                  return prev.slice(0, -1).concat({ ...last, content: text });
                }
                return prev.concat({ id: runId, role: "assistant", content: text, streaming: true });
              });
            } else if (state === "final") {
              setMessages((prev) => prev.map((m) => (m.id === runId ? { ...m, content: text, streaming: false } : m)));
              setSending(false);
              pendingRunRef.current = null;
            } else if (state === "error") {
              const err = msg.payload?.error?.message || msg.payload?.message || "Error en el chat";
              setMessages((prev) => prev.concat({ id: runId || `err-${Date.now()}`, role: "assistant", content: `⚠️ ${err}` }));
              setSending(false);
              pendingRunRef.current = null;
            }
          }
        });

        ws.addEventListener("error", () => { setStatus("error"); setErrMsg("WebSocket error"); });
        ws.addEventListener("close", () => { if (!closed) { setStatus("error"); setErrMsg("Conexión cerrada"); } });
      } catch (err: any) {
        setStatus("error");
        setErrMsg(err?.message || "Error al conectar");
      }
    })();

    return () => {
      closed = true;
      try { ws?.close(); } catch {}
    };
  }, []);

  const send = () => {
    const text = input.trim();
    if (!text || sending || status !== "connected" || !wsRef.current) return;
    const userId = `u-${Date.now()}`;
    setMessages((prev) => prev.concat({ id: userId, role: "user", content: text }));
    setInput("");
    setSending(true);
    const reqId = nextIdRef.current++;
    wsRef.current.send(JSON.stringify({
      type: "request",
      id: reqId,
      method: "chat.send",
      params: {
        sessionKey: "main",
        message: { role: "user", content: [{ type: "text", text }] },
      },
    }));
  };

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="flex items-center justify-between px-4 py-2 border-b text-xs">
        <div className="flex items-center gap-2">
          <Zap className="h-3.5 w-3.5 text-red-500" />
          <span className="font-medium">OpenClaw Chat (nativo iliagpt)</span>
        </div>
        <div className="flex items-center gap-2">
          {status === "connecting" && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> conectando
            </span>
          )}
          {status === "connected" && (
            <span className="flex items-center gap-1 text-emerald-500">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> en línea
            </span>
          )}
          {status === "error" && (
            <span className="flex items-center gap-1 text-red-500" title={errMsg || ""}>
              <AlertCircle className="h-3 w-3" /> {errMsg || "error"}
            </span>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        {messages.length === 0 && status === "connected" && (
          <div className="text-center text-sm text-muted-foreground py-16">
            <p>Chat conectado a OpenClaw. Escribí un mensaje para empezar.</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                "max-w-[75%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap " +
                (m.role === "user"
                  ? "bg-black text-white dark:bg-white dark:text-black"
                  : "bg-muted")
              }
            >
              {m.content}
              {m.streaming && <span className="inline-block w-2 h-4 bg-current opacity-40 animate-pulse ml-1 rounded" />}
            </div>
          </div>
        ))}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); send(); }}
        className="border-t p-3 flex items-end gap-2"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          placeholder={status === "connected" ? "Escribí tu mensaje…" : "Conectando…"}
          disabled={status !== "connected" || sending}
          rows={1}
          className="flex-1 resize-none rounded-2xl border border-border bg-background px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-red-500/40 disabled:opacity-50"
          data-testid="openclaw-native-input"
        />
        <button
          type="submit"
          disabled={!input.trim() || status !== "connected" || sending}
          className="h-10 w-10 shrink-0 rounded-full bg-red-500 text-white flex items-center justify-center disabled:opacity-40 hover:bg-red-600 transition-colors"
          data-testid="openclaw-native-send"
          aria-label="Enviar"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </form>
    </div>
  );
}
