import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Download, Database, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ETLDialogProps {
  open: boolean;
  onClose: () => void;
  onComplete?: (summary: string) => void;
}

interface Indicator {
  id: string;
  name: string;
  category: string;
}

interface ETLConfig {
  countries: string[];
  indicators: Indicator[];
}

type ETLStatus = "idle" | "loading" | "running" | "success" | "error";

export function ETLDialog({ open, onClose, onComplete }: ETLDialogProps) {
  const [config, setConfig] = useState<ETLConfig | null>(null);
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [selectedIndicators, setSelectedIndicators] = useState<string[]>([]);
  const [status, setStatus] = useState<ETLStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [etlSummary, setEtlSummary] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setEtlSummary(null);
      setStatus("idle");
      setSelectedCountries([]);
      setSelectedIndicators([]);
      if (!config) {
        fetchConfig();
      }
    }
  }, [open]);

  const fetchConfig = async () => {
    setStatus("loading");
    try {
      const res = await fetch("/api/etl/config");
      const data = await res.json();
      setConfig(data);
      setStatus("idle");
    } catch (err: any) {
      setError(err.message);
      setStatus("error");
    }
  };

  const toggleCountry = (country: string) => {
    setSelectedCountries(prev =>
      prev.includes(country)
        ? prev.filter(c => c !== country)
        : [...prev, country]
    );
  };

  const toggleIndicator = (id: string) => {
    setSelectedIndicators(prev =>
      prev.includes(id)
        ? prev.filter(i => i !== id)
        : [...prev, id]
    );
  };

  const selectAllCountries = () => {
    if (config) {
      setSelectedCountries(config.countries);
    }
  };

  const selectAllIndicators = () => {
    if (config) {
      setSelectedIndicators(config.indicators.map(i => i.id));
    }
  };

  const runETL = async () => {
    if (selectedCountries.length === 0) {
      setError("Please select at least one country");
      return;
    }

    setStatus("running");
    setError(null);

    try {
      const res = await fetch("/api/etl/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          countries: selectedCountries,
          indicators: selectedIndicators.length > 0 ? selectedIndicators : undefined
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "ETL failed");
      }

      const blob = await res.blob();
      const filename = res.headers.get("Content-Disposition")?.split("filename=")[1]?.replace(/"/g, "") || "ETL_Data.xlsx";
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      const summary = `Downloaded economic data for ${selectedCountries.length} countries (${selectedCountries.slice(0, 3).join(", ")}${selectedCountries.length > 3 ? "..." : ""}) with ${selectedIndicators.length || "all"} indicators. File: ${filename}`;
      setEtlSummary(summary);
      
      if (onComplete) {
        onComplete(summary);
      }
      
      setStatus("success");
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err: any) {
      setError(err.message);
      setStatus("error");
    }
  };

  const groupedIndicators = config?.indicators.reduce((acc, ind) => {
    if (!acc[ind.category]) acc[ind.category] = [];
    acc[ind.category].push(ind);
    return acc;
  }, {} as Record<string, Indicator[]>) || {};

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            ETL Agent - Download Economic Data
          </DialogTitle>
          <VisuallyHidden>
            <DialogDescription>Descarga datos económicos de múltiples países</DialogDescription>
          </VisuallyHidden>
        </DialogHeader>

        {status === "loading" ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : status === "success" ? (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <CheckCircle2 className="h-16 w-16 text-green-500" />
            <p className="text-lg font-medium">Download started!</p>
          </div>
        ) : (
          <div className="flex-1 overflow-hidden flex flex-col gap-4">
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-3 rounded-lg flex items-center gap-2">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span className="text-sm">{error}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 flex-1 overflow-hidden">
              <div className="flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium text-sm">Countries</h3>
                  <Button variant="ghost" size="sm" onClick={selectAllCountries} data-testid="btn-select-all-countries">
                    Select All
                  </Button>
                </div>
                <ScrollArea className="flex-1 border rounded-lg p-2">
                  <div className="grid grid-cols-2 gap-1">
                    {config?.countries.map(country => (
                      <label
                        key={country}
                        className={cn(
                          "flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-muted text-sm",
                          selectedCountries.includes(country) && "bg-primary/10"
                        )}
                        data-testid={`country-${country.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        <Checkbox
                          checked={selectedCountries.includes(country)}
                          onCheckedChange={() => toggleCountry(country)}
                        />
                        <span>{country}</span>
                      </label>
                    ))}
                  </div>
                </ScrollArea>
                <p className="text-xs text-muted-foreground mt-1">
                  {selectedCountries.length} selected
                </p>
              </div>

              <div className="flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium text-sm">Indicators</h3>
                  <Button variant="ghost" size="sm" onClick={selectAllIndicators} data-testid="btn-select-all-indicators">
                    Select All
                  </Button>
                </div>
                <ScrollArea className="flex-1 border rounded-lg p-2">
                  {Object.entries(groupedIndicators).map(([category, indicators]) => (
                    <div key={category} className="mb-3">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                        {category}
                      </p>
                      {indicators.map(ind => (
                        <label
                          key={ind.id}
                          className={cn(
                            "flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-muted text-sm",
                            selectedIndicators.includes(ind.id) && "bg-primary/10"
                          )}
                          data-testid={`indicator-${ind.id.toLowerCase()}`}
                        >
                          <Checkbox
                            checked={selectedIndicators.includes(ind.id)}
                            onCheckedChange={() => toggleIndicator(ind.id)}
                          />
                          <span>{ind.name}</span>
                        </label>
                      ))}
                    </div>
                  ))}
                </ScrollArea>
                <p className="text-xs text-muted-foreground mt-1">
                  {selectedIndicators.length} selected (empty = all)
                </p>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose} disabled={status === "running"} data-testid="btn-cancel-etl">
            Cancel
          </Button>
          <Button
            onClick={runETL}
            disabled={status === "running" || selectedCountries.length === 0}
            data-testid="btn-run-etl"
          >
            {status === "running" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Fetching data...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                Download Excel
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
