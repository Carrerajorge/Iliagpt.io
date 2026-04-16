from typing import List, Optional, Dict, Any
from pydantic import Field
from .base import BaseTool, ToolCategory, Priority, ToolInput, ToolOutput
from ..core.registry import ToolRegistry

class DataStatsInput(ToolInput):
    data: List[float] = Field(..., min_length=1)
    include_percentiles: bool = Field(default=True)

class DataStatsOutput(ToolOutput):
    count: int = 0
    sum: float = 0.0
    mean: float = 0.0
    median: float = 0.0
    min: float = 0.0
    max: float = 0.0
    std_dev: float = 0.0
    variance: float = 0.0
    percentiles: Dict[str, float] = {}

@ToolRegistry.register
class DataStatsTool(BaseTool[DataStatsInput, DataStatsOutput]):
    name = "data_stats"
    description = "Calculate comprehensive statistics on numerical datasets"
    category = ToolCategory.ANALYTICS
    priority = Priority.MEDIUM
    dependencies = []
    
    async def execute(self, input: DataStatsInput) -> DataStatsOutput:
        self.logger.info("data_stats_execute", data_count=len(input.data))
        
        try:
            import math
            
            data = sorted(input.data)
            n = len(data)
            total = sum(data)
            mean = total / n
            
            if n % 2 == 0:
                median = (data[n // 2 - 1] + data[n // 2]) / 2
            else:
                median = data[n // 2]
            
            variance = sum((x - mean) ** 2 for x in data) / n
            std_dev = math.sqrt(variance)
            
            result = DataStatsOutput(
                success=True,
                count=n,
                sum=total,
                mean=mean,
                median=median,
                min=min(data),
                max=max(data),
                std_dev=std_dev,
                variance=variance
            )
            
            if input.include_percentiles:
                def percentile(p):
                    k = (n - 1) * p / 100
                    f = int(k)
                    c = f + 1 if f + 1 < n else f
                    return data[f] + (k - f) * (data[c] - data[f]) if c != f else data[f]
                
                result.percentiles = {
                    "p10": percentile(10),
                    "p25": percentile(25),
                    "p50": percentile(50),
                    "p75": percentile(75),
                    "p90": percentile(90),
                    "p95": percentile(95),
                    "p99": percentile(99)
                }
            
            return result
            
        except Exception as e:
            self.logger.error("data_stats_error", error=str(e))
            return DataStatsOutput(success=False, error=str(e))


class TrendAnalyzeInput(ToolInput):
    values: List[float] = Field(..., min_length=2)
    timestamps: Optional[List[str]] = None
    window_size: int = Field(default=3, ge=2)

class TrendAnalyzeOutput(ToolOutput):
    trend_direction: Optional[str] = None
    trend_strength: float = 0.0
    slope: float = 0.0
    moving_averages: List[float] = []
    percent_change: float = 0.0
    volatility: float = 0.0

@ToolRegistry.register
class TrendAnalyzeTool(BaseTool[TrendAnalyzeInput, TrendAnalyzeOutput]):
    name = "trend_analyze"
    description = "Analyze trends in time series data"
    category = ToolCategory.ANALYTICS
    priority = Priority.MEDIUM
    dependencies = []
    
    async def execute(self, input: TrendAnalyzeInput) -> TrendAnalyzeOutput:
        self.logger.info("trend_analyze_execute", data_points=len(input.values))
        
        try:
            import math
            
            values = input.values
            n = len(values)
            
            x_mean = (n - 1) / 2
            y_mean = sum(values) / n
            
            numerator = sum((i - x_mean) * (values[i] - y_mean) for i in range(n))
            denominator = sum((i - x_mean) ** 2 for i in range(n))
            slope = numerator / denominator if denominator != 0 else 0
            
            if slope > 0.01:
                trend_direction = "upward"
            elif slope < -0.01:
                trend_direction = "downward"
            else:
                trend_direction = "stable"
            
            y_pred = [x_mean * slope + (y_mean - x_mean * slope) + i * slope for i in range(n)]
            ss_res = sum((values[i] - y_pred[i]) ** 2 for i in range(n))
            ss_tot = sum((v - y_mean) ** 2 for v in values)
            r_squared = 1 - (ss_res / ss_tot) if ss_tot != 0 else 0
            trend_strength = max(0, min(1, abs(r_squared)))
            
            moving_averages = []
            window = min(input.window_size, n)
            for i in range(n - window + 1):
                avg = sum(values[i:i + window]) / window
                moving_averages.append(round(avg, 4))
            
            first_val = values[0]
            last_val = values[-1]
            percent_change = ((last_val - first_val) / first_val * 100) if first_val != 0 else 0
            
            returns = [(values[i] - values[i-1]) / values[i-1] if values[i-1] != 0 else 0 for i in range(1, n)]
            if returns:
                returns_mean = sum(returns) / len(returns)
                volatility = math.sqrt(sum((r - returns_mean) ** 2 for r in returns) / len(returns))
            else:
                volatility = 0
            
            return TrendAnalyzeOutput(
                success=True,
                trend_direction=trend_direction,
                trend_strength=round(trend_strength, 4),
                slope=round(slope, 6),
                moving_averages=moving_averages,
                percent_change=round(percent_change, 2),
                volatility=round(volatility, 4)
            )
            
        except Exception as e:
            self.logger.error("trend_analyze_error", error=str(e))
            return TrendAnalyzeOutput(success=False, error=str(e))
