# Implementación en Replit: Gmail + MCP (1 documento)

Este documento contiene **instrucciones + TODO el código** para pegar en Replit y tener una app que:

- Busca hilos/mensajes recientes en Gmail
- Trae el contenido completo del hilo
- Convierte HTML a texto cuando sea necesario
- Produce:
  - **Resumen**
  - **Acciones / pendientes**
  - **Temas para reunión**
  - **Borrador de respuesta sugerida**
- (Opcional) Preparado para que luego agregues creación de borrador/envío (por seguridad, este proyecto NO escribe en Gmail por defecto)

> Diseño: tu app en **Python** se conecta a un **servidor MCP de Gmail** ejecutado con `npx`.  
> Requisito: **Node 18+** (recomendado Node 20) y Python 3.11.

---

## 1) Estructura de archivos (créala exactamente así)

En Replit crea estos archivos (misma estructura):

```
.
├─ main.py
├─ gmail_mcp_client.py
├─ email_utils.py
├─ analyzer.py
├─ requirements.txt
├─ .env.example
├─ replit.nix
└─ .replit
```

> IMPORTANTE: No subas credenciales a repos públicos.

---

## 2) Prerrequisitos (Gmail OAuth)

### 2.1 Habilitar Gmail API y crear OAuth Client (una vez)
En Google Cloud Console:
1) Crea/elige proyecto  
2) Habilita **Gmail API**  
3) Crea OAuth Client ID tipo **Desktop app**  
4) Descarga el JSON de credenciales OAuth

### 2.2 Autorizar al usuario (una vez por cuenta Gmail)
Este proyecto usa un servidor MCP de Gmail que maneja OAuth. Lo más simple es:

1) En tu PC (no en Replit), crea una carpeta:
   - `~/.gmail-mcp/`

2) Copia el JSON descargado ahí con este nombre:
   - `~/.gmail-mcp/gcp-oauth.keys.json`

3) Ejecuta el flujo de autorización (abre navegador):
```bash
npx -y @shinzolabs/gmail-mcp auth
```

4) Verifica que se generó algo tipo:
   - `~/.gmail-mcp/credentials.json`

### 2.3 Llevarlo a Replit
En Replit, crea una carpeta dentro del proyecto:
- `./.gmail-mcp/`

Luego **sube** (Upload) estos archivos a esa carpeta:
- `./.gmail-mcp/gcp-oauth.keys.json`
- `./.gmail-mcp/credentials.json`

> Recomendación: guarda estos archivos como **Secrets** o como archivos privados del proyecto.  
> Nunca los publiques.

---

## 3) Configuración en Replit

### 3.1 `replit.nix`
Crea `replit.nix` con Node 20 + Python 3.11:

```nix
{ pkgs }: {
  deps = [
    pkgs.python311
    pkgs.nodejs_20
  ];
}
```

### 3.2 `.replit`
Crea `.replit`:

```ini
run = "python main.py"
```

### 3.3 `requirements.txt`
Crea `requirements.txt`:

```txt
mcp[cli]
python-dotenv
beautifulsoup4
```

### 3.4 Variables de entorno
En Replit puedes usar un archivo `.env` (NO lo subas a repos públicos) o Replit Secrets.

Crea `.env` a partir de `.env.example`.

---

## 4) Código (copiar/pegar)

### 4.1 `.env.example`
```ini
# Carpeta donde pondrás los archivos OAuth/credenciales
# Recomendado en Replit: una carpeta del proyecto
MCP_CONFIG_DIR=./.gmail-mcp

# Comando del servidor MCP de Gmail (se ejecuta como subproceso)
GMAIL_MCP_COMMAND=npx
GMAIL_MCP_ARGS=-y,@shinzolabs/gmail-mcp

# Seguridad: por defecto NO permitimos acciones de escritura (draft/send/modify)
ENABLE_WRITE_ACTIONS=false
```

---

### 4.2 `gmail_mcp_client.py`
```python
import os
from dataclasses import dataclass
from typing import Any, Dict, Optional, List

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


@dataclass
class GmailMcpConfig:
    mcp_config_dir: str
    command: str
    args: List[str]
    extra_env: Dict[str, str]


class GmailMcpClient:
    """
    Cliente MCP (Python) que lanza el servidor Gmail MCP por stdio (subproceso)
    y permite llamar tools como list_threads/get_thread/list_messages/get_message.
    """

    def __init__(self, config: GmailMcpConfig):
        self.config = config
        self._session: Optional[ClientSession] = None
        self._stdio_ctx = None
        self._read = None
        self._write = None

    async def __aenter__(self) -> "GmailMcpClient":
        env = dict(os.environ)
        env["MCP_CONFIG_DIR"] = self.config.mcp_config_dir
        env.update(self.config.extra_env or {})

        server_params = StdioServerParameters(
            command=self.config.command,
            args=self.config.args,
            env=env,
        )

        self._stdio_ctx = stdio_client(server_params)
        self._read, self._write = await self._stdio_ctx.__aenter__()

        self._session = ClientSession(self._read, self._write)
        await self._session.__aenter__()
        await self._session.initialize()
        return self

    async def __aexit__(self, exc_type, exc, tb):
        if self._session:
            await self._session.__aexit__(exc_type, exc, tb)
        if self._stdio_ctx:
            await self._stdio_ctx.__aexit__(exc_type, exc, tb)

    async def list_tools(self) -> Dict[str, Any]:
        assert self._session is not None
        tools = await self._session.list_tools()
        return {t.name: t for t in tools.tools}

    async def call_tool(self, name: str, arguments: Optional[Dict[str, Any]] = None) -> Any:
        assert self._session is not None
        result = await self._session.call_tool(name, arguments=arguments or {})
        # structuredContent si el server lo provee
        if result.structuredContent is not None:
            return result.structuredContent
        # fallback: concatena texto
        texts = []
        for block in result.content:
            if hasattr(block, "text"):
                texts.append(block.text)
            else:
                texts.append(str(block))
        return "\n".join(texts)

    # Helpers “amigables”
    async def list_threads(self, q: str, max_results: int = 10) -> Any:
        return await self.call_tool("list_threads", {"q": q, "maxResults": max_results})

    async def get_thread(self, thread_id: str, fmt: str = "full") -> Any:
        return await self.call_tool("get_thread", {"id": thread_id, "format": fmt})

    async def list_messages(self, q: str, max_results: int = 10) -> Any:
        return await self.call_tool("list_messages", {"q": q, "maxResults": max_results})

    async def get_message(self, message_id: str, fmt: str = "full") -> Any:
        return await self.call_tool("get_message", {"id": message_id, "format": fmt})
```

---

### 4.3 `email_utils.py`
```python
import base64
from typing import Any, Dict, List
from bs4 import BeautifulSoup


def _b64url_decode(data: str) -> bytes:
    # Gmail usa base64url sin padding a veces
    data = data.replace("-", "+").replace("_", "/")
    padding = "=" * ((4 - len(data) % 4) % 4)
    return base64.b64decode(data + padding)


def html_to_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    text = soup.get_text("\n")
    lines = [ln.strip() for ln in text.splitlines()]
    lines = [ln for ln in lines if ln]
    return "\n".join(lines)


def _walk_parts(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    parts: List[Dict[str, Any]] = []
    if not payload:
        return parts
    if "parts" in payload and isinstance(payload["parts"], list):
        for p in payload["parts"]:
            parts.extend(_walk_parts(p))
    else:
        parts.append(payload)
    return parts


def extract_best_text_from_message(message: Dict[str, Any]) -> str:
    """
    Extrae texto del resource Gmail (message) típico del Gmail API:
    message.payload.mimeType, payload.body.data, payload.parts...
    Prioriza text/plain, luego text/html.
    """
    payload = message.get("payload") or {}
    all_parts = _walk_parts(payload)

    plain_candidates = []
    html_candidates = []

    for part in all_parts:
        mime = (part.get("mimeType") or "").lower()
        body = part.get("body") or {}
        data = body.get("data")
        if not data:
            continue

        try:
            decoded = _b64url_decode(data).decode("utf-8", errors="replace")
        except Exception:
            continue

        if mime.startswith("text/plain"):
            plain_candidates.append(decoded.strip())
        elif mime.startswith("text/html"):
            html_candidates.append(decoded.strip())

    if plain_candidates:
        return "\n\n".join([t for t in plain_candidates if t])

    if html_candidates:
        texts = [html_to_text(h) for h in html_candidates]
        texts = [t for t in texts if t]
        return "\n\n".join(texts)

    # fallback: snippet si existe
    snippet = message.get("snippet")
    return (snippet or "").strip()


def get_headers(message: Dict[str, Any]) -> Dict[str, str]:
    headers: Dict[str, str] = {}
    payload = message.get("payload") or {}
    for h in payload.get("headers", []) or []:
        name = (h.get("name") or "").strip()
        value = (h.get("value") or "").strip()
        if name:
            headers[name.lower()] = value
    return headers


def format_message_for_analysis(message: Dict[str, Any]) -> str:
    headers = get_headers(message)
    frm = headers.get("from", "")
    to = headers.get("to", "")
    subject = headers.get("subject", "")
    date = headers.get("date", "")
    body_text = extract_best_text_from_message(message)

    chunks = []
    if subject:
        chunks.append(f"Subject: {subject}")
    if frm:
        chunks.append(f"From: {frm}")
    if to:
        chunks.append(f"To: {to}")
    if date:
        chunks.append(f"Date: {date}")
    chunks.append("")
    chunks.append(body_text)

    return "\n".join(chunks).strip()


def thread_to_text(thread: Dict[str, Any]) -> str:
    """
    Convierte un thread (con mensajes) a texto legible para análisis.
    """
    msgs = thread.get("messages") or []
    out = []
    for i, m in enumerate(msgs, start=1):
        out.append(f"\n\n=== MESSAGE {i}/{len(msgs)} ===")
        out.append(format_message_for_analysis(m))
    return "\n".join(out).strip()
```

---

### 4.4 `analyzer.py`
```python
import re
from typing import List


ACTION_PATTERNS = [
    r"\bpor favor\b",
    r"\bpuedes\b",
    r"\bpodrías\b",
    r"\bnecesito\b",
    r"\bpendiente\b",
    r"\bantes de\b",
    r"\bpara (el|la)\b",
    r"\bconfirm(a|ar|ación)\b",
    r"\benviar\b",
    r"\brevis(a|ar|ión)\b",
    r"\bagendar\b",
]

MEETING_PATTERNS = [
    r"\breunión\b",
    r"\bmeeting\b",
    r"\bllamada\b",
    r"\bcall\b",
    r"\bagenda\b",
    r"\bpuntos\b",
    r"\btemas\b",
]


def split_sentences(text: str) -> List[str]:
    parts = re.split(r"(?<=[.!?])\s+|\n+", text)
    parts = [p.strip() for p in parts if p.strip()]
    return parts


def extract_action_items(thread_text: str, max_items: int = 10) -> List[str]:
    sentences = split_sentences(thread_text)
    items = []
    for s in sentences:
        s_low = s.lower()
        if any(re.search(p, s_low) for p in ACTION_PATTERNS):
            items.append(s)
        if len(items) >= max_items:
            break
    # dedupe simple
    deduped = []
    seen = set()
    for it in items:
        k = it.lower()
        if k not in seen:
            seen.add(k)
            deduped.append(it)
    return deduped


def extract_meeting_topics(thread_text: str, max_items: int = 10) -> List[str]:
    sentences = split_sentences(thread_text)
    topics = []
    for s in sentences:
        s_low = s.lower()
        if any(re.search(p, s_low) for p in MEETING_PATTERNS):
            topics.append(s)
        if len(topics) >= max_items:
            break
    deduped = []
    seen = set()
    for it in topics:
        k = it.lower()
        if k not in seen:
            seen.add(k)
            deduped.append(it)
    return deduped


def summarize(thread_text: str, max_lines: int = 10) -> str:
    """
    Resumen heurístico (sin LLM): toma extractos iniciales/finales.
    """
    lines = [ln.strip() for ln in thread_text.splitlines() if ln.strip()]
    if not lines:
        return ""

    head = lines[: max_lines // 2]
    tail = lines[-(max_lines // 2) :] if len(lines) > max_lines else []
    summary_lines = []
    summary_lines.append("• Contexto general: conversación de correo con varios mensajes.")
    if head:
        summary_lines.append("• Inicio del hilo (extracto): " + " / ".join(head[:2])[:250])
    if tail:
        summary_lines.append("• Último estado (extracto): " + " / ".join(tail[-2:])[:250])
    return "\n".join(summary_lines).strip()


def draft_reply(summary: str, action_items: List[str]) -> str:
    """
    Genera una respuesta sugerida “segura” (plantilla) basada en resumen + pendientes.
    """
    out = []
    out.append("Hola,")
    out.append("")
    if summary:
        out.append("Gracias por el mensaje. Para asegurarme de estar alineado, entiendo lo siguiente:")
        out.append(summary)
        out.append("")
    if action_items:
        out.append("Acciones/puntos a confirmar que veo en el hilo:")
        for it in action_items[:8]:
            out.append(f"- {it}")
        out.append("")
        out.append("¿Confirmas si estos puntos son correctos y si hay alguna prioridad o fecha objetivo?")
    else:
        out.append("¿Podrías confirmarme el objetivo principal y cualquier fecha límite relevante?")
    out.append("")
    out.append("Saludos,")
    return "\n".join(out).strip()
```

---

### 4.5 `main.py`
```python
import os
import asyncio
from dotenv import load_dotenv

from gmail_mcp_client import GmailMcpClient, GmailMcpConfig
from email_utils import thread_to_text
from analyzer import summarize, extract_action_items, extract_meeting_topics, draft_reply


def parse_csv_args(s: str) -> list[str]:
    return [p.strip() for p in s.split(",") if p.strip()]


def safe_bool(v: str, default: bool = False) -> bool:
    if v is None:
        return default
    return v.strip().lower() in ("1", "true", "yes", "y", "on")


async def pick_thread_interactive(client: GmailMcpClient, query: str, max_results: int) -> dict:
    threads = await client.list_threads(query, max_results=max_results)
    ths = threads.get("threads") if isinstance(threads, dict) else None
    if not ths:
        print("\nNo encontré hilos con ese query.")
        return {}

    print("\nHilos encontrados:")
    for i, t in enumerate(ths, start=1):
        tid = t.get("id", "")
        snip = (t.get("snippet") or "").replace("\n", " ").strip()
        print(f"{i:02d}) {tid}  |  {snip[:100]}")

    while True:
        choice = input("\nElige un número de hilo (o ENTER para cancelar): ").strip()
        if not choice:
            return {}
        if choice.isdigit():
            idx = int(choice)
            if 1 <= idx <= len(ths):
                thread_id = ths[idx - 1].get("id")
                if not thread_id:
                    return {}
                full = await client.get_thread(thread_id, fmt="full")
                return full if isinstance(full, dict) else {}
        print("Opción inválida.")


async def run():
    load_dotenv()

    mcp_config_dir = os.getenv("MCP_CONFIG_DIR", "./.gmail-mcp")
    command = os.getenv("GMAIL_MCP_COMMAND", "npx")
    args = parse_csv_args(os.getenv("GMAIL_MCP_ARGS", "-y,@shinzolabs/gmail-mcp"))
    enable_write = safe_bool(os.getenv("ENABLE_WRITE_ACTIONS", "false"), default=False)

    os.makedirs(mcp_config_dir, exist_ok=True)

    cfg = GmailMcpConfig(
        mcp_config_dir=mcp_config_dir,
        command=command,
        args=args,
        extra_env={},
    )

    print("Iniciando conexión MCP a Gmail...")
    async with GmailMcpClient(cfg) as client:
        tools = await client.list_tools()
        print(f"Conectado. Tools disponibles: {', '.join(sorted(tools.keys()))}")

        print("\nEjemplos de query Gmail:")
        print("  newer_than:7d")
        print("  is:unread newer_than:14d")
        print("  from:cliente@dominio.com newer_than:30d")

        query = input("\nEscribe tu query Gmail (ENTER = newer_than:7d): ").strip() or "newer_than:7d"
        max_results_str = input("Máx hilos a listar (ENTER = 10): ").strip() or "10"
        max_results = int(max_results_str) if max_results_str.isdigit() else 10

        thread = await pick_thread_interactive(client, query=query, max_results=max_results)
        if not thread:
            print("Cancelado.")
            return

        text = thread_to_text(thread)
        summary = summarize(text)
        actions = extract_action_items(text)
        topics = extract_meeting_topics(text)
        reply = draft_reply(summary, actions)

        print("\n==============================")
        print("RESUMEN")
        print("==============================")
        print(summary or "(sin resumen)")

        print("\n==============================")
        print("ACCIONES / PENDIENTES")
        print("==============================")
        if actions:
            for a in actions:
                print(f"- {a}")
        else:
            print("(no detecté acciones claramente)")

        print("\n==============================")
        print("TEMAS PARA REUNIÓN (si aplica)")
        print("==============================")
        if topics:
            for t in topics:
                print(f"- {t}")
        else:
            print("(no detecté temas de reunión claramente)")

        print("\n==============================")
        print("RESPUESTA SUGERIDA (BORRADOR)")
        print("==============================")
        print(reply)

        print("\n------------------------------")
        print("Por seguridad, este proyecto NO escribe en Gmail por defecto.")
        print("Si quieres crear borradores/enviar, primero inspecciona el schema exacto de la tool (create_draft/send_message).")
        print("Puedes imprimir tools['create_draft'].inputSchema para ver los argumentos requeridos.")
        if enable_write:
            print("\n⚠️ ENABLE_WRITE_ACTIONS=true está activo, pero aún no se implementa escritura automática.")
            print("Implementa esa parte después de ver el inputSchema para no adivinar el formato.")


if __name__ == "__main__":
    asyncio.run(run())
```

---

## 5) Ejecutar

1) Instala dependencias (si Replit no lo hace automático):
```bash
pip install -r requirements.txt
```

2) Asegúrate de tener en `./.gmail-mcp/`:
- `gcp-oauth.keys.json`
- `credentials.json`

3) Ejecuta:
```bash
python main.py
```

---

## 6) Extensión: crear borradores / enviar (opcional)

Por seguridad **NO lo hice automático** porque cada servidor MCP puede exponer el schema exacto de `create_draft`/`send_message`.
Para implementarlo correctamente:

1) En `main.py`, imprime el schema:
```python
print(tools["create_draft"].inputSchema)
```

2) Con eso, agregas un `await client.call_tool("create_draft", {...})` con los argumentos correctos.

---

## 7) Seguridad (muy importante)

- No publiques `credentials.json` ni `gcp-oauth.keys.json`.
- Usa Replit Secrets o guarda los archivos de forma privada.
- Mantén `ENABLE_WRITE_ACTIONS=false` hasta probar y estar seguro.

Fin.
