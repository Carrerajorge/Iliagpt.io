import { useEffect, useState } from "react";
import { Zap, ZapOff, Activity } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

type TelemetryData = {
  time: number;
  system: {
    memUsed: number;
    memTotal: number;
    cpuLoad: number;
    gpus?: Array<{ vram: number; vramDynamic: boolean }>;
  };
  ollama: {
    status: "online" | "offline";
    latency: number;
    models: string[];
  };
};

export function TelemetryIndicator() {
  const [data, setData] = useState<TelemetryData | null>(null);

  useEffect(() => {
    let evtSource: EventSource | null = null;
    const fallbackInterval: number | null = null;

    const connectSSE = () => {
      evtSource = new EventSource("/api/hardware-telemetry/stream");
      evtSource.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          setData(parsed);
        } catch (err) {
          console.error("Telemetry parse err", err);
        }
      };
      evtSource.onerror = () => {
        if (evtSource) {
          evtSource.close();
        }
        // retry in a bit
        setTimeout(connectSSE, 5000);
      };
    };

    connectSSE();

    return () => {
      if (evtSource) {
        evtSource.close();
      }
      if (fallbackInterval) clearInterval(fallbackInterval);
    };
  }, []);

  if (!data) {
    return (
      <Skeleton className="h-[28px] w-[140px] rounded-full" />
    );
  }

  const { ollama, system } = data;
  const isOnline = ollama.status === "online";
  const statusColor = isOnline ? "text-emerald-500" : "text-rose-500";
  const bgStatusColor = isOnline ? "bg-emerald-500/10" : "bg-rose-500/10";
  
  const memUsedGbNum = system.memUsed / (1024 ** 3);
  const memTotalGbNum = system.memTotal / (1024 ** 3);
  const memUsedGb = memUsedGbNum.toFixed(1);
  const memTotalGb = memTotalGbNum.toFixed(1);
  
  const memPercent = (system.memUsed / system.memTotal) * 100;
  const cpuPercent = system.cpuLoad;
  const isMemWarning = memPercent > 85;
  const isCpuWarning = cpuPercent > 85;
  const isCritical = memPercent > 95 || cpuPercent > 95;
  const isWarning = isMemWarning || isCpuWarning;
  
  const warningClasses = isCritical 
    ? "border-rose-500/50 shadow-[0_0_8px_rgba(244,63,94,0.4)]" 
    : isWarning 
      ? "border-amber-500/50 shadow-[0_0_8px_rgba(245,158,11,0.4)]" 
      : "border";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={`flex items-center gap-2 px-2 py-1 rounded-full text-xs font-medium bg-background shadow-sm cursor-pointer transition-colors hover:bg-muted/50 ${warningClasses}`}>
             <div className="relative flex h-2 w-2">
                {isOnline && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                )}
                <span className={`relative inline-flex rounded-full h-2 w-2 ${isOnline ? "bg-emerald-500" : "bg-rose-500"}`}></span>
             </div>
             
             <div className="flex items-center gap-1">
               {isOnline ? <Zap className="h-3.5 w-3.5 text-amber-500" /> : <ZapOff className="h-3.5 w-3.5 text-muted-foreground" />}
               <span>Ollama</span>
             </div>

             <div className="hidden sm:flex items-center gap-1.5 ml-1 pl-2 border-l border-border h-4">
                <Activity className={`h-3 w-3 ${isWarning ? "text-amber-500 animate-pulse" : "text-muted-foreground"}`} />
                <span className={isMemWarning ? "text-amber-500 font-medium" : "text-muted-foreground"}>
                  {memUsedGb}/{memTotalGb}GB
                </span>
             </div>
          </div>
        </TooltipTrigger>
        <TooltipContent align="end" className="p-3 w-64 space-y-2">
           <div className="font-semibold text-sm mb-1 px-1">Telemetría Local</div>
           
           <div className={`flex justify-between items-center rounded-md p-2 text-xs font-medium ${bgStatusColor}`}>
             <div className="flex items-center gap-1.5">
               <span className={`h-2 w-2 rounded-full ${isOnline ? "bg-emerald-500" : "bg-rose-500"}`} />
               Status Ollama
             </div>
             <span className={statusColor}>
                {isOnline ? "Running" : "Offline"}
             </span>
           </div>
           
           <div className="flex justify-between items-center px-1 text-xs">
             <span className="text-muted-foreground border-b border-border/50 border-dotted pb-0.5" title="Milisegundos de latencia a la API">Latencia</span>
             <span>{isOnline ? `${ollama.latency}ms` : "-"}</span>
           </div>
           
           <div className="flex flex-col gap-1.5 px-1 mt-2">
             <div className="flex justify-between items-center text-xs">
               <span className="text-muted-foreground">Uso Memoria (RAM)</span>
               <span className={isMemWarning ? "text-amber-500 font-medium" : ""}>{memUsedGb} / {memTotalGb} GB</span>
             </div>
             <Progress value={memPercent} className={`h-1.5 ${isCritical ? "[&>div]:bg-rose-500" : isMemWarning ? "[&>div]:bg-amber-500" : ""}`} />
           </div>

           <div className="flex flex-col gap-1.5 px-1 mt-2 mb-2">
             <div className="flex justify-between items-center text-xs">
               <span className="text-muted-foreground">Carga CPU</span>
               <span className={isCpuWarning ? "text-amber-500 font-medium" : ""}>{cpuPercent.toFixed(1)}%</span>
             </div>
             <Progress value={cpuPercent} className={`h-1.5 ${isCritical ? "[&>div]:bg-rose-500" : isCpuWarning ? "[&>div]:bg-amber-500" : ""}`} />
           </div>
           
           {system.gpus && system.gpus.length > 0 && (
             <div className="flex justify-between items-center px-1 text-xs border-t pt-2 mt-1">
               <span className="text-muted-foreground">VRAM Detectada</span>
               <span>{system.gpus[0].vram} MB</span>
             </div>
           )}

           {isOnline && ollama.models && ollama.models.length > 0 && (
              <div className="pt-2 mt-1 border-t px-1">
                <div className="text-xs text-muted-foreground mb-1">Modelos Cargados:</div>
                <div className="flex flex-wrap gap-1">
                  {ollama.models.slice(0, 3).map(m => (
                    <span key={m} className="px-1.5 py-0.5 bg-muted rounded-md text-[10px] truncate max-w-[120px]">
                      {m}
                    </span>
                  ))}
                  {ollama.models.length > 3 && (
                    <span className="px-1.5 py-0.5 bg-muted rounded-md text-[10px]">
                      +{ollama.models.length - 3}
                    </span>
                  )}
                </div>
              </div>
           )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
