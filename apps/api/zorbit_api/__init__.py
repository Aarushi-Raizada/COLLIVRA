"""FastAPI server application for COLLIVRA."""

from zorbit_api.main import app, create_app, lifespan

__version__ = "0.1.0"

__all__ = ["app", "create_app", "lifespan", "__version__"]
