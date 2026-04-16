from typing import Optional, Dict
from pydantic import Field, SecretStr
from .base import BaseTool, ToolCategory, Priority, ToolInput, ToolOutput
from ..core.registry import ToolRegistry
import os

class SecretsGetInput(ToolInput):
    key: str = Field(..., pattern=r"^[A-Z][A-Z0-9_]*$")

class SecretsSetInput(ToolInput):
    key: str = Field(..., pattern=r"^[A-Z][A-Z0-9_]*$")
    value: SecretStr

class SecretsOutput(ToolOutput):
    exists: bool = False
    
@ToolRegistry.register
class SecretsManageTool(BaseTool[SecretsGetInput, SecretsOutput]):
    name = "secrets_manage"
    description = "Securely manages secrets and API keys"
    category = ToolCategory.SECURITY
    priority = Priority.CRITICAL
    dependencies = []
    
    def __init__(self):
        super().__init__()
        self._secrets: Dict[str, str] = {}
    
    async def execute(self, input: SecretsGetInput) -> SecretsOutput:
        self.logger.info("secrets_get", key=input.key)
        value = os.environ.get(input.key) or self._secrets.get(input.key)
        return SecretsOutput(
            success=True,
            exists=value is not None,
            data={"key": input.key} if value else None
        )
    
    async def set_secret(self, input: SecretsSetInput) -> SecretsOutput:
        self.logger.info("secrets_set", key=input.key)
        self._secrets[input.key] = input.value.get_secret_value()
        return SecretsOutput(success=True, exists=True)
