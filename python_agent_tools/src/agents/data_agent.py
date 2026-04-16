"""Data Agent - Data analysis, transformation, and visualization."""

from typing import Any, Dict, List, Optional
from .base_agent import BaseAgent, AgentConfig, AgentResult, AgentState
import structlog


class DataAgentConfig(AgentConfig):
    """Configuration for the Data Agent."""
    max_data_size_mb: int = 100
    supported_formats: List[str] = ["csv", "json", "xlsx", "parquet"]
    enable_visualization: bool = True
    cache_results: bool = True


class DataAgent(BaseAgent):
    """Agent specialized in data analysis, transformation, and visualization."""
    
    name = "data"
    
    def __init__(
        self,
        config: Optional[DataAgentConfig] = None,
        tools: Optional[List] = None,
        memory = None,
    ):
        super().__init__(tools=tools, memory=memory)
        self.config = config or DataAgentConfig(name="data")
        self._data_cache: Dict[str, Any] = {}
    
    @property
    def description(self) -> str:
        return "Analyzes, transforms, and visualizes data from various sources and formats"
    
    @property
    def category(self) -> str:
        return "data"
    
    @property
    def tools_used(self) -> List[str]:
        return ["file_read", "file_write", "code_execute", "reason"]
    
    def get_system_prompt(self) -> str:
        return """You are the Data Agent, specialized in data analysis and transformation.
Your role is to:
1. Load and parse data from various formats (CSV, JSON, Excel, Parquet)
2. Clean and preprocess data for analysis
3. Perform statistical analysis and aggregations
4. Transform and reshape data as needed
5. Generate visualizations and charts
6. Export data in requested formats

Data analysis capabilities:
- Descriptive statistics (mean, median, std, etc.)
- Correlation and regression analysis
- Time series analysis
- Grouping and aggregation
- Pivot tables and cross-tabulations

Visualization types:
- Bar charts, line charts, scatter plots
- Histograms and distributions
- Heatmaps and correlation matrices
- Time series plots
- Pie charts and treemaps

Best practices:
- Validate data quality before analysis
- Handle missing values appropriately
- Document transformations applied
- Optimize for large datasets"""
    
    async def load_data(self, path: str, format: Optional[str] = None) -> Dict[str, Any]:
        """Load data from a file."""
        if format and format not in self.config.supported_formats:
            return {"error": f"Format '{format}' not supported"}
        
        if path in self._data_cache and self.config.cache_results:
            return self._data_cache[path]
        
        result = await self.execute_tool("file_read", {"path": path})
        
        if result.success and result.data is not None:
            self._data_cache[path] = result.data
            return result.data if isinstance(result.data, dict) else {"result": result.data}
        return {"error": result.error}
    
    async def analyze(self, data: Any, analysis_type: str = "describe") -> Dict[str, Any]:
        """Perform analysis on the data."""
        result = await self.execute_tool("code_execute", {
            "code": f"""
import pandas as pd
import json

data = {repr(data)}
df = pd.DataFrame(data) if isinstance(data, (list, dict)) else data

if '{analysis_type}' == 'describe':
    result = df.describe().to_dict()
elif '{analysis_type}' == 'info':
    result = {{'columns': list(df.columns), 'dtypes': df.dtypes.astype(str).to_dict(), 'shape': df.shape}}
else:
    result = df.to_dict()

print(json.dumps(result))
""",
            "language": "python"
        })
        
        if result.success and result.data is not None:
            return result.data if isinstance(result.data, dict) else {"result": result.data}
        return {"error": result.error}
    
    async def transform(self, data: Any, transformation: str) -> Dict[str, Any]:
        """Apply a transformation to the data."""
        result = await self.execute_tool("reason", {
            "task": f"Transform the data: {transformation}",
            "context": {"data_sample": str(data)[:1000]}
        })
        
        if result.success and result.data is not None:
            return result.data if isinstance(result.data, dict) else {"result": result.data}
        return {"error": result.error}
    
    async def visualize(self, data: Any, chart_type: str = "bar") -> Dict[str, Any]:
        """Generate a visualization of the data."""
        if not self.config.enable_visualization:
            return {"error": "Visualization disabled"}
        
        result = await self.execute_tool("code_execute", {
            "code": f"""
import matplotlib.pyplot as plt
import pandas as pd
import json

data = {repr(data)}
df = pd.DataFrame(data)

fig, ax = plt.subplots()
if '{chart_type}' == 'bar':
    df.plot(kind='bar', ax=ax)
elif '{chart_type}' == 'line':
    df.plot(kind='line', ax=ax)
elif '{chart_type}' == 'scatter':
    df.plot(kind='scatter', x=df.columns[0], y=df.columns[1], ax=ax)
else:
    df.plot(ax=ax)

plt.tight_layout()
plt.savefig('/tmp/chart.png')
print(json.dumps({{'chart_path': '/tmp/chart.png', 'chart_type': '{chart_type}'}}))
""",
            "language": "python"
        })
        
        if result.success and result.data is not None:
            return result.data if isinstance(result.data, dict) else {"result": result.data}
        return {"error": result.error}
    
    async def run(self, task: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Execute the data agent's main loop."""
        self.state = AgentState.EXECUTING
        context = context or {}
        
        data = context.get("data")
        
        if "analyze" in task.lower():
            analysis = await self.analyze(data, "describe")
            return {"action": "analyze", "analysis": analysis}
        elif "transform" in task.lower():
            transformed = await self.transform(data, task)
            return {"action": "transform", "result": transformed}
        elif "visualize" in task.lower() or "chart" in task.lower():
            chart = await self.visualize(data, context.get("chart_type", "bar"))
            return {"action": "visualize", "chart": chart}
        elif "load" in task.lower():
            path = context.get("path", "")
            loaded = await self.load_data(path)
            return {"action": "load", "data": loaded}
        else:
            analysis = await self.analyze(data, "describe")
            return {"action": "analyze", "analysis": analysis}
    
    async def plan(self, task: str, context: Dict[str, Any]) -> List[str]:
        """Generate a plan for the data task."""
        return [f"Execute data task: {task}"]
    
    async def execute(self, task: str, context: Optional[Dict[str, Any]] = None) -> AgentResult:
        """Execute a data task."""
        self.logger.info("data_execute", task=task[:100] if task else "")
        self.state = AgentState.EXECUTING
        
        try:
            result = await self.run(task, context)
            self.state = AgentState.COMPLETED
            return AgentResult(
                success=True,
                data=result,
                metadata={"cached_datasets": len(self._data_cache)}
            )
        except Exception as e:
            self.state = AgentState.ERROR
            self.logger.error("data_error", error=str(e))
            return AgentResult(success=False, error=str(e))
    
    async def initialize(self) -> None:
        """Initialize the data agent."""
        await super().initialize()
        self._data_cache = {}
        self.logger.info("data_agent_initialized", formats=self.config.supported_formats)
    
    async def shutdown(self) -> None:
        """Shutdown the data agent."""
        self._data_cache.clear()
        await super().shutdown()
        self.logger.info("data_agent_shutdown")
