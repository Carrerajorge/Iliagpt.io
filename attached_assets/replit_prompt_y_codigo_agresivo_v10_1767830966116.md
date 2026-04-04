# Replit — Prompt + Código “10x mejor” para saneamiento AGRESIVO (v10)
> Objetivo: pasar el scanner y cerrar superficie de ataque.
> Documento autocontenido para subir como UN SOLO ARCHIVO a Replit.

⚠️ CRÍTICO: si el scanner detectó keys/tokens en archivos como `**/.state/session_*.json`, rota/revoca esas credenciales YA. No pegues valores reales en tickets.

---

## A) PROMPT (10x mejor) para enviar a Replit Support (copiar/pegar tal cual)

**Asunto:** Bloqueo por command injection / secret leaks / SQL injection — necesito guía oficial + excluir `.state`

**Mensaje:**
Hola equipo Replit,

Estoy bloqueado por hallazgos críticos del scanner (command injection, SQL injection y secret leaks). Ya implementé hardening a nivel de app, pero el scanner sigue reportando porque escanea también artefactos/estado del workspace (por ejemplo `**/.state/**`, `sandbox_workspace/**`, `attached_assets/**`).

Necesito su forma oficial para:
1) Evitar que secretos/variables sensibles se serialicen y queden persistidas en archivos tipo `.state/session_*.json`.
2) Excluir `.state/`, `sandbox_workspace/` y `attached_assets/` de exports/scans/snapshots (o confirmar el patrón recomendado).
3) Confirmar el hardening recomendado para ejecutar procesos (pip/playwright/scripts) sin abrir superficie de command injection:
   - prohibir shell,
   - ejecutar solo comandos allowlisted,
   - no permitir `program` dinámico,
   - no permitir instalación “arbitraria” de paquetes.

Adjunto un playbook autocontenido con:
- `.semgrepignore` + `.gitignore`
- runner seguro en Python (`safe_exec.py`) que elimina shell y bloquea args peligrosos
- wrapper seguro en Node (`safeSpawn.ts`) que elimina `program` libre
- patrones de SQLAlchemy seguros (`text()` con bind params)
- checklist para validar y cerrar findings

Por favor confirmen:
- si hay una configuración recomendada en Replit para impedir que `.state` incluya secrets,
- y si mi `.semgrepignore` es suficiente o si Replit tiene un control adicional.

Gracias.

---

## B) PROMPT (opcional) para un asistente de código (LLM) para aplicar parches por repo

> “Actúa como ingeniero AppSec. Recorre el repo y haz un PR con hardening agresivo para pasar Semgrep/SAST:
> 1) Elimina `asyncio.create_subprocess_shell` y cualquier `exec`/shell.
> 2) Centraliza TODA ejecución de procesos en un módulo `safe_exec.py` con allowlists (programas, flags, paquetes).
> 3) Prohíbe instalación arbitraria de paquetes en runtime; reemplaza por dependencias declaradas o allowlist con versiones fijas.
> 4) En Node, reemplaza `spawn(program, args)` por wrapper con enum/allowlist; prohíbe `exec`.
> 5) En SQLAlchemy, reemplaza SQL dinámico por `text()` + parámetros enlazados; si hay tablas/columnas variables, usa allowlist.
> 6) Elimina secretos del repo y evita que `.state/` y `sandbox_workspace/` entren al escaneo usando `.semgrepignore` y `.gitignore`.
> Devuélveme: diff/patch por archivo y checklist final.”

---

## C) CAMBIO #1 (AGRESIVO): parar falsos positivos por copias/estado
Si no ignoras `**/.state/**` y `attached_assets/**`, aunque arregles el código real, el scanner seguirá viendo copias viejas.

### C.1 Crea `.semgrepignore` (RAÍZ DEL REPO)
```txt
# Estado/artefactos del IDE o sandbox (NO deben escanearse)
sandbox_workspace/
**/.state/
attached_assets/

# caches comunes
**/__pycache__/
**/*.pyc
node_modules/
dist/
build/
```

### C.2 Refuerza `.gitignore`
```gitignore
# Replit / sandbox / estado
sandbox_workspace/
attached_assets/
**/.state/

# env / secrets
.env
.env.*
*.key
*.pem
*.p12

# dumps de sesión/secretos
**/*session*.json
**/*secrets*.json
```

---

## D) CAMBIO #2 (AGRESIVO): eliminar shell y bloquear comandos (Python)

### D.1 Reglas candado
- Prohibido `create_subprocess_shell` (idealmente nunca).
- Prohibido construir strings tipo `f"{interpreter} {path}"`.
- Obligatorio usar lista de args y `shell=False`.
- Obligatorio allowlist de programas/flags/paquetes.

### D.2 Archivo listo: `server/agent/python_agent/safe_exec.py` (v10)
Copia y pega este archivo:

```python
# server/agent/python_agent/safe_exec.py
from __future__ import annotations

import asyncio
import os
import re
import sys
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Sequence

# =========================
# CONFIG (LOCKDOWN)
# =========================
_ALLOWED_PROGRAMS: set[str] = {
    sys.executable,
    "python", "python3",
    "pip", "pip3",
    "playwright",
}

# Paquetes permitidos (PINEADOS). Agrega SOLO lo necesario.
_ALLOWED_PIP_SPECS: dict[str, str] = {
    "rich": "rich==13.9.4",
    "aiofiles": "aiofiles==24.1.0",
}

# Flags de pip que bloqueamos porque amplían superficie de supply-chain/injection.
_BLOCKED_PIP_FLAGS: set[str] = {
    "-r", "--requirement",
    "--extra-index-url", "--index-url",
    "--trusted-host",
    "--no-index",
}

_PIP_SPEC_RE = re.compile(r"^[A-Za-z0-9_.-]+==[A-Za-z0-9_.-]+$")

def _clean_env(env: Mapping[str, str] | None) -> dict[str, str]:
    # Agresivo: NO heredar variables que parezcan secretos
    base = dict(env or os.environ)
    for k in list(base.keys()):
        if "SECRET" in k or k.endswith("_API_KEY") or "TOKEN" in k or "PASSWORD" in k:
            base.pop(k, None)
    return base

def _deny_control_chars(s: str) -> None:
    if any(c in s for c in ("\n", "\r", "\x00")):
        raise ValueError("Blocked control chars in argument")

def _validate_args(args: Sequence[str]) -> None:
    for a in args:
        _deny_control_chars(a)
        if a.strip() == "":
            raise ValueError("Blocked empty arg")

def _is_pip(program: str, args: Sequence[str]) -> bool:
    if program in {"pip", "pip3"}:
        return True
    if program in {sys.executable, "python", "python3"} and list(args)[:2] == ["-m", "pip"]:
        return True
    return False

def _validate_pip_args(args: Sequence[str]) -> None:
    for a in args:
        if a in _BLOCKED_PIP_FLAGS:
            raise ValueError(f"Blocked pip flag: {a}")

@dataclass(frozen=True)
class Command:
    program: str
    args: tuple[str, ...]
    cwd: str | None = None
    timeout: int = 120

class SafeExecutor:
    # Ejecutor seguro:
    # - No usa shell
    # - Valida programas y args
    # - Bloquea pip peligroso
    # - Permite operaciones del catálogo

    def __init__(self, workdir: str | None = None, env: Mapping[str, str] | None = None):
        self.workdir = workdir
        self.env = env

    # ---- Catálogo de operaciones seguras ----
    def cmd_playwright_install_chromium(self) -> Command:
        return Command(
            program=sys.executable,
            args=("-m", "playwright", "install", "chromium"),
            cwd=self.workdir,
            timeout=300,
        )

    def cmd_pip_install_allowlisted(self, package_key: str) -> Command:
        if package_key not in _ALLOWED_PIP_SPECS:
            raise ValueError(f"Blocked pip package key: {package_key}")
        spec = _ALLOWED_PIP_SPECS[package_key]
        if not _PIP_SPEC_RE.match(spec):
            raise ValueError("Pip spec must be pinned as name==version")
        return Command(
            program=sys.executable,
            args=("-m", "pip", "install", spec, "-q", "--disable-pip-version-check"),
            cwd=self.workdir,
            timeout=120,
        )

    def cmd_run_python_script(self, script_path: str) -> Command:
        if self.workdir:
            wd = Path(self.workdir).resolve()
            sp = Path(script_path).resolve()
            if wd not in sp.parents and wd != sp.parent:
                raise ValueError("Blocked script path outside workdir")
        return Command(
            program=sys.executable,
            args=(script_path,),
            cwd=self.workdir,
            timeout=120,
        )

    # ---- Ejecución sync/async ----
    def run(self, cmd: Command) -> subprocess.CompletedProcess[str]:
        if cmd.program not in _ALLOWED_PROGRAMS:
            raise ValueError(f"Blocked program: {cmd.program}")

        _validate_args(cmd.args)
        if _is_pip(cmd.program, cmd.args):
            _validate_pip_args(cmd.args)

        return subprocess.run(
            [cmd.program, *cmd.args],
            capture_output=True,
            text=True,
            timeout=cmd.timeout,
            cwd=cmd.cwd,
            env=_clean_env(self.env),
            check=False,
            shell=False,
        )

    async def arun(self, cmd: Command) -> tuple[int, str, str]:
        if cmd.program not in _ALLOWED_PROGRAMS:
            raise ValueError(f"Blocked program: {cmd.program}")

        _validate_args(cmd.args)
        if _is_pip(cmd.program, cmd.args):
            _validate_pip_args(cmd.args)

        proc = await asyncio.create_subprocess_exec(
            cmd.program, *cmd.args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cmd.cwd,
            env=_clean_env(self.env),
        )
        out_b, err_b = await proc.communicate()
        return proc.returncode or 0, (out_b or b"").decode("utf-8", "replace"), (err_b or b"").decode("utf-8", "replace")
```

### D.3 Reemplazos obligatorios
1) `asyncio.create_subprocess_shell(cmd, ...)` -> reconstruir como `Command(program, args)` y usar `SafeExecutor.arun`.
2) `f"{interpreter} {path}"` -> usar lista: `Command(interpreter_path, (str(script_path),))`.
3) `pip install pkg` con `pkg` libre -> eliminar o cambiar a `cmd_pip_install_allowlisted("rich")`.

---

## E) CAMBIO #3 (AGRESIVO): Node/TypeScript — prohibir `program` dinámico

### E.1 Archivo listo: `server/agent/langgraph/safeSpawn.ts`
```ts
import { spawn } from "node:child_process";

const ALLOWED_PROGRAMS = {
  PYTHON: "python3",
  NODE: "node",
} as const;

type ProgramKey = keyof typeof ALLOWED_PROGRAMS;

function validateArgs(args: string[]) {
  for (const a of args) {
    if (a.includes("\n") || a.includes("\r") || a.includes("\0")) {
      throw new Error("Blocked arg (control chars)");
    }
  }
}

export function safeSpawn(programKey: ProgramKey, args: string[]) {
  validateArgs(args);
  const program = ALLOWED_PROGRAMS[programKey];
  return spawn(program, args, { shell: false, stdio: "pipe", windowsHide: true });
}
```

Reemplazo: `spawn(program, args)` -> `safeSpawn("PYTHON", args)`.

---

## F) CAMBIO #4 (AGRESIVO): SQLAlchemy — eliminar SQL dinámico

### F.1 Plantilla segura
```python
from sqlalchemy import text
stmt = text("SELECT * FROM users WHERE email = :email")
res = await db.execute(stmt, {"email": email})
```

### F.2 Si varía tabla/columna (solo allowlist)
```python
from sqlalchemy import text
ALLOWED_TABLES = {"users", "orders"}
if table not in ALLOWED_TABLES:
    raise ValueError("Blocked table")
stmt = text(f"SELECT * FROM {table} WHERE id = :id")
res = await db.execute(stmt, {"id": item_id})
```

---

## G) Checklist final
1) Rotar credenciales filtradas.
2) Borrar/excluir `sandbox_workspace/`, `**/.state/`, `attached_assets/`.
3) Añadir `.semgrepignore`.
4) Eliminar `create_subprocess_shell`.
5) Centralizar ejecución en `SafeExecutor`.
6) Eliminar instalación arbitraria de paquetes o allowlist pineada.
7) Parametrizar SQL.
8) Re-ejecutar scanner.

FIN
