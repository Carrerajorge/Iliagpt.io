#!/usr/bin/env python3
"""
🚀 Agente IA v5.0 - Servicio FastAPI
=====================================
Expone el agente como API REST en el puerto 8081

Endpoints:
- POST /run           - Ejecutar comando en el agente
- GET  /tools         - Listar herramientas disponibles
- GET  /status        - Estado del agente
- GET  /health        - Health check
- POST /browse        - Navegar a URL específica
- POST /search        - Búsqueda web
- POST /document      - Crear documento
- POST /execute       - Ejecutar herramienta directa
"""

import asyncio
import sys
import os
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, Any, List
from contextlib import asynccontextmanager

# Añadir el directorio padre al path para importar el agente
sys.path.insert(0, str(Path(__file__).parent.parent))

# Instalar dependencias del servidor con validación estricta (sin subprocess)
import io
import contextlib
import re as _re_pkg
ALLOWED_SERVER_PACKAGES = frozenset(["fastapi", "uvicorn", "pydantic"])
_PKG_PATTERN = _re_pkg.compile(r'^[a-zA-Z][a-zA-Z0-9._-]*$')

def _pip_install_inprocess(pkg: str) -> bool:
    if not _PKG_PATTERN.match(pkg) or pkg not in ALLOWED_SERVER_PACKAGES:
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

for pkg in ALLOWED_SERVER_PACKAGES:
    try:
        __import__(pkg)
    except ImportError:
        _pip_install_inprocess(pkg)

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel, Field

# Importar el agente
from agent_v5 import (
    Agent, AgentConfig, VERSION, OUTPUT_DIR, SCREENSHOTS_DIR,
    cache, browser, viz
)

# ═══════════════════════════════════════════════════════════════════════════════
# MODELOS PYDANTIC
# ═══════════════════════════════════════════════════════════════════════════════

class RunRequest(BaseModel):
    """Solicitud para ejecutar el agente."""
    message: str = Field(..., description="Mensaje/comando para el agente")
    verbose: bool = Field(True, description="Mostrar proceso detallado")
    session_id: Optional[str] = Field(None, description="ID de sesión opcional")

class RunResponse(BaseModel):
    """Respuesta de ejecución."""
    success: bool
    result: str
    files_created: List[str] = []
    screenshots: List[str] = []
    execution_time: float
    iterations: int

class BrowseRequest(BaseModel):
    """Solicitud para navegar."""
    url: str
    screenshot: bool = True
    scroll: bool = False
    wait_for: str = "load"  # load, domcontentloaded, networkidle

class SearchRequest(BaseModel):
    """Solicitud de búsqueda."""
    query: str
    num_results: int = 10
    use_browser: bool = False

class DocumentRequest(BaseModel):
    """Solicitud para crear documento."""
    doc_type: str = Field(..., description="pptx, docx, xlsx")
    title: str
    content: Any
    theme: str = "professional"
    filename: Optional[str] = None

class ExecuteRequest(BaseModel):
    """Ejecutar herramienta directa."""
    tool: str
    params: Dict[str, Any] = {}

class ToolInfo(BaseModel):
    """Información de herramienta."""
    name: str
    description: str
    category: str

class StatusResponse(BaseModel):
    """Estado del agente."""
    version: str
    status: str
    tools_count: int
    browser_engine: str
    cache_stats: Dict[str, Any]
    uptime_seconds: float

# ═══════════════════════════════════════════════════════════════════════════════
# APLICACIÓN FASTAPI
# ═══════════════════════════════════════════════════════════════════════════════

# Variables globales
agent: Optional[Agent] = None
start_time: datetime = datetime.now()

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Gestión del ciclo de vida de la aplicación."""
    global agent, start_time
    
    print("🚀 Iniciando Agente IA v5.0 Service...")
    
    # Inicializar agente
    agent = Agent(AgentConfig(
        name="Agente IA v5.0 API",
        verbose=False,  # Menos verbose en modo API
        max_iterations=100,
        timeout=60
    ))
    start_time = datetime.now()
    
    print(f"✅ Agente inicializado con {len(agent.tools.list_tools())} herramientas")
    print(f"🌐 Navegador: {browser.engine.value}")
    print(f"📁 Output: {OUTPUT_DIR}")
    
    yield
    
    # Cleanup
    print("🔄 Cerrando servicio...")
    if agent:
        await agent.cleanup()
    print("👋 Servicio cerrado")

app = FastAPI(
    title="Agente IA v5.0 API",
    description="API REST para el Agente IA v5.0 con navegador web, documentos y más",
    version=VERSION,
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ═══════════════════════════════════════════════════════════════════════════════
# ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/", tags=["Info"])
async def root():
    """Información del servicio."""
    return {
        "service": "Agente IA v5.0 API",
        "version": VERSION,
        "status": "running",
        "endpoints": {
            "run": "POST /run - Ejecutar agente",
            "tools": "GET /tools - Listar herramientas",
            "browse": "POST /browse - Navegar URL",
            "search": "POST /search - Búsqueda web",
            "document": "POST /document - Crear documento",
            "execute": "POST /execute - Ejecutar herramienta",
            "status": "GET /status - Estado del agente",
            "health": "GET /health - Health check"
        }
    }

@app.get("/health", tags=["System"])
async def health_check():
    """Health check del servicio."""
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "version": VERSION
    }

@app.get("/status", response_model=StatusResponse, tags=["System"])
async def get_status():
    """Obtener estado detallado del agente."""
    global agent, start_time
    
    if not agent:
        raise HTTPException(status_code=503, detail="Agente no inicializado")
    
    uptime = (datetime.now() - start_time).total_seconds()
    status = agent.get_status()
    
    return StatusResponse(
        version=VERSION,
        status=status.get('state', 'unknown'),
        tools_count=status.get('tools', 0),
        browser_engine=status.get('browser', 'unknown'),
        cache_stats=cache.get_stats(),
        uptime_seconds=uptime
    )

@app.get("/tools", response_model=List[ToolInfo], tags=["Tools"])
async def list_tools():
    """Listar herramientas disponibles."""
    global agent
    
    if not agent:
        raise HTTPException(status_code=503, detail="Agente no inicializado")
    
    return [
        ToolInfo(
            name=t['name'],
            description=t['description'],
            category=t['category']
        )
        for t in agent.tools.get_schemas()
    ]

@app.post("/run", response_model=RunResponse, tags=["Agent"])
async def run_agent(request: RunRequest):
    """
    Ejecutar el agente con un mensaje/comando.
    
    Ejemplos:
    - "Crea una presentación sobre inteligencia artificial"
    - "Investiga sobre cambio climático"
    - "Navega a https://example.com"
    - "Busca noticias sobre tecnología"
    """
    global agent
    
    if not agent:
        raise HTTPException(status_code=503, detail="Agente no inicializado")
    
    # Configurar verbosidad temporal
    original_verbose = agent.config.verbose
    agent.config.verbose = request.verbose
    
    start = datetime.now()
    
    try:
        result = await agent.run(request.message)
        
        # Recopilar archivos creados
        files_created = []
        screenshots = []
        
        if agent.current_plan:
            for phase in agent.current_plan.phases:
                for step in phase.steps:
                    if step.result and isinstance(step.result, dict):
                        if step.result.get('path'):
                            files_created.append(step.result['path'])
                        if step.result.get('screenshot'):
                            screenshots.append(step.result['screenshot'])
        
        execution_time = (datetime.now() - start).total_seconds()
        
        return RunResponse(
            success=True,
            result=result,
            files_created=files_created,
            screenshots=screenshots,
            execution_time=execution_time,
            iterations=agent.iteration
        )
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
    finally:
        agent.config.verbose = original_verbose

@app.post("/browse", tags=["Browser"])
async def browse_url(request: BrowseRequest):
    """Navegar a una URL y extraer contenido."""
    global agent
    
    if not agent:
        raise HTTPException(status_code=503, detail="Agente no inicializado")
    
    try:
        result = await agent.execute_direct(
            'browser',
            url=request.url,
            screenshot=request.screenshot,
            scroll=request.scroll,
            wait_for=request.wait_for
        )
        
        return {
            "success": result.success,
            "data": result.data,
            "message": result.message,
            "error": result.error,
            "screenshots": result.screenshots
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/search", tags=["Search"])
async def search_web(request: SearchRequest):
    """Realizar búsqueda web."""
    global agent
    
    if not agent:
        raise HTTPException(status_code=503, detail="Agente no inicializado")
    
    try:
        result = await agent.execute_direct(
            'search',
            query=request.query,
            num_results=request.num_results,
            use_browser=request.use_browser
        )
        
        return {
            "success": result.success,
            "query": request.query,
            "results": result.data.get('results', []) if result.data else [],
            "total": result.data.get('total', 0) if result.data else 0,
            "cached": result.cached
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/document", tags=["Documents"])
async def create_document(request: DocumentRequest):
    """Crear documento (PPTX, DOCX, XLSX)."""
    global agent
    
    if not agent:
        raise HTTPException(status_code=503, detail="Agente no inicializado")
    
    try:
        result = await agent.execute_direct(
            'document',
            doc_type=request.doc_type,
            title=request.title,
            content=request.content,
            theme=request.theme,
            filename=request.filename
        )
        
        return {
            "success": result.success,
            "message": result.message,
            "files_created": result.files_created,
            "error": result.error
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/execute", tags=["Tools"])
async def execute_tool(request: ExecuteRequest):
    """Ejecutar una herramienta directamente."""
    global agent
    
    if not agent:
        raise HTTPException(status_code=503, detail="Agente no inicializado")
    
    if request.tool not in agent.tools.list_tools():
        raise HTTPException(
            status_code=400, 
            detail=f"Herramienta '{request.tool}' no encontrada. Disponibles: {agent.tools.list_tools()}"
        )
    
    try:
        result = await agent.execute_direct(request.tool, **request.params)
        
        return {
            "success": result.success,
            "tool": request.tool,
            "data": result.data,
            "message": result.message,
            "error": result.error,
            "files_created": result.files_created,
            "screenshots": result.screenshots,
            "execution_time": result.execution_time
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/files/{filename}", tags=["Files"])
async def download_file(filename: str):
    """Descargar archivo creado."""
    # Buscar en output y screenshots
    for directory in [OUTPUT_DIR, SCREENSHOTS_DIR]:
        filepath = directory / filename
        if filepath.exists():
            return FileResponse(
                path=str(filepath),
                filename=filename,
                media_type="application/octet-stream"
            )
    
    raise HTTPException(status_code=404, detail=f"Archivo no encontrado: {filename}")

@app.get("/files", tags=["Files"])
async def list_files():
    """Listar archivos creados."""
    files = []
    
    for directory, category in [(OUTPUT_DIR, "output"), (SCREENSHOTS_DIR, "screenshot")]:
        if directory.exists():
            for f in directory.iterdir():
                if f.is_file() and not f.name.startswith('.'):
                    files.append({
                        "name": f.name,
                        "category": category,
                        "size": f.stat().st_size,
                        "modified": datetime.fromtimestamp(f.stat().st_mtime).isoformat(),
                        "download_url": f"/files/{f.name}"
                    })
    
    return {"files": files, "count": len(files)}

@app.delete("/cache", tags=["System"])
async def clear_cache():
    """Limpiar caché."""
    cache.clear()
    return {"message": "Caché limpiado", "stats": cache.get_stats()}

# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════

def run_server(host: str = "0.0.0.0", port: int = 8081):
    """Iniciar el servidor."""
    import uvicorn
    
    print(f"""
╔═══════════════════════════════════════════════════════════════════════════════╗
║                    🚀 AGENTE IA v5.0 - API SERVICE 🚀                         ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  Servidor: http://{host}:{port}                                              ║
║  Docs:     http://{host}:{port}/docs                                         ║
║  ReDoc:    http://{host}:{port}/redoc                                        ║
╚═══════════════════════════════════════════════════════════════════════════════╝
    """)
    
    uvicorn.run(app, host=host, port=port, log_level="info")

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Agente IA v5.0 API Service")
    parser.add_argument("--host", default="0.0.0.0", help="Host (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8081, help="Puerto (default: 8081)")
    
    args = parser.parse_args()
    run_server(args.host, args.port)
