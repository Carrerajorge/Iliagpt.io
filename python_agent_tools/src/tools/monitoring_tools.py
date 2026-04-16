from typing import List, Optional, Dict, Any, TYPE_CHECKING, Literal
from pydantic import Field
from .base import BaseTool, ToolCategory, Priority, ToolInput, ToolOutput
from ..core.registry import ToolRegistry
import asyncio
import os
import sys

if TYPE_CHECKING:
    import psutil as psutil_type

try:
    import psutil
    PSUTIL_AVAILABLE = True
except ImportError:
    psutil = None  # type: ignore[assignment]
    PSUTIL_AVAILABLE = False

def is_linux() -> bool:
    return sys.platform.startswith('linux')

def proc_filesystem_available() -> bool:
    return os.path.exists('/proc')


class SystemMonitorInput(ToolInput):
    include_cpu: bool = Field(default=True)
    include_memory: bool = Field(default=True)
    include_disk: bool = Field(default=True)
    include_network: bool = Field(default=False)

class SystemMonitorOutput(ToolOutput):
    cpu_percent: Optional[float] = None
    cpu_count: Optional[int] = None
    memory_total_gb: Optional[float] = None
    memory_used_gb: Optional[float] = None
    memory_percent: Optional[float] = None
    disk_total_gb: Optional[float] = None
    disk_used_gb: Optional[float] = None
    disk_percent: Optional[float] = None
    uptime_seconds: Optional[float] = None

@ToolRegistry.register
class SystemMonitorTool(BaseTool[SystemMonitorInput, SystemMonitorOutput]):
    name = "system_monitor"
    description = "Get system resource usage including CPU, memory, and disk"
    category = ToolCategory.MONITORING
    priority = Priority.HIGH
    dependencies = []
    
    async def _get_cpu_info_linux(self) -> tuple[Optional[float], Optional[int]]:
        cpu_percent = None
        cpu_count = None
        
        try:
            proc = await asyncio.create_subprocess_shell(
                "grep 'cpu ' /proc/stat",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, _ = await proc.communicate()
            if stdout:
                parts = stdout.decode().split()
                if len(parts) >= 5:
                    user, nice, system, idle = map(int, parts[1:5])
                    total = user + nice + system + idle
                    cpu_percent = round((total - idle) / total * 100, 2) if total > 0 else 0
        except (FileNotFoundError, PermissionError, OSError):
            pass
        
        try:
            proc = await asyncio.create_subprocess_shell(
                "nproc",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, _ = await proc.communicate()
            if stdout:
                cpu_count = int(stdout.decode().strip())
        except (FileNotFoundError, PermissionError, OSError):
            pass
        
        return cpu_percent, cpu_count
    
    async def _get_cpu_info_psutil(self) -> tuple[Optional[float], Optional[int]]:
        if not PSUTIL_AVAILABLE or psutil is None:
            return None, None
        try:
            cpu_percent = psutil.cpu_percent(interval=0.1)  # type: ignore[union-attr]
            cpu_count = psutil.cpu_count()  # type: ignore[union-attr]
            return cpu_percent, cpu_count
        except Exception:
            return None, None
    
    async def _get_memory_info_linux(self) -> tuple[Optional[float], Optional[float], Optional[float]]:
        try:
            proc = await asyncio.create_subprocess_shell(
                "cat /proc/meminfo",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, _ = await proc.communicate()
            if stdout:
                meminfo = {}
                for line in stdout.decode().split('\n'):
                    if ':' in line:
                        key, val = line.split(':')
                        meminfo[key.strip()] = int(val.strip().split()[0])
                
                total_kb = meminfo.get('MemTotal', 0)
                available_kb = meminfo.get('MemAvailable', 0)
                used_kb = total_kb - available_kb
                
                return (
                    round(total_kb / 1024 / 1024, 2),
                    round(used_kb / 1024 / 1024, 2),
                    round(used_kb / total_kb * 100, 2) if total_kb > 0 else 0
                )
        except (FileNotFoundError, PermissionError, OSError):
            pass
        return None, None, None
    
    async def _get_memory_info_psutil(self) -> tuple[Optional[float], Optional[float], Optional[float]]:
        if not PSUTIL_AVAILABLE or psutil is None:
            return None, None, None
        try:
            mem = psutil.virtual_memory()  # type: ignore[union-attr]
            return (
                round(mem.total / 1024 / 1024 / 1024, 2),
                round(mem.used / 1024 / 1024 / 1024, 2),
                mem.percent
            )
        except Exception:
            return None, None, None
    
    async def _get_disk_info_linux(self) -> tuple[Optional[float], Optional[float], Optional[float]]:
        try:
            proc = await asyncio.create_subprocess_shell(
                "df -B1 / | tail -1",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, _ = await proc.communicate()
            if stdout:
                parts = stdout.decode().split()
                if len(parts) >= 4:
                    total = int(parts[1])
                    used = int(parts[2])
                    return (
                        round(total / 1024 / 1024 / 1024, 2),
                        round(used / 1024 / 1024 / 1024, 2),
                        round(used / total * 100, 2) if total > 0 else 0
                    )
        except (FileNotFoundError, PermissionError, OSError):
            pass
        return None, None, None
    
    async def _get_disk_info_psutil(self) -> tuple[Optional[float], Optional[float], Optional[float]]:
        if not PSUTIL_AVAILABLE or psutil is None:
            return None, None, None
        try:
            disk = psutil.disk_usage('/')  # type: ignore[union-attr]
            return (
                round(disk.total / 1024 / 1024 / 1024, 2),
                round(disk.used / 1024 / 1024 / 1024, 2),
                disk.percent
            )
        except Exception:
            return None, None, None
    
    async def _get_uptime_linux(self) -> Optional[float]:
        try:
            proc = await asyncio.create_subprocess_shell(
                "cat /proc/uptime",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, _ = await proc.communicate()
            if stdout:
                return float(stdout.decode().split()[0])
        except (FileNotFoundError, PermissionError, OSError):
            pass
        return None
    
    async def _get_uptime_psutil(self) -> Optional[float]:
        if not PSUTIL_AVAILABLE or psutil is None:
            return None
        try:
            import time
            return time.time() - psutil.boot_time()  # type: ignore[union-attr]
        except Exception:
            return None
    
    async def execute(self, input: SystemMonitorInput) -> SystemMonitorOutput:
        self.logger.info("system_monitor_execute")
        
        use_linux = is_linux() and proc_filesystem_available()
        
        if not use_linux and not PSUTIL_AVAILABLE:
            return SystemMonitorOutput(
                success=False,
                error="System monitoring requires Linux (/proc filesystem) or psutil library. Neither is available on this platform."
            )
        
        try:
            result = SystemMonitorOutput(success=True)
            
            if input.include_cpu:
                if use_linux:
                    cpu_percent, cpu_count = await self._get_cpu_info_linux()
                    if cpu_percent is None and PSUTIL_AVAILABLE:
                        cpu_percent, cpu_count = await self._get_cpu_info_psutil()
                else:
                    cpu_percent, cpu_count = await self._get_cpu_info_psutil()
                
                result.cpu_percent = cpu_percent if cpu_percent is not None else 0.0
                result.cpu_count = cpu_count if cpu_count is not None else 1
            
            if input.include_memory:
                if use_linux:
                    mem_total, mem_used, mem_percent = await self._get_memory_info_linux()
                    if mem_total is None and PSUTIL_AVAILABLE:
                        mem_total, mem_used, mem_percent = await self._get_memory_info_psutil()
                else:
                    mem_total, mem_used, mem_percent = await self._get_memory_info_psutil()
                
                result.memory_total_gb = mem_total if mem_total is not None else 0.0
                result.memory_used_gb = mem_used if mem_used is not None else 0.0
                result.memory_percent = mem_percent if mem_percent is not None else 0.0
            
            if input.include_disk:
                if use_linux:
                    disk_total, disk_used, disk_percent = await self._get_disk_info_linux()
                    if disk_total is None and PSUTIL_AVAILABLE:
                        disk_total, disk_used, disk_percent = await self._get_disk_info_psutil()
                else:
                    disk_total, disk_used, disk_percent = await self._get_disk_info_psutil()
                
                result.disk_total_gb = disk_total if disk_total is not None else 0.0
                result.disk_used_gb = disk_used if disk_used is not None else 0.0
                result.disk_percent = disk_percent if disk_percent is not None else 0.0
            
            if use_linux:
                uptime = await self._get_uptime_linux()
                if uptime is None and PSUTIL_AVAILABLE:
                    uptime = await self._get_uptime_psutil()
            else:
                uptime = await self._get_uptime_psutil()
            
            result.uptime_seconds = uptime if uptime is not None else 0.0
            
            return result
            
        except Exception as e:
            self.logger.error("system_monitor_error", error=str(e))
            return SystemMonitorOutput(success=False, error=str(e))


class ProcessMonitorInput(ToolInput):
    filter_name: Optional[str] = None
    top_n: int = Field(default=10, ge=1, le=100)
    sort_by: Literal["cpu", "memory"] = Field(default="cpu")

class ProcessInfo(ToolOutput):
    pid: int = 0
    name: str = ""
    cpu_percent: float = 0.0
    memory_percent: float = 0.0
    status: str = ""

class ProcessMonitorOutput(ToolOutput):
    processes: List[Dict[str, Any]] = []
    total_processes: int = 0
    running_count: int = 0

@ToolRegistry.register
class ProcessMonitorTool(BaseTool[ProcessMonitorInput, ProcessMonitorOutput]):
    name = "process_monitor"
    description = "Monitor running processes and their resource usage"
    category = ToolCategory.MONITORING
    priority = Priority.MEDIUM
    dependencies = []
    
    async def _get_processes_linux(self, input: ProcessMonitorInput) -> tuple[List[Dict[str, Any]], int, int]:
        processes = []
        running_count = 0
        total_processes = 0
        
        try:
            # Use exec instead of shell to avoid command injection risks
            sort_field = "%cpu" if input.sort_by == "cpu" else "%mem"
            
            proc = await asyncio.create_subprocess_exec(
                "ps", "aux", f"--sort=-{sort_field}",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, _ = await proc.communicate()
            
            if stdout:
                lines = stdout.decode().strip().split('\n')
                # Process all lines and limit to top_n in Python instead of using head
                count = 0
                for line in lines[1:]:
                    if count >= input.top_n:
                        break
                    
                    parts = line.split(None, 10)
                    if len(parts) >= 11:
                        name = parts[10].split()[0] if parts[10] else ""
                        
                        if input.filter_name and input.filter_name.lower() not in name.lower():
                            continue
                        
                        status = parts[7] if len(parts) > 7 else ""
                        if 'R' in status:
                            running_count += 1
                        
                        processes.append({
                            "pid": int(parts[1]),
                            "name": name,
                            "cpu_percent": float(parts[2]),
                            "memory_percent": float(parts[3]),
                            "status": status
                        })
                        count += 1
            
            # Count total processes - using exec for consistency
            count_proc = await asyncio.create_subprocess_exec(
                "ps", "aux",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            count_stdout, _ = await count_proc.communicate()
            if count_stdout:
                total_processes = len(count_stdout.decode().strip().split('\n')) - 1
            
        except (FileNotFoundError, PermissionError, OSError):
            raise
        
        return processes[:input.top_n], total_processes, running_count
    
    async def _get_processes_psutil(self, input: ProcessMonitorInput) -> tuple[List[Dict[str, Any]], int, int]:
        if not PSUTIL_AVAILABLE or psutil is None:
            return [], 0, 0
        
        try:
            processes = []
            running_count = 0
            
            for proc in psutil.process_iter(['pid', 'name', 'cpu_percent', 'memory_percent', 'status']):  # type: ignore[union-attr]
                try:
                    pinfo = proc.info
                    name = pinfo.get('name', '')
                    
                    if input.filter_name and input.filter_name.lower() not in name.lower():
                        continue
                    
                    status = pinfo.get('status', '')
                    if status == psutil.STATUS_RUNNING:  # type: ignore[union-attr]
                        running_count += 1
                    
                    processes.append({
                        "pid": pinfo.get('pid', 0),
                        "name": name,
                        "cpu_percent": pinfo.get('cpu_percent', 0.0) or 0.0,
                        "memory_percent": pinfo.get('memory_percent', 0.0) or 0.0,
                        "status": status
                    })
                except (psutil.NoSuchProcess, psutil.AccessDenied):  # type: ignore[union-attr]
                    continue
            
            sort_key = 'cpu_percent' if input.sort_by == 'cpu' else 'memory_percent'
            processes.sort(key=lambda x: x[sort_key], reverse=True)
            
            total_processes = len(list(psutil.process_iter()))  # type: ignore[union-attr]
            
            return processes[:input.top_n], total_processes, running_count
            
        except Exception:
            return [], 0, 0
    
    async def execute(self, input: ProcessMonitorInput) -> ProcessMonitorOutput:
        self.logger.info("process_monitor_execute", filter=input.filter_name, top_n=input.top_n)
        
        use_linux = is_linux()
        
        if not use_linux and not PSUTIL_AVAILABLE:
            return ProcessMonitorOutput(
                success=False,
                error="Process monitoring requires Linux (ps command) or psutil library. Neither is available on this platform."
            )
        
        try:
            if use_linux:
                try:
                    processes, total_processes, running_count = await self._get_processes_linux(input)
                except (FileNotFoundError, PermissionError, OSError):
                    if PSUTIL_AVAILABLE:
                        processes, total_processes, running_count = await self._get_processes_psutil(input)
                    else:
                        return ProcessMonitorOutput(
                            success=False,
                            error="Process monitoring failed. ps command not available and psutil not installed."
                        )
            else:
                processes, total_processes, running_count = await self._get_processes_psutil(input)
            
            return ProcessMonitorOutput(
                success=True,
                processes=processes,
                total_processes=total_processes,
                running_count=running_count
            )
            
        except Exception as e:
            self.logger.error("process_monitor_error", error=str(e))
            return ProcessMonitorOutput(success=False, error=str(e))
