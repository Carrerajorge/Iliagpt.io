"""
Authentication Middleware for FastAPI SSE Application.

Features:
- Optional authentication (skip if no API_KEY or JWT_SECRET configured)
- Support API key in X-API-Key header
- Support JWT Bearer token
- Extract user_id from auth for rate limiting
- Return 401 for invalid credentials
"""
import os
import time
import hmac
import hashlib
import base64
import json
from dataclasses import dataclass
from typing import Optional, Callable, List
from functools import lru_cache

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
import structlog

logger = structlog.get_logger(__name__)


@dataclass
class AuthConfig:
    """Authentication configuration."""
    api_keys: List[str]
    jwt_secret: Optional[str]
    jwt_algorithm: str = "HS256"
    enabled: bool = True
    
    @classmethod
    def from_env(cls) -> "AuthConfig":
        """Load auth config from environment variables."""
        api_keys_raw = os.getenv("API_KEYS", "")
        api_keys = [k.strip() for k in api_keys_raw.split(",") if k.strip()]
        
        jwt_secret = os.getenv("JWT_SECRET")
        jwt_algorithm = os.getenv("JWT_ALGORITHM", "HS256")
        
        enabled = bool(api_keys or jwt_secret)
        
        return cls(
            api_keys=api_keys,
            jwt_secret=jwt_secret,
            jwt_algorithm=jwt_algorithm,
            enabled=enabled
        )


@lru_cache()
def get_auth_config() -> AuthConfig:
    """Get cached auth configuration."""
    return AuthConfig.from_env()


@dataclass
class AuthResult:
    """Result of authentication attempt."""
    authenticated: bool
    user_id: Optional[str] = None
    auth_type: Optional[str] = None
    error: Optional[str] = None
    claims: Optional[dict] = None


def base64url_decode(data: str) -> bytes:
    """Decode base64url encoded string."""
    padding = 4 - len(data) % 4
    if padding != 4:
        data += "=" * padding
    return base64.urlsafe_b64decode(data)


def verify_jwt_simple(token: str, secret: str, algorithm: str = "HS256") -> Optional[dict]:
    """
    Simple JWT verification without external library.
    Supports HS256 algorithm only for security.
    """
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        
        header_b64, payload_b64, signature_b64 = parts
        
        header = json.loads(base64url_decode(header_b64))
        
        if header.get("alg") != algorithm:
            logger.warning("jwt_algorithm_mismatch", expected=algorithm, got=header.get("alg"))
            return None
        
        payload = json.loads(base64url_decode(payload_b64))
        
        if algorithm == "HS256":
            signing_input = f"{header_b64}.{payload_b64}".encode()
            expected_signature = hmac.new(
                secret.encode(),
                signing_input,
                hashlib.sha256
            ).digest()
            
            actual_signature = base64url_decode(signature_b64)
            
            if not hmac.compare_digest(expected_signature, actual_signature):
                return None
        else:
            logger.error("unsupported_jwt_algorithm", algorithm=algorithm)
            return None
        
        exp = payload.get("exp")
        if exp and time.time() > exp:
            logger.debug("jwt_expired", exp=exp)
            return None
        
        nbf = payload.get("nbf")
        if nbf and time.time() < nbf:
            logger.debug("jwt_not_yet_valid", nbf=nbf)
            return None
        
        return payload
        
    except Exception as e:
        logger.debug("jwt_verification_failed", error=str(e))
        return None


def verify_api_key(api_key: str, valid_keys: List[str]) -> bool:
    """Verify API key against list of valid keys using constant-time comparison."""
    if not valid_keys:
        return False
    
    for valid_key in valid_keys:
        if hmac.compare_digest(api_key.encode(), valid_key.encode()):
            return True
    
    return False


class AuthMiddleware(BaseHTTPMiddleware):
    """
    Optional authentication middleware.
    
    Features:
    - Skips auth if no API_KEYS or JWT_SECRET configured
    - Supports X-API-Key header
    - Supports Authorization: Bearer <token> header
    - Extracts user_id to request.state for rate limiting
    """
    
    def __init__(
        self,
        app,
        config: Optional[AuthConfig] = None,
        exclude_paths: Optional[List[str]] = None,
        require_auth_paths: Optional[List[str]] = None
    ):
        super().__init__(app)
        self.config = config or get_auth_config()
        
        self.exclude_paths = exclude_paths or [
            "/healthz",
            "/readyz",
            "/metrics",
            "/docs",
            "/redoc",
            "/openapi.json",
            "/",
        ]
        
        self.require_auth_paths = require_auth_paths or [
            "/chat",
            "/session",
        ]
    
    def _should_skip_auth(self, path: str) -> bool:
        """Check if path should skip authentication."""
        if not self.config.enabled:
            return True
        
        for exclude in self.exclude_paths:
            if path.startswith(exclude) or path == exclude:
                return True
        
        return False
    
    def _requires_auth(self, path: str) -> bool:
        """Check if path requires authentication."""
        for require_path in self.require_auth_paths:
            if path.startswith(require_path):
                return True
        return False
    
    def _authenticate(self, request: Request) -> AuthResult:
        """Attempt to authenticate the request."""
        api_key = request.headers.get("X-API-Key")
        if api_key:
            if verify_api_key(api_key, self.config.api_keys):
                user_id = f"apikey:{hashlib.sha256(api_key.encode()).hexdigest()[:16]}"
                return AuthResult(
                    authenticated=True,
                    user_id=user_id,
                    auth_type="api_key"
                )
            else:
                return AuthResult(
                    authenticated=False,
                    error="Invalid API key"
                )
        
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header[7:]
            
            if self.config.jwt_secret:
                claims = verify_jwt_simple(
                    token,
                    self.config.jwt_secret,
                    self.config.jwt_algorithm
                )
                
                if claims:
                    user_id = claims.get("sub") or claims.get("user_id") or claims.get("id")
                    return AuthResult(
                        authenticated=True,
                        user_id=str(user_id) if user_id else None,
                        auth_type="jwt",
                        claims=claims
                    )
                else:
                    return AuthResult(
                        authenticated=False,
                        error="Invalid or expired JWT token"
                    )
            else:
                return AuthResult(
                    authenticated=False,
                    error="JWT authentication not configured"
                )
        
        return AuthResult(
            authenticated=False,
            error="No valid authentication provided"
        )
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """Process request with optional authentication."""
        path = request.url.path
        
        if self._should_skip_auth(path):
            return await call_next(request)
        
        auth_result = self._authenticate(request)
        
        if auth_result.authenticated:
            request.state.user_id = auth_result.user_id
            request.state.auth_type = auth_result.auth_type
            if auth_result.claims:
                request.state.auth_claims = auth_result.claims
            
            logger.debug(
                "auth_success",
                user_id=auth_result.user_id,
                auth_type=auth_result.auth_type,
                path=path
            )
            
            return await call_next(request)
        
        if self._requires_auth(path):
            logger.warning(
                "auth_failed",
                error=auth_result.error,
                path=path
            )
            
            return Response(
                content=json.dumps({
                    "error": "Unauthorized",
                    "detail": auth_result.error
                }),
                status_code=401,
                media_type="application/json",
                headers={
                    "WWW-Authenticate": 'Bearer realm="api"'
                }
            )
        
        return await call_next(request)


def create_auth_middleware(
    api_keys: Optional[List[str]] = None,
    jwt_secret: Optional[str] = None,
    jwt_algorithm: str = "HS256",
    exclude_paths: Optional[List[str]] = None,
    require_auth_paths: Optional[List[str]] = None
) -> type:
    """
    Factory function to create configured auth middleware.
    
    Args:
        api_keys: List of valid API keys
        jwt_secret: Secret for JWT verification
        jwt_algorithm: JWT algorithm (default HS256)
        exclude_paths: Paths to skip authentication
        require_auth_paths: Paths that require authentication
    """
    config = AuthConfig(
        api_keys=api_keys or [],
        jwt_secret=jwt_secret,
        jwt_algorithm=jwt_algorithm,
        enabled=bool(api_keys or jwt_secret)
    )
    
    class ConfiguredAuthMiddleware(AuthMiddleware):
        def __init__(self, app):
            super().__init__(
                app,
                config=config,
                exclude_paths=exclude_paths,
                require_auth_paths=require_auth_paths
            )
    
    return ConfiguredAuthMiddleware
