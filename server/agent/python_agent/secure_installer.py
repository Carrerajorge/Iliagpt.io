"""Secure package installation with strict validation - no subprocess."""
from __future__ import annotations

import io
import os
import re
import logging
import contextlib
from pathlib import Path
from typing import FrozenSet, Optional

try:
    from packaging.requirements import Requirement
except ImportError:
    Requirement = None  # type: ignore

logger = logging.getLogger(__name__)

WORKSPACE_ROOT = Path(os.getenv("WORKSPACE_ROOT", Path.cwd())).resolve()

ALLOWED_PACKAGES: FrozenSet[str] = frozenset([
    "aiofiles", "rich", "httpx", "aiohttp", "beautifulsoup4", "lxml",
    "python-pptx", "python-docx", "openpyxl", "pillow", "fake-useragent",
    "diskcache", "playwright", "selenium", "webdriver-manager",
    "pandas", "matplotlib", "numpy", "fastapi", "uvicorn", "pydantic"
])

_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")
_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
_PIN_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*==[A-Za-z0-9][A-Za-z0-9.*+!-]*$")


class InstallError(RuntimeError):
    """Secure error (no sensitive data) for dependency installation failures."""


def _pkg_name_for_log(req: str) -> str:
    """Return minimal identifier for logs (name only, no version/URLs/tokens)."""
    if Requirement is not None:
        try:
            return Requirement(req).name
        except Exception:
            pass
    for sep in ("==", ">=", "<=", "~=", ">", "<", "@"):
        if sep in req:
            return req.split(sep, 1)[0].strip()
    return req.strip()


def _validate_requirement(req: str, require_pin: bool = False) -> str:
    if not isinstance(req, str):
        raise TypeError("pkg must be string")
    req = req.strip()
    if not req or len(req) > 200:
        raise ValueError("pkg invalid (empty or too long)")
    if _CONTROL_CHARS.search(req):
        raise ValueError("pkg invalid (control chars)")
    if req.startswith("-") or any(ch.isspace() for ch in req):
        raise ValueError("pkg invalid (looks like flag or contains spaces)")
    blocked = ("@", "://", "git+", "hg+", "svn+", "bzr+", "../", "\\", ":")
    if any(t in req for t in blocked) or req.startswith((".", "/")):
        raise ValueError("pkg invalid (URL/VCS/path not allowed)")

    if Requirement is not None:
        try:
            r = Requirement(req)
        except Exception as e:
            raise ValueError(f"Invalid package specification: {type(e).__name__}")
        if r.url is not None or r.marker is not None or r.extras:
            raise ValueError("pkg invalid (extras/marker/url not allowed)")
        if not _NAME_RE.match(r.name):
            raise ValueError("Invalid package name")
        if require_pin:
            spec = str(r.specifier)
            if "==" not in spec or spec.count("==") != 1:
                raise ValueError("Exact pin required: package==version")
        normalized = f"{r.name}{r.specifier}" if r.specifier else r.name
        base_name = r.name.lower()
    else:
        if require_pin and not _PIN_RE.match(req):
            raise ValueError("Exact pin required: package==version")
        base_name = req.split("=")[0].split("<")[0].split(">")[0].split("!")[0].split("[")[0]
        if not _NAME_RE.match(base_name):
            raise ValueError("Invalid package name format")
        normalized = req
        base_name = base_name.lower()

    if base_name not in {p.lower() for p in ALLOWED_PACKAGES}:
        raise PermissionError(f"Package not in allowlist: {base_name}")

    return normalized


def validate_package_name(pkg: str) -> bool:
    try:
        _validate_requirement(pkg, require_pin=False)
        return True
    except (ValueError, TypeError, PermissionError):
        return False


def safe_pip_install(pkg: str, quiet: bool = True, timeout: int = 120, context: Optional[str] = None) -> bool:
    """
    Install a validated dependency.
    IMPORTANT: Never print or log the full requirement string.
    """
    pkg_for_log = _pkg_name_for_log(pkg)
    
    try:
        safe_req = _validate_requirement(pkg, require_pin=False)
    except (ValueError, TypeError, PermissionError) as e:
        msg_ctx = f" ({context})" if context else ""
        logger.warning("Package validation failed%s: package=%s error_type=%s",
                      msg_ctx, pkg_for_log, type(e).__name__)
        return False

    old_env = os.environ.copy()
    os.environ["PIP_DISABLE_PIP_VERSION_CHECK"] = "1"
    os.environ["PIP_NO_INPUT"] = "1"
    os.environ["PIP_CONFIG_FILE"] = os.devnull
    os.environ["PIP_NO_CACHE_DIR"] = "1"

    stdout_buf, stderr_buf = io.StringIO(), io.StringIO()

    try:
        from pip._internal.cli.main import main as pipmain

        args = ["install", safe_req]
        if quiet:
            args.extend(["-q", "--disable-pip-version-check", "--no-input", "--no-cache-dir"])

        with contextlib.redirect_stdout(stdout_buf), contextlib.redirect_stderr(stderr_buf):
            rc = int(pipmain(args))

        return rc == 0
    except Exception as e:
        msg_ctx = f" ({context})" if context else ""
        logger.error("Dependency install failed%s: package=%s error_type=%s",
                    msg_ctx, pkg_for_log, type(e).__name__)
        return False
    finally:
        os.environ.clear()
        os.environ.update(old_env)


def install_requirement(safe_req: str, *, context: Optional[str] = None) -> None:
    """
    Install a pre-validated dependency.
    IMPORTANT: Never print or log the full requirement string.
    Raises InstallError on failure (without sensitive data).
    """
    pkg_for_log = _pkg_name_for_log(safe_req)
    
    if not safe_pip_install(safe_req, quiet=True, context=context):
        msg_ctx = f" ({context})" if context else ""
        logger.error("Dependency install failed%s: package=%s",
                    msg_ctx, pkg_for_log)
        raise InstallError(f"Failed to install dependency: {pkg_for_log}")
