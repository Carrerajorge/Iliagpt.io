"""API module for exposing agent tools via FastAPI."""

__all__ = ["app", "agents_router"]

def get_app():
    """Get the FastAPI app instance."""
    from .main import app
    return app

def get_agents_router():
    """Get the agents router."""
    from .agents import agents_router
    return agents_router
