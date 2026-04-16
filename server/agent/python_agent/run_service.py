#!/usr/bin/env python3
"""
🚀 Script para iniciar el servicio Agente IA v5.0
"""

import sys
import os
import io
import contextlib
from pathlib import Path

def main():
    script_dir = Path(__file__).parent
    os.chdir(script_dir)
    
    print("🔧 Verificando dependencias...")
    
    import re as _re_pkg
    ALLOWED_DEPS = frozenset(["fastapi", "uvicorn", "pydantic"])
    _PKG_PATTERN = _re_pkg.compile(r'^[a-zA-Z][a-zA-Z0-9._-]*$')
    
    def _pip_install_inprocess(pkg: str) -> bool:
        if not _PKG_PATTERN.match(pkg) or pkg not in ALLOWED_DEPS:
            return False
        old_env = os.environ.copy()
        os.environ["PIP_DISABLE_PIP_VERSION_CHECK"] = "1"
        os.environ["PIP_NO_INPUT"] = "1"
        try:
            from pip._internal.cli.main import main as pipmain
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                rc = pipmain(["install", pkg, "-q", "--no-cache-dir"])
            return rc == 0
        except Exception:
            return False
        finally:
            os.environ.clear()
            os.environ.update(old_env)
    
    for dep in ALLOWED_DEPS:
        try:
            __import__(dep.replace("-", "_"))
        except ImportError:
            print(f"  📦 Instalando {dep}...")
            _pip_install_inprocess(dep)
    
    print("✅ Dependencias OK")
    print()
    
    from service import run_server
    run_server(host="0.0.0.0", port=8081)

if __name__ == "__main__":
    main()
