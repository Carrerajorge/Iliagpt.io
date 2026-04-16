"""Production-ready API runner with uvicorn."""

import os
import sys
import signal
import uvicorn
import structlog

logger = structlog.get_logger(__name__)

def get_production_config() -> dict:
    """Get production-optimized uvicorn configuration."""
    workers = int(os.environ.get("WORKERS", "1"))
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8001"))
    log_level = os.environ.get("LOG_LEVEL", "info").lower()
    
    return {
        "app": "src.api.main:app",
        "host": host,
        "port": port,
        "workers": workers,
        "log_level": log_level,
        "access_log": True,
        "proxy_headers": True,
        "forwarded_allow_ips": "*",
        "timeout_keep_alive": 30,
        "timeout_notify": 30,
        "limit_concurrency": 100,
        "limit_max_requests": 10000,
        "backlog": 2048,
    }


def setup_signal_handlers():
    """Setup graceful shutdown handlers."""
    def handle_signal(signum, frame):
        logger.info("shutdown_signal_received", signal=signum)
        sys.exit(0)
    
    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)


def main():
    """Run the API server."""
    setup_signal_handlers()
    
    config = get_production_config()
    
    logger.info(
        "starting_api_server",
        host=config["host"],
        port=config["port"],
        workers=config["workers"],
        log_level=config["log_level"]
    )
    
    if config["workers"] > 1:
        uvicorn.run(**config)
    else:
        from src.api.main import app
        uvicorn.run(
            app,
            host=config["host"],
            port=config["port"],
            log_level=config["log_level"],
            access_log=config["access_log"],
            proxy_headers=config["proxy_headers"],
            forwarded_allow_ips=config["forwarded_allow_ips"],
            timeout_keep_alive=config["timeout_keep_alive"],
        )


if __name__ == "__main__":
    main()
