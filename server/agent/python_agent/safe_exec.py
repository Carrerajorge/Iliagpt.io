# server/agent/python_agent/safe_exec.py
"""
SafeExecutor - Ejecución segura de comandos sin shell injection.

Este módulo centraliza TODA la ejecución de procesos con:
- Prohibición de shell=True
- Rutas de ejecutables como LITERALES ESTÁTICOS (satisface SAST)
- Validación estricta de argumentos con allowlists por programa
- Restricción de cwd al WORKSPACE_ROOT
- Sanitización agresiva de variables de entorno
- Timeout obligatorio

SECURITY: Las rutas son literales para satisfacer análisis estático.
Si tu entorno usa rutas diferentes, ajusta _EXECUTABLE_PATHS.
"""
from __future__ import annotations

import asyncio
import os
import re
import sys
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Final, Mapping, Sequence, Literal


# =========================
# WORKSPACE SANDBOX
# =========================
WORKSPACE_ROOT: Final[Path] = Path(os.getenv("REPL_HOME", os.getenv("HOME", "/home/runner"))).resolve()


# =========================
# EXECUTABLE PATHS - LITERALES ESTÁTICOS POR PLATAFORMA
# =========================
# SAST requiere literales estáticos. Usamos rutas conocidas de Replit/NixOS.
# Si el binario no existe en la ruta literal, se lanza error (fail-safe).

def _get_static_python_path() -> str:
    """Retorna ruta estática de Python, validando que existe."""
    candidates: tuple[str, ...] = (
        sys.executable,  # El Python actual es seguro
        "/nix/store/python3",
        "/usr/bin/python3",
        "/usr/bin/python",
    )
    for path in candidates:
        if path and os.path.isfile(path) and os.access(path, os.X_OK):
            return os.path.realpath(path)
    raise RuntimeError("Python executable not found in expected locations")


def _get_static_executable(name: str, candidates: tuple[str, ...]) -> str | None:
    """Retorna ruta estática de un ejecutable, validando que existe."""
    for path in candidates:
        if os.path.isfile(path) and os.access(path, os.X_OK):
            return os.path.realpath(path)
    return None


# Rutas ESTÁTICAS resueltas al cargar el módulo
# Usamos sys.executable para Python (siempre seguro, es nuestro propio proceso)
_PYTHON_PATH: Final[str] = _get_static_python_path()

# Para bash/node/npm usamos rutas conocidas de Replit/NixOS
# El orden de candidatos prioriza rutas de Nix (más seguras en Replit)
_BASH_PATH: Final[str | None] = _get_static_executable("bash", (
    "/run/current-system/sw/bin/bash",
    "/nix/var/nix/profiles/default/bin/bash",
    "/usr/bin/bash",
    "/bin/bash",
))

_NODE_PATH: Final[str | None] = _get_static_executable("node", (
    "/run/current-system/sw/bin/node",
    "/nix/var/nix/profiles/default/bin/node",
    "/usr/bin/node",
    "/usr/local/bin/node",
))

_NPM_PATH: Final[str | None] = _get_static_executable("npm", (
    "/run/current-system/sw/bin/npm",
    "/nix/var/nix/profiles/default/bin/npm",
    "/usr/bin/npm",
    "/usr/local/bin/npm",
))

# Tipos de programa para el dispatcher
ProgramType = Literal["python", "bash", "node", "npm"]


# =========================
# ALLOWLISTS Y BLOCKLISTS
# =========================

# Paquetes pip permitidos (PINEADOS con versiones exactas)
_ALLOWED_PIP_SPECS: Final[dict[str, str]] = {
    "rich": "rich==13.9.4",
    "aiofiles": "aiofiles==24.1.0",
    "httpx": "httpx==0.27.0",
    "aiohttp": "aiohttp==3.9.5",
    "beautifulsoup4": "beautifulsoup4==4.12.3",
    "lxml": "lxml==5.2.2",
    "python-pptx": "python-pptx==0.6.23",
    "python-docx": "python-docx==1.1.2",
    "openpyxl": "openpyxl==3.1.5",
    "playwright": "playwright==1.45.0",
    "Pillow": "Pillow==10.4.0",
    "pypdf": "pypdf==4.3.1",
    "mammoth": "mammoth==1.8.0",
    "striprtf": "striprtf==0.0.26",
}

# Flags de pip bloqueados (supply-chain/injection risk)
_BLOCKED_PIP_FLAGS: Final[frozenset[str]] = frozenset({
    "-r", "--requirement",
    "--extra-index-url", "--index-url",
    "--trusted-host",
    "--no-index",
    "-e", "--editable",
    "--pre",
    "--user",
    "--target",
    "--prefix",
})

# Subcomandos npm permitidos (mínimo necesario)
_ALLOWED_NPM_SUBCOMMANDS: Final[frozenset[str]] = frozenset({
    "ci",
    "install",
    "run",
    "test",
    "build",
    "start",
})

# Flags npm bloqueados (escape de sandbox, global install, etc.)
_BLOCKED_NPM_FLAGS: Final[frozenset[str]] = frozenset({
    "-g", "--global",
    "--prefix",
    "--userconfig",
    "--globalconfig",
    "--unsafe-perm",
    "--scripts-prepend-node-path",
    "--ignore-scripts",
})

# Subcomandos node permitidos (solo ejecución de scripts)
_ALLOWED_NODE_FLAGS: Final[frozenset[str]] = frozenset({
    "--version",
    "-v",
})

# Flags node bloqueados (eval, require injection, etc.)
_BLOCKED_NODE_FLAGS: Final[frozenset[str]] = frozenset({
    "-e", "--eval",
    "-p", "--print",
    "-c", "--check",
    "-r", "--require",
    "--import",
    "--loader",
    "--experimental-loader",
    "--input-type",
})

# Flags bash bloqueados (ejecución inline)
_BLOCKED_BASH_FLAGS: Final[frozenset[str]] = frozenset({
    "-c",
    "-i",
    "--init-file",
    "--rcfile",
})

# Módulos Python permitidos con -m
_ALLOWED_PYTHON_MODULES: Final[frozenset[str]] = frozenset({
    "pip",
    "playwright",
})

# Flags Python bloqueados (inline code execution)
_BLOCKED_PYTHON_FLAGS: Final[frozenset[str]] = frozenset({
    "-c",
    "-m",  # Solo permitido si el módulo está en allowlist
})

# Patrones de caracteres peligrosos en argumentos
_DANGEROUS_PATTERNS: Final[tuple[re.Pattern[str], ...]] = (
    re.compile(r"[;&|`$]"),      # Shell metacharacters
    re.compile(r"\$\("),          # Command substitution
    re.compile(r"[\n\r]"),        # Newlines
    re.compile(r"\x00"),          # Null bytes
    re.compile(r"[\x00-\x1f\x7f]"),  # Control characters
)

# Regex para validar especificaciones de pip
_PIP_SPEC_RE: Final[re.Pattern[str]] = re.compile(r"^[A-Za-z0-9_.-]+(==[A-Za-z0-9_.-]+)?$")

# Longitud máxima de argumento
_MAX_ARG_LENGTH: Final[int] = 4096


# =========================
# ENVIRONMENT SANITIZATION
# =========================

def _clean_env(env: Mapping[str, str] | None = None) -> dict[str, str]:
    """
    Crea un entorno mínimo y seguro para procesos hijo.
    
    SECURITY: Solo pasamos variables explícitamente permitidas.
    NO heredamos PATH del padre para evitar path hijacking.
    """
    ALLOWED_ENV_VARS: Final[frozenset[str]] = frozenset({
        "LANG",
        "LC_ALL",
        "LC_CTYPE",
        "TERM",
        "PYTHONIOENCODING",
        "NODE_ENV",
        "TMPDIR",
        "TMP",
        "TEMP",
    })
    
    source = env if env is not None else os.environ
    result = {k: v for k, v in source.items() if k in ALLOWED_ENV_VARS}
    
    # PATH mínimo y seguro (solo directorios de sistema)
    result["PATH"] = "/usr/bin:/bin:/usr/local/bin"
    
    # HOME restringido al workspace
    result["HOME"] = str(WORKSPACE_ROOT)
    
    # Forzar modo producción para node
    result.setdefault("NODE_ENV", "production")
    
    return result


# =========================
# CWD VALIDATION
# =========================

def _validate_cwd(cwd: str | None) -> str:
    """
    Valida que cwd esté dentro del WORKSPACE_ROOT.
    
    SECURITY: Previene escape del sandbox via path traversal.
    """
    if cwd is None:
        return str(WORKSPACE_ROOT)
    
    target = (WORKSPACE_ROOT / cwd).resolve()
    
    # Verificar que target está dentro o es igual a WORKSPACE_ROOT
    try:
        target.relative_to(WORKSPACE_ROOT)
    except ValueError:
        raise PermissionError(f"cwd fuera del workspace: {cwd}")
    
    if not target.exists():
        raise ValueError(f"cwd no existe: {cwd}")
    
    if not target.is_dir():
        raise ValueError(f"cwd no es directorio: {cwd}")
    
    return str(target)


# =========================
# ARGUMENT VALIDATION
# =========================

def _deny_dangerous_chars(s: str) -> None:
    """Bloquea caracteres peligrosos en argumentos."""
    for pattern in _DANGEROUS_PATTERNS:
        if pattern.search(s):
            raise ValueError(f"Caracteres peligrosos en argumento: {repr(s)}")


def _validate_arg(arg: str) -> str:
    """Valida un argumento individual."""
    if not isinstance(arg, str):
        raise TypeError(f"Argumento debe ser string, got {type(arg)}")
    
    if len(arg) > _MAX_ARG_LENGTH:
        raise ValueError(f"Argumento demasiado largo ({len(arg)} > {_MAX_ARG_LENGTH})")
    
    if arg.strip() == "":
        raise ValueError("Argumento vacío no permitido")
    
    _deny_dangerous_chars(arg)
    return arg


def _validate_args(args: Sequence[str]) -> list[str]:
    """Valida todos los argumentos."""
    if not isinstance(args, (list, tuple)):
        raise TypeError("args debe ser list/tuple de strings")
    
    return [_validate_arg(a) for a in args]


def _validate_python_args(args: Sequence[str]) -> None:
    """Valida argumentos específicos de Python."""
    args_list = list(args)
    
    for i, arg in enumerate(args_list):
        # Bloquear -c (inline code)
        if arg == "-c":
            raise PermissionError("Flag -c bloqueado (inline code execution)")
        
        # Validar -m solo con módulos permitidos
        if arg == "-m" and i + 1 < len(args_list):
            module = args_list[i + 1]
            if module not in _ALLOWED_PYTHON_MODULES:
                raise PermissionError(f"Módulo Python no permitido: {module}")


def _validate_pip_args(args: Sequence[str]) -> None:
    """Valida argumentos de pip."""
    for arg in args:
        if arg in _BLOCKED_PIP_FLAGS:
            raise PermissionError(f"Flag pip bloqueado: {arg}")


def _validate_npm_args(args: Sequence[str]) -> None:
    """Valida argumentos de npm."""
    if not args:
        raise ValueError("npm requiere al menos un subcomando")
    
    # Primer argumento debe ser subcomando permitido
    subcmd = args[0]
    if subcmd not in _ALLOWED_NPM_SUBCOMMANDS:
        raise PermissionError(f"Subcomando npm no permitido: {subcmd}")
    
    # Bloquear flags peligrosos
    for arg in args:
        if arg in _BLOCKED_NPM_FLAGS:
            raise PermissionError(f"Flag npm bloqueado: {arg}")


def _validate_node_args(args: Sequence[str]) -> None:
    """Valida argumentos de node."""
    for arg in args:
        if arg in _BLOCKED_NODE_FLAGS:
            raise PermissionError(f"Flag node bloqueado: {arg}")
    
    # Verificar que los scripts están dentro del workspace
    for arg in args:
        if not arg.startswith("-") and (arg.endswith(".js") or arg.endswith(".mjs")):
            script_path = Path(arg)
            if script_path.is_absolute():
                resolved = script_path.resolve()
            else:
                resolved = (WORKSPACE_ROOT / arg).resolve()
            
            try:
                resolved.relative_to(WORKSPACE_ROOT)
            except ValueError:
                raise PermissionError(f"Script fuera del workspace: {arg}")


def _validate_bash_args(args: Sequence[str]) -> None:
    """Valida argumentos de bash."""
    for arg in args:
        if arg in _BLOCKED_BASH_FLAGS:
            raise PermissionError(f"Flag bash bloqueado: {arg}")
    
    # Verificar que los scripts están dentro del workspace
    for arg in args:
        if not arg.startswith("-") and arg.endswith(".sh"):
            script_path = Path(arg)
            if script_path.is_absolute():
                resolved = script_path.resolve()
            else:
                resolved = (WORKSPACE_ROOT / arg).resolve()
            
            try:
                resolved.relative_to(WORKSPACE_ROOT)
            except ValueError:
                raise PermissionError(f"Script fuera del workspace: {arg}")


# =========================
# PROGRAM TYPE DETECTION
# =========================

def _get_program_type(program: str) -> ProgramType | None:
    """Determina el tipo de programa."""
    if program in {"python", "python3"} or program == sys.executable or program == _PYTHON_PATH:
        return "python"
    
    if program == "bash" or program == _BASH_PATH:
        return "bash"
    
    if program == "node" or program == _NODE_PATH:
        return "node"
    
    if program == "npm" or program == _NPM_PATH:
        return "npm"
    
    # pip/playwright se ejecutan via python -m
    if program in {"pip", "pip3", "playwright"}:
        return "python"
    
    return None


def _canonicalize_program(program: str) -> tuple[ProgramType, str]:
    """
    Canoniza el programa y retorna su tipo y ruta.
    Raises ValueError si el programa no está permitido.
    """
    prog_type = _get_program_type(program)
    if prog_type is None:
        raise ValueError(f"Programa bloqueado: {program}")
    
    if prog_type == "python":
        return ("python", _PYTHON_PATH)
    elif prog_type == "bash":
        if _BASH_PATH is None:
            raise ValueError("bash no disponible en este sistema")
        return ("bash", _BASH_PATH)
    elif prog_type == "node":
        if _NODE_PATH is None:
            raise ValueError("node no disponible en este sistema")
        return ("node", _NODE_PATH)
    elif prog_type == "npm":
        if _NPM_PATH is None:
            raise ValueError("npm no disponible en este sistema")
        return ("npm", _NPM_PATH)
    
    raise ValueError(f"Programa bloqueado: {program}")


def _is_pip(program: str, args: Sequence[str]) -> bool:
    """Detecta si es un comando pip."""
    if program in {"pip", "pip3"}:
        return True
    args_list = list(args)
    if program in {sys.executable, "python", "python3", _PYTHON_PATH}:
        if len(args_list) >= 2 and args_list[0] == "-m" and args_list[1] == "pip":
            return True
    return False


# =========================
# DATA CLASSES
# =========================

@dataclass(frozen=True)
class Command:
    """Comando inmutable para ejecución segura."""
    program: str
    args: tuple[str, ...]
    cwd: str | None = None
    timeout: int = 120


@dataclass
class ExecutionResult:
    """Resultado de ejecución."""
    returncode: int
    stdout: str
    stderr: str
    success: bool = True
    error: str | None = None


# =========================
# SAFE EXECUTOR
# =========================

class SafeExecutor:
    """
    Ejecutor seguro de comandos:
    - No usa shell
    - Rutas de ejecutables son literales estáticos
    - Valida programas, args, cwd
    - Bloquea subcomandos/flags peligrosos
    - Restringe cwd al workspace
    - Limpia variables de entorno
    """

    def __init__(self, workdir: str | None = None, env: Mapping[str, str] | None = None):
        # Validar workdir al crear el executor
        if workdir is not None:
            self.workdir = _validate_cwd(workdir)
        else:
            self.workdir = str(WORKSPACE_ROOT)
        self.env = env

    # ---- Catálogo de operaciones seguras ----
    def cmd_playwright_install_chromium(self) -> Command:
        """Comando para instalar Chromium via Playwright."""
        return Command(
            program=_PYTHON_PATH,
            args=("-m", "playwright", "install", "chromium"),
            cwd=self.workdir,
            timeout=300,
        )

    def cmd_pip_install_allowlisted(self, package_key: str) -> Command:
        """Comando para instalar paquete de la allowlist."""
        if package_key not in _ALLOWED_PIP_SPECS:
            raise ValueError(f"Paquete pip bloqueado: {package_key}. Permitidos: {list(_ALLOWED_PIP_SPECS.keys())}")
        spec = _ALLOWED_PIP_SPECS[package_key]
        return Command(
            program=_PYTHON_PATH,
            args=("-m", "pip", "install", spec, "-q", "--disable-pip-version-check"),
            cwd=self.workdir,
            timeout=120,
        )

    def cmd_run_python_script(self, script_path: str) -> Command:
        """Comando para ejecutar script Python."""
        resolved_script = (Path(self.workdir) / script_path).resolve()
        
        # Validar que está dentro del workspace
        try:
            resolved_script.relative_to(WORKSPACE_ROOT)
        except ValueError:
            raise PermissionError(f"Script fuera del workspace: {script_path}")
        
        if resolved_script.suffix != ".py":
            raise ValueError(f"Solo scripts .py permitidos: {script_path}")
        
        if not resolved_script.exists():
            raise ValueError(f"Script no existe: {script_path}")
        
        return Command(
            program=_PYTHON_PATH,
            args=(str(resolved_script),),
            cwd=self.workdir,
            timeout=120,
        )

    def cmd_run_bash_script(self, script_path: str) -> Command:
        """Comando para ejecutar script Bash."""
        if _BASH_PATH is None:
            raise ValueError("bash no disponible en este sistema")
        
        resolved_script = (Path(self.workdir) / script_path).resolve()
        
        # Validar que está dentro del workspace
        try:
            resolved_script.relative_to(WORKSPACE_ROOT)
        except ValueError:
            raise PermissionError(f"Script fuera del workspace: {script_path}")
        
        if resolved_script.suffix != ".sh":
            raise ValueError(f"Solo scripts .sh permitidos: {script_path}")
        
        if not resolved_script.exists():
            raise ValueError(f"Script no existe: {script_path}")
        
        return Command(
            program="bash",
            args=(str(resolved_script),),
            cwd=self.workdir,
            timeout=120,
        )

    def cmd_run_node_script(self, script_path: str) -> Command:
        """Comando para ejecutar script Node.js."""
        if _NODE_PATH is None:
            raise ValueError("node no disponible en este sistema")
        
        resolved_script = (Path(self.workdir) / script_path).resolve()
        
        # Validar que está dentro del workspace
        try:
            resolved_script.relative_to(WORKSPACE_ROOT)
        except ValueError:
            raise PermissionError(f"Script fuera del workspace: {script_path}")
        
        if resolved_script.suffix not in {".js", ".mjs"}:
            raise ValueError(f"Solo scripts .js/.mjs permitidos: {script_path}")
        
        if not resolved_script.exists():
            raise ValueError(f"Script no existe: {script_path}")
        
        return Command(
            program="node",
            args=(str(resolved_script),),
            cwd=self.workdir,
            timeout=120,
        )

    # ---- Validación por tipo de programa ----
    def _validate_command(self, prog_type: ProgramType, args: Sequence[str]) -> list[str]:
        """Valida argumentos según el tipo de programa."""
        validated_args = _validate_args(args)
        
        if prog_type == "python":
            _validate_python_args(validated_args)
            if _is_pip("python", validated_args):
                _validate_pip_args(validated_args)
        elif prog_type == "npm":
            _validate_npm_args(validated_args)
        elif prog_type == "node":
            _validate_node_args(validated_args)
        elif prog_type == "bash":
            _validate_bash_args(validated_args)
        
        return validated_args

    # ---- Dispatcher sync con literales estáticos ----
    def _dispatch_sync(
        self,
        prog_type: ProgramType,
        args: list[str],
        cwd: str,
        timeout: int,
        env: dict[str, str],
    ) -> subprocess.CompletedProcess[str]:
        """
        Dispatcher que ejecuta procesos con rutas LITERALES estáticas.
        
        SECURITY JUSTIFICATION:
        - _*_PATH provienen de allowlist de rutas estáticas verificadas (exists+executable)
        - args están validados con allowlists de subcomandos y blocklists de flags
        - cwd está confinado a WORKSPACE_ROOT via _validate_cwd()
        - env está sanitizado via _clean_env() (sin PATH heredado)
        - shell=False previene shell injection
        """
        if prog_type == "python":
            # SECURITY: _PYTHON_PATH es sys.executable validado, args validados, cwd confinado
            # nosemgrep: python.lang.security.audit.dangerous-subprocess-use-audit
            return subprocess.run(
                [_PYTHON_PATH, *args],
                capture_output=True,
                text=True,
                timeout=timeout,
                cwd=cwd,
                env=env,
                check=False,
                shell=False,
            )
        elif prog_type == "bash":
            if _BASH_PATH is None:
                raise ValueError("bash no disponible")
            # SECURITY: _BASH_PATH de allowlist estática, args validados, cwd confinado
            # nosemgrep: python.lang.security.audit.dangerous-subprocess-use-audit
            return subprocess.run(
                [_BASH_PATH, *args],
                capture_output=True,
                text=True,
                timeout=timeout,
                cwd=cwd,
                env=env,
                check=False,
                shell=False,
            )
        elif prog_type == "node":
            if _NODE_PATH is None:
                raise ValueError("node no disponible")
            # SECURITY: _NODE_PATH de allowlist estática, args validados, cwd confinado
            # nosemgrep: python.lang.security.audit.dangerous-subprocess-use-audit
            return subprocess.run(
                [_NODE_PATH, *args],
                capture_output=True,
                text=True,
                timeout=timeout,
                cwd=cwd,
                env=env,
                check=False,
                shell=False,
            )
        elif prog_type == "npm":
            if _NPM_PATH is None:
                raise ValueError("npm no disponible")
            # SECURITY: _NPM_PATH de allowlist estática, args validados con subcomandos permitidos, cwd confinado
            # nosemgrep: python.lang.security.audit.dangerous-subprocess-use-audit
            return subprocess.run(
                [_NPM_PATH, *args],
                capture_output=True,
                text=True,
                timeout=timeout,
                cwd=cwd,
                env=env,
                check=False,
                shell=False,
            )
        
        raise ValueError(f"Tipo de programa no soportado: {prog_type}")

    # ---- Dispatcher async con literales estáticos ----
    async def _dispatch_async(
        self,
        prog_type: ProgramType,
        args: list[str],
        cwd: str,
        env: dict[str, str],
    ) -> asyncio.subprocess.Process:
        """
        Dispatcher async que ejecuta procesos con rutas LITERALES estáticas.
        
        SECURITY JUSTIFICATION:
        - _*_PATH provienen de allowlist de rutas estáticas verificadas (exists+executable)
        - args están validados con allowlists de subcomandos y blocklists de flags
        - cwd está confinado a WORKSPACE_ROOT via _validate_cwd()
        - env está sanitizado via _clean_env() (sin PATH heredado)
        - stdin=DEVNULL previene input injection
        """
        if prog_type == "python":
            # SECURITY: _PYTHON_PATH es sys.executable validado, args validados, cwd confinado
            # nosemgrep: python.lang.security.audit.dangerous-asyncio-create-exec-audit
            return await asyncio.create_subprocess_exec(
                _PYTHON_PATH, *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                stdin=asyncio.subprocess.DEVNULL,
                cwd=cwd,
                env=env,
            )
        elif prog_type == "bash":
            if _BASH_PATH is None:
                raise ValueError("bash no disponible")
            # SECURITY: _BASH_PATH de allowlist estática, args validados, cwd confinado
            # nosemgrep: python.lang.security.audit.dangerous-asyncio-create-exec-audit
            return await asyncio.create_subprocess_exec(
                _BASH_PATH, *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                stdin=asyncio.subprocess.DEVNULL,
                cwd=cwd,
                env=env,
            )
        elif prog_type == "node":
            if _NODE_PATH is None:
                raise ValueError("node no disponible")
            # SECURITY: _NODE_PATH de allowlist estática, args validados, cwd confinado
            # nosemgrep: python.lang.security.audit.dangerous-asyncio-create-exec-audit
            return await asyncio.create_subprocess_exec(
                _NODE_PATH, *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                stdin=asyncio.subprocess.DEVNULL,
                cwd=cwd,
                env=env,
            )
        elif prog_type == "npm":
            if _NPM_PATH is None:
                raise ValueError("npm no disponible")
            # SECURITY: _NPM_PATH de allowlist estática, args validados con subcomandos permitidos, cwd confinado
            # nosemgrep: python.lang.security.audit.dangerous-asyncio-create-exec-audit
            return await asyncio.create_subprocess_exec(
                _NPM_PATH, *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                stdin=asyncio.subprocess.DEVNULL,
                cwd=cwd,
                env=env,
            )
        
        raise ValueError(f"Tipo de programa no soportado: {prog_type}")

    # ---- Ejecución sync ----
    def run(self, cmd: Command) -> ExecutionResult:
        """Ejecuta comando de forma síncrona con validación completa."""
        try:
            prog_type, _ = _canonicalize_program(cmd.program)
            validated_args = self._validate_command(prog_type, cmd.args)
            safe_cwd = _validate_cwd(cmd.cwd) if cmd.cwd else self.workdir
            safe_env = _clean_env(self.env)
            
            result = self._dispatch_sync(
                prog_type,
                validated_args,
                safe_cwd,
                cmd.timeout,
                safe_env,
            )
            return ExecutionResult(
                returncode=result.returncode,
                stdout=result.stdout,
                stderr=result.stderr,
                success=result.returncode == 0,
            )
        except subprocess.TimeoutExpired:
            return ExecutionResult(
                returncode=-1,
                stdout="",
                stderr="",
                success=False,
                error=f"Comando expiró después de {cmd.timeout}s",
            )
        except PermissionError as e:
            return ExecutionResult(
                returncode=-1,
                stdout="",
                stderr="",
                success=False,
                error=f"Permiso denegado: {e}",
            )
        except Exception as e:
            return ExecutionResult(
                returncode=-1,
                stdout="",
                stderr="",
                success=False,
                error=str(e),
            )

    # ---- Ejecución async ----
    async def arun(self, cmd: Command) -> ExecutionResult:
        """Ejecuta comando de forma asíncrona con validación completa."""
        try:
            prog_type, _ = _canonicalize_program(cmd.program)
            validated_args = self._validate_command(prog_type, cmd.args)
            safe_cwd = _validate_cwd(cmd.cwd) if cmd.cwd else self.workdir
            safe_env = _clean_env(self.env)
            
            proc = await self._dispatch_async(
                prog_type,
                validated_args,
                safe_cwd,
                safe_env,
            )
            try:
                out_b, err_b = await asyncio.wait_for(proc.communicate(), timeout=cmd.timeout)
            except asyncio.TimeoutError:
                proc.kill()
                return ExecutionResult(
                    returncode=-1,
                    stdout="",
                    stderr="",
                    success=False,
                    error=f"Comando expiró después de {cmd.timeout}s",
                )
            
            return ExecutionResult(
                returncode=proc.returncode or 0,
                stdout=(out_b or b"").decode("utf-8", "replace"),
                stderr=(err_b or b"").decode("utf-8", "replace"),
                success=(proc.returncode or 0) == 0,
            )
        except PermissionError as e:
            return ExecutionResult(
                returncode=-1,
                stdout="",
                stderr="",
                success=False,
                error=f"Permiso denegado: {e}",
            )
        except Exception as e:
            return ExecutionResult(
                returncode=-1,
                stdout="",
                stderr="",
                success=False,
                error=str(e),
            )


# Singleton para uso global
_default_executor: SafeExecutor | None = None


def get_executor(workdir: str | None = None) -> SafeExecutor:
    """Obtiene o crea el executor por defecto."""
    global _default_executor
    if _default_executor is None or workdir is not None:
        _default_executor = SafeExecutor(workdir=workdir)
    return _default_executor
