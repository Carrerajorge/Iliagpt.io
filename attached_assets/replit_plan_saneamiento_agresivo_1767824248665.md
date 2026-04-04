# Replit — Solicitud de Soporte + Plan de Saneamiento AGRESIVO (Command Injection + SQL Injection + Secret Leaks)
**Fecha del scan:** 07 Jan 2026  
**Entorno:** Replit (workspace + ejecución en sandbox)  
**Hallazgos:** ~50 (principalmente ejecución de procesos con inputs no estáticos, SQL dinámico y exposición de credenciales)

---

## 1) Resumen ejecutivo (qué está pasando)
El análisis está reportando tres clases de riesgos:

1) **Command Injection (CRÍTICO)**  
   Se detectan llamadas a:
   - Python: `subprocess.run(...)` con argumentos variables (p. ej. paquetes `pkg` instalados dinámicamente).
   - Python asyncio: `asyncio.create_subprocess_exec(*args)` sin controlar la procedencia de `args`, y peor aún, `asyncio.create_subprocess_shell(cmd)` donde `cmd` puede ser string variable (riesgo alto).
   - Node/TS: `child_process.spawn(program, args)` donde `program` proviene de argumento de función, potencialmente controlable.

   **Objetivo:** garantizar que NINGÚN comando pueda ser construido/inyectado por entradas externas (usuario/LLM/requests/archivos). Se debe aplicar **allowlist estricta** y evitar el shell.

2) **SQL Injection (ALTO)**  
   Se detecta SQL dinámico con f-strings/concatenación que evita protecciones de SQLAlchemy. El enfoque correcto es usar `text()` con parámetros enlazados (bind params) y/o el ORM.

3) **Secret Leaks (CRÍTICO)**  
   Se detectaron API keys / OAuth client secret / JWT / DB URL en `sandbox_workspace/.state/session_*.json` (archivos de estado).  
   **Esto implica que credenciales sensibles quedaron persistidas en archivos.**  
   **NO** compartir valores reales de claves en tickets o repos.

> Nota: No se incluyen valores reales de claves por seguridad. Se asume compromiso y se requiere rotación.

---

## 2) Requerimiento a Replit Support (lo que necesito que Replit haga)
### 2.1 Investigación de persistencia de secretos en `.state/session_*.json`
**Solicitud:** Revisar por qué el workspace está guardando variables sensibles o sesiones en `sandbox_workspace/.state/session_*.json` (o similares) y si existe:
- configuración para **no persistir** secretos/sesiones en archivos dentro del proyecto,
- opción para moverlos a almacenamiento protegido o cifrado fuera del repo,
- o una guía oficial para excluir `.state/` de exportaciones y escaneos.

### 2.2 Recomendación oficial de hardening para ejecución de procesos
**Solicitud:** Confirmar el enfoque recomendado en Replit para evitar command injection cuando el sistema requiere ejecutar:
- `pip install ...`
- `playwright install chromium`
- ejecución de scripts Python en sandbox

Y si existe una práctica recomendada para:
- bloquear `create_subprocess_shell`/`exec`,
- centralizar ejecución en un “runner” seguro,
- limitar permisos (si hay aislamiento extra disponible).

### 2.3 Validación de “Secrets Manager” como la ruta correcta
Confirmación de que Replit Secrets es la vía oficial para:
- API Keys
- OAuth Client Secret
- DB URLs
- tokens (JWT, etc.)  
y que se consumen vía env vars (variables de entorno) en runtime.

---

## 3) Acciones inmediatas (CRÍTICO — deben hacerse ya)
### 3.1 Rotación / Revocación total de credenciales expuestas
**Acción agresiva:** asumir compromiso y rotar TODO:
- Google APIs / Google Cloud keys
- OAuth Client Secret (regenerar)
- JWT / DB URLs / tokens de terceros
- cualquier API key de terceros (OpenAI, Figma, etc.)

### 3.2 Eliminar y bloquear `.state/` y “session dumps”
**Acción:** borrar `sandbox_workspace/.state/session_*.json` y cualquier `.state/`.  
Luego: **ignorar para siempre** con `.gitignore`.  
**Importante:** Git no deja de trackear archivos ya rastreados solo por agregar `.gitignore`; hay que remover del index si estaban versionados.

**.gitignore mínimo recomendado:**
```gitignore
# Replit / sandbox state
**/.state/
sandbox_workspace/.state/

# env / secrets
.env
.env.*
*.key
*.pem
*.p12

# common secret dumps
**/*session*.json
**/*secrets*.json
```

**Si ya estaban trackeados:**
```bash
git rm -r --cached sandbox_workspace/.state
git rm -r --cached **/.state || true
git commit -m "Remove .state files and ignore them"
```

---

## 4) Saneamiento AGRESIVO — Command Injection (Python)
### 4.1 Política de seguridad (obligatoria)
- **Prohibido** ejecutar comandos construidos desde input externo.
- **Prohibido** `create_subprocess_shell(...)` en producción (solo permitido para comandos 100% estáticos).
- Toda ejecución debe pasar por **UNA sola función** (runner seguro) con:
  - allowlist de programas,
  - allowlist de subcomandos/flags,
  - allowlist de paquetes (si hay instalador),
  - `shell=False`.

### 4.2 Reemplazar `create_subprocess_shell` por `create_subprocess_exec`
**ANTES (riesgoso):**
```python
proc = await asyncio.create_subprocess_shell(
    cmd, stdout=PIPE, stderr=PIPE, cwd=str(workdir), env=os.environ.copy()
)
```

**DESPUÉS (robusto):**
```python
proc = await asyncio.create_subprocess_exec(
    program, *args,
    stdout=asyncio.subprocess.PIPE,
    stderr=asyncio.subprocess.PIPE,
    cwd=str(workdir),
    env=clean_env,
)
```

### 4.3 Runner seguro (plantilla AGRESIVA)
> Objetivo: que el scanner deje de reportar “non-static string” porque ahora hay control estricto y no hay camino para input malicioso.

```python
import os, re, sys, subprocess
from typing import Sequence

ALLOWED_PROGRAMS = {
    sys.executable, "python", "python3",
    "pip", "pip3",
    "playwright",
}

# Allowlist estricta (ideal: fijar versiones)
ALLOWED_PIP_PACKAGES = {
    "aiofiles==24.1.0",
    "rich==13.9.4",
    # agregar solo lo necesario
}

PKG_RE = re.compile(r"^[A-Za-z0-9_.-]+(==[A-Za-z0-9_.-]+)?$")

BLOCKED_PIP_FLAGS = {
    "-r", "--requirement",
    "--extra-index-url", "--index-url",
    "--trusted-host",
}

def safe_run(program: str, args: Sequence[str], *, timeout: int = 120, cwd: str | None = None):
    if program not in ALLOWED_PROGRAMS:
        raise ValueError(f"Blocked program: {program}")

    # Sanitización mínima de args (sin saltos de línea)
    for a in args:
        if "\n" in a or "\r" in a:
            raise ValueError("Blocked arg with newline")

    # Hardening específico para pip (si se usa)
    is_pip = (program in {"pip", "pip3"}) or (program in {sys.executable, "python", "python3"} and list(args)[:2] == ["-m", "pip"])
    if is_pip:
        for a in args:
            if a in BLOCKED_PIP_FLAGS:
                raise ValueError(f"Blocked pip flag: {a}")
        # Permitir solo paquetes allowlisted
        for a in args:
            if a.startswith("-"):
                continue
            if PKG_RE.match(a) and a not in ALLOWED_PIP_PACKAGES:
                raise ValueError(f"Blocked pip package: {a}")

    clean_env = dict(os.environ)  # opcional: filtrar claves sensibles si se requiere
    return subprocess.run(
        [program, *args],
        capture_output=True,
        text=True,
        timeout=timeout,
        cwd=cwd,
        env=clean_env,
        check=False,
        shell=False,  # CLAVE anti-inyección
    )
```

### 4.4 Parches específicos a patrones detectados
1) **`subprocess.run([..., pkg, ...])`**
- `pkg` debe ser **allowlist** (no libre).
- bloquear flags peligrosos.
- preferir versiones fijas: `pkg==X.Y.Z`

2) **`return await self.execute(f"{interpreter} {path}", timeout)`**
- NO construir string `"interpreter path"`; usar lista y sin shell:

```python
# en vez de f"{interpreter} {path}"
program = interpreter_path
args = [str(script_path)]
# luego ejecutar con create_subprocess_exec(program, *args) o safe_run(program, args)
```

3) **Instalación Playwright**
- mantener argumentos estáticos:

```python
safe_run(sys.executable, ["-m", "playwright", "install", "chromium"], timeout=300)
```

---

## 5) Saneamiento AGRESIVO — Command Injection (Node/TypeScript)
El riesgo aparece cuando `program` es variable.

### 5.1 Política
- Prohibido `exec(...)`.
- `spawn(..., { shell: false })` únicamente.
- `program` NO puede venir directo: debe mapearse desde **allowlist**.

### 5.2 Plantilla robusta
```ts
import { spawn } from "node:child_process";

const ALLOWED_PROGRAMS = {
  PYTHON: "python3",
  NODE: "node",
} as const;

type ProgramKey = keyof typeof ALLOWED_PROGRAMS;

export function safeSpawn(programKey: ProgramKey, args: string[]) {
  const program = ALLOWED_PROGRAMS[programKey];

  for (const a of args) {
    if (a.includes("\n") || a.includes("\r")) throw new Error("Blocked arg");
  }

  return spawn(program, args, {
    shell: false,
    windowsHide: true,
    stdio: "pipe",
  });
}
```

---

## 6) Saneamiento AGRESIVO — SQL Injection (SQLAlchemy)
**Regla:** nunca ejecutar SQL con f-strings/concatenación con valores.  
Usar `text()` con parámetros enlazados.

### 6.1 Ejemplo de parche
**ANTES (riesgoso):**
```python
await db.execute(f"SELECT * FROM users WHERE email = '{email}'")
```

**DESPUÉS (seguro):**
```python
from sqlalchemy import text
stmt = text("SELECT * FROM users WHERE email = :email")
res = await db.execute(stmt, {"email": email})
```

### 6.2 Identificadores (tabla/columna) variables
No se parametrizan como valores. Solución agresiva: allowlist:

```python
from sqlalchemy import text

ALLOWED_TABLES = {"users", "orders"}
if table not in ALLOWED_TABLES:
    raise ValueError("Blocked table")

stmt = text(f"SELECT * FROM {table} WHERE id = :id")
res = await db.execute(stmt, {"id": item_id})
```

---

## 7) Replit Secrets — Implementación obligatoria
### 7.1 Lectura en Python
```python
import os
API_KEY = os.environ["API_KEY"]  # debe existir o fallar
```

### 7.2 Lectura en Node
```js
const API_KEY = process.env.API_KEY;
if (!API_KEY) throw new Error("Missing API_KEY");
```

**Regla agresiva:** si falta un secret → fallar inicio. No usar defaults.

---

## 8) Verificación y cierre (cómo confirmamos que quedó saneado)
1) Re-ejecutar el scanner (Semgrep/gitleaks) y confirmar:
   - 0 hallazgos de secretos (nada en repo/estado).
   - 0 hallazgos de `create_subprocess_shell` con variables.
   - 0 SQL dinámico con f-strings.

2) Añadir “gates”:
   - pre-commit/CI para secretos y command injection.
   - fallo automático si aparece un patrón crítico.

---

## 9) Preguntas directas a Replit Support (para resolver rápido)
1) ¿Por qué `sandbox_workspace/.state/session_*.json` contiene valores sensibles y cómo evitarlo permanentemente?  
2) ¿Existe configuración recomendada para que `.state/` no se incluya en snapshots/exports/scans?  
3) ¿Hay guía oficial de hardening para ejecutar `pip/playwright` de forma segura en Replit?  
4) ¿Replit recomienda un patrón específico de “sandbox runner”/allowlist para agentes que ejecutan comandos?

---

## 10) Contexto técnico (rutas/patrones reportados)
Patrones típicos reportados por el scanner:
- `subprocess.run([sys.executable, "-m", "pip", "install", pkg, ...])`
- `asyncio.create_subprocess_exec(*args, ...)`
- `asyncio.create_subprocess_shell(cmd, ...)`
- `spawn(program, args, ...)`
- `execute(f"...")` (SQLAlchemy)

**Plan:** centralizar en runners seguros + allowlists + no-shell + SQL parametrizado + secretos solo en Replit Secrets.

---
FIN
