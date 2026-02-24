import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Download, FileText, FileJson, CheckCircle2 } from "lucide-react";
import { Message } from "@/hooks/use-chats";
import { usePlatformSettings } from "@/contexts/PlatformSettingsContext";
import { formatZonedDate, formatZonedDateTime, formatZonedTime, normalizeTimeZone, type PlatformDateFormat } from "@/lib/platformDateTime";

interface ExportChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chatTitle: string;
  messages: Message[];
}

type ExportFormat = "txt" | "json" | "md";

export function ExportChatDialog({
  open,
  onOpenChange,
  chatTitle,
  messages,
}: ExportChatDialogProps) {
  const { settings: platformSettings } = usePlatformSettings();
  const platformTimeZone = normalizeTimeZone(platformSettings.timezone_default);
  const platformDateFormat = platformSettings.date_format;
  const [format, setFormat] = useState<ExportFormat>("txt");
  const [exported, setExported] = useState(false);

  const handleExport = () => {
    let content: string;
    let filename: string;
    let mimeType: string;

    const timestamp = formatZonedDate(new Date(), { timeZone: platformTimeZone, dateFormat: platformDateFormat }).replace(/\//g, "-");
    const safeTitle = chatTitle.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30);

    switch (format) {
      case "txt":
        content = formatAsTxt(chatTitle, messages, { timeZone: platformTimeZone, dateFormat: platformDateFormat });
        filename = `${safeTitle}_${timestamp}.txt`;
        mimeType = "text/plain";
        break;
      case "json":
        content = formatAsJson(chatTitle, messages);
        filename = `${safeTitle}_${timestamp}.json`;
        mimeType = "application/json";
        break;
      case "md":
        content = formatAsMarkdown(chatTitle, messages, { timeZone: platformTimeZone, dateFormat: platformDateFormat });
        filename = `${safeTitle}_${timestamp}.md`;
        mimeType = "text/markdown";
        break;
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setExported(true);
    setTimeout(() => {
      setExported(false);
      onOpenChange(false);
    }, 1500);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Exportar conversación
          </DialogTitle>
          <DialogDescription>
            Descarga esta conversación en el formato que prefieras
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <RadioGroup
            value={format}
            onValueChange={(v) => setFormat(v as ExportFormat)}
            className="space-y-3"
          >
            <div className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors cursor-pointer">
              <RadioGroupItem value="txt" id="txt" />
              <Label htmlFor="txt" className="flex-1 cursor-pointer">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="font-medium">Texto plano (.txt)</div>
                    <div className="text-xs text-muted-foreground">
                      Formato simple, compatible con cualquier editor
                    </div>
                  </div>
                </div>
              </Label>
            </div>

            <div className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors cursor-pointer">
              <RadioGroupItem value="md" id="md" />
              <Label htmlFor="md" className="flex-1 cursor-pointer">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="font-medium">Markdown (.md)</div>
                    <div className="text-xs text-muted-foreground">
                      Conserva formato, ideal para documentación
                    </div>
                  </div>
                </div>
              </Label>
            </div>

            <div className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors cursor-pointer">
              <RadioGroupItem value="json" id="json" />
              <Label htmlFor="json" className="flex-1 cursor-pointer">
                <div className="flex items-center gap-2">
                  <FileJson className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="font-medium">JSON (.json)</div>
                    <div className="text-xs text-muted-foreground">
                      Datos estructurados, ideal para importar
                    </div>
                  </div>
                </div>
              </Label>
            </div>
          </RadioGroup>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleExport} disabled={exported}>
            {exported ? (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2 text-green-500" />
                Exportado
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                Exportar
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatAsTxt(title: string, messages: Message[], opts: { timeZone: string; dateFormat: PlatformDateFormat }): string {
  const lines: string[] = [];
  lines.push(`Conversación: ${title}`);
  lines.push(`Exportado: ${formatZonedDateTime(new Date(), { timeZone: opts.timeZone, dateFormat: opts.dateFormat })}`);
  lines.push("=".repeat(50));
  lines.push("");

  for (const msg of messages) {
    const role = msg.role === "user" ? "Tú" : "IliaGPT";
    const time = msg.timestamp ? formatZonedTime(msg.timestamp, { timeZone: opts.timeZone, includeSeconds: false }) : "";
    lines.push(`[${role}] ${time}`);
    lines.push(msg.content);
    lines.push("");
  }

  return lines.join("\n");
}

function formatAsJson(title: string, messages: Message[]): string {
  return JSON.stringify(
    {
      title,
      exportedAt: new Date().toISOString(),
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
      })),
    },
    null,
    2
  );
}

function formatAsMarkdown(title: string, messages: Message[], opts: { timeZone: string; dateFormat: PlatformDateFormat }): string {
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`> Exportado: ${formatZonedDateTime(new Date(), { timeZone: opts.timeZone, dateFormat: opts.dateFormat })}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const msg of messages) {
    const role = msg.role === "user" ? "**Tú**" : "**IliaGPT**";
    lines.push(`### ${role}`);
    lines.push("");
    lines.push(msg.content);
    lines.push("");
  }

  return lines.join("\n");
}
