from typing import Optional, Dict, Any, List
from pydantic import BaseModel, Field
from enum import Enum
from .base import BaseTool, ToolCategory, Priority, ToolInput, ToolOutput
from ..core.registry import ToolRegistry
from ..utils.retry import async_retry
import aiohttp
import json

class HttpMethod(str, Enum):
    GET = "GET"
    POST = "POST"
    PUT = "PUT"
    DELETE = "DELETE"
    PATCH = "PATCH"

class AuthType(str, Enum):
    NONE = "none"
    BEARER = "bearer"
    BASIC = "basic"
    API_KEY = "api_key"

class AuthConfig(BaseModel):
    type: AuthType = AuthType.NONE
    token: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    api_key: Optional[str] = None
    api_key_header: str = "X-API-Key"

class ApiCallInput(ToolInput):
    url: str = Field(..., min_length=1)
    method: HttpMethod = Field(HttpMethod.GET)
    headers: Dict[str, str] = Field(default_factory=dict)
    body: Optional[Dict[str, Any]] = None
    params: Optional[Dict[str, str]] = None
    auth: Optional[AuthConfig] = None
    timeout: float = Field(30.0, ge=1.0, le=300.0)
    
class ApiCallOutput(ToolOutput):
    data: Optional[Any] = None
    status_code: int = 0
    response_headers: Dict[str, str] = {}
    elapsed_ms: float = 0.0

@ToolRegistry.register
class ApiCallTool(BaseTool[ApiCallInput, ApiCallOutput]):
    name = "api_call"
    description = "Makes HTTP API calls with support for various methods and authentication"
    category = ToolCategory.APIS
    priority = Priority.CRITICAL
    dependencies = []
    
    def _build_headers(self, input: ApiCallInput) -> Dict[str, str]:
        headers = {**input.headers}
        if input.auth:
            if input.auth.type == AuthType.BEARER and input.auth.token:
                headers["Authorization"] = f"Bearer {input.auth.token}"
            elif input.auth.type == AuthType.BASIC and input.auth.username and input.auth.password:
                import base64
                credentials = base64.b64encode(
                    f"{input.auth.username}:{input.auth.password}".encode()
                ).decode()
                headers["Authorization"] = f"Basic {credentials}"
            elif input.auth.type == AuthType.API_KEY and input.auth.api_key:
                headers[input.auth.api_key_header] = input.auth.api_key
        if "Content-Type" not in headers and input.body:
            headers["Content-Type"] = "application/json"
        return headers
    
    def _parse_response(self, text: str, content_type: str) -> Any:
        if "application/json" in content_type:
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                return text
        return text
    
    @async_retry(max_attempts=3)
    async def execute(self, input: ApiCallInput) -> ApiCallOutput:
        import time
        start_time = time.time()
        
        self.logger.info("api_call", url=input.url, method=input.method.value)
        
        headers = self._build_headers(input)
        timeout = aiohttp.ClientTimeout(total=input.timeout)
        
        try:
            async with aiohttp.ClientSession(timeout=timeout) as session:
                request_kwargs: Dict[str, Any] = {
                    "url": input.url,
                    "headers": headers,
                    "params": input.params,
                }
                if input.body and input.method in [HttpMethod.POST, HttpMethod.PUT, HttpMethod.PATCH]:
                    request_kwargs["json"] = input.body
                
                async with session.request(input.method.value, **request_kwargs) as response:
                    text = await response.text()
                    content_type = response.headers.get("Content-Type", "")
                    data = self._parse_response(text, content_type)
                    elapsed_ms = (time.time() - start_time) * 1000
                    
                    return ApiCallOutput(
                        success=response.status < 400,
                        data=data,
                        status_code=response.status,
                        response_headers=dict(response.headers),
                        elapsed_ms=elapsed_ms,
                        error=None if response.status < 400 else f"HTTP {response.status}"
                    )
        except aiohttp.ClientError as e:
            elapsed_ms = (time.time() - start_time) * 1000
            self.logger.error("api_call_error", error=str(e))
            return ApiCallOutput(
                success=False,
                error=str(e),
                elapsed_ms=elapsed_ms
            )
        except Exception as e:
            elapsed_ms = (time.time() - start_time) * 1000
            self.logger.error("api_call_unexpected_error", error=str(e))
            return ApiCallOutput(
                success=False,
                error=f"Unexpected error: {str(e)}",
                elapsed_ms=elapsed_ms
            )
