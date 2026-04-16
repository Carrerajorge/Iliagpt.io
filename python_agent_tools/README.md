# Python Agent Tools

A modular framework for building AI agents with tools.

## Installation

```bash
pip install python-agent-tools
```

## Quick Start

```python
from src.tools.base import BaseTool, ToolInput, ToolOutput, ToolCategory, Priority
from src.agents.base_agent import BaseAgent

# Define a custom tool
class MyToolInput(ToolInput):
    query: str

class MyTool(BaseTool[MyToolInput, ToolOutput]):
    name = "my_tool"
    description = "A custom tool"
    category = ToolCategory.PROCESSING
    priority = Priority.MEDIUM
    
    async def execute(self, input: MyToolInput) -> ToolOutput:
        return ToolOutput(success=True, data={"result": input.query})
```

## Features

- **Modular Tools**: Build reusable tools with typed inputs/outputs
- **Agent Framework**: Create agents that orchestrate multiple tools
- **Memory System**: Pluggable memory backends for context management
- **LLM Adapters**: Support for OpenAI, Anthropic, and more
- **Metrics**: Built-in Prometheus metrics for monitoring
- **Retry Logic**: Exponential backoff with configurable retries
- **Rate Limiting**: Token bucket and sliding window rate limiters

## Project Structure

```
python_agent_tools/
├── src/
│   ├── core/           # Orchestration, memory, reasoning
│   ├── tools/          # Tool base classes and implementations
│   ├── integrations/   # LLM adapters, databases, vector stores
│   ├── agents/         # Agent base classes
│   └── utils/          # Config, logging, retry, metrics
├── tests/              # Test suite
├── pyproject.toml      # Project configuration
└── README.md
```

## Development

```bash
# Install dev dependencies
pip install -e ".[dev]"

# Run tests
pytest

# Format code
black src tests
ruff check src tests --fix
```

## License

MIT
