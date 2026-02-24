import React from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { X, MoreHorizontal, Check, Bot, Globe, Code, Image, MessageSquare, User, Loader2, FileText, PenTool, Github, Linkedin, ExternalLink } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface GptAboutData {
  gpt: {
    id: string;
    name: string;
    description: string | null;
    avatar: string | null;
    capabilities: {
      webBrowsing?: boolean;
      codeInterpreter?: boolean;
      imageGeneration?: boolean;
      canvas?: boolean;
      [key: string]: boolean | undefined;
    } | null;
    usageCount: number | null;
  };
  creator: {
    id: string;
    name: string;
    avatar: string | null;
    links?: {
      website: string | null;
      linkedIn: string | null;
      github: string | null;
    };
    receiveEmailComments?: boolean;
  } | null;
  conversationCount: number;
  relatedGpts: Array<{
    id: string;
    name: string;
    description: string | null;
    avatar: string | null;
    usageCount: number | null;
  }>;
}

interface AboutGptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gptId: string | null;
  onSelectGpt?: (gpt: { id: string; name: string }) => void;
  onEditGpt?: () => void;
  onCopyLink?: () => void;
}

const capabilityLabels: Record<string, { label: string; icon: React.ElementType }> = {
  canvas: { label: "Canvas", icon: PenTool },
  codeInterpreter: { label: "Intérprete de código y análisis de datos", icon: Code },
  webBrowsing: { label: "Navegación web", icon: Globe },
  imageGeneration: { label: "Generación de imágenes", icon: Image },
  fileUpload: { label: "Subida de archivos", icon: FileText },
};

export function AboutGptDialog({ 
  open, 
  onOpenChange, 
  gptId,
  onSelectGpt,
  onEditGpt,
  onCopyLink
}: AboutGptDialogProps) {
  const { data, isLoading, error } = useQuery<GptAboutData>({
    queryKey: ["/api/gpts", gptId, "about"],
    queryFn: async () => {
      if (!gptId) throw new Error("No GPT ID");
      const res = await fetch(`/api/gpts/${gptId}/about`);
      if (!res.ok) throw new Error("Failed to fetch GPT details");
      return res.json();
    },
    enabled: open && !!gptId,
  });

  const enabledCapabilities = React.useMemo(() => {
    if (!data?.gpt?.capabilities) return [];
    return Object.entries(data.gpt.capabilities)
      .filter(([_, enabled]) => enabled)
      .map(([key]) => key);
  }, [data?.gpt?.capabilities]);

  const openExternal = (url: string) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
      window.open(parsed.toString(), "_blank", "noopener,noreferrer");
    } catch {
      // Ignore invalid URLs
    }
  };

  const creatorLinks = data?.creator?.links;
  const hasCreatorLinks = !!(creatorLinks?.website || creatorLinks?.linkedIn || creatorLinks?.github);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        <VisuallyHidden>
          <DialogTitle>Información del GPT</DialogTitle>
          <DialogDescription>Detalles e información sobre el GPT seleccionado</DialogDescription>
        </VisuallyHidden>
        <div className="flex items-center justify-between p-3 border-b">
          <div className="w-8" />
          <div className="flex-1" />
          <div className="flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-about-gpt-menu">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onEditGpt && (
                  <DropdownMenuItem onClick={onEditGpt} data-testid="menu-edit-gpt">
                    Editar GPT
                  </DropdownMenuItem>
                )}
                {onCopyLink && (
                  <DropdownMenuItem onClick={onCopyLink} data-testid="menu-copy-link">
                    Copiar enlace
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8" 
              onClick={() => onOpenChange(false)}
              data-testid="button-close-about-gpt"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <ScrollArea className="max-h-[70vh]">
          <div className="p-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <div className="text-center py-12 text-muted-foreground">
                Error al cargar la información del GPT
              </div>
            ) : data ? (
              <div className="flex flex-col items-center">
                <div className="w-20 h-20 rounded-2xl bg-muted flex items-center justify-center mb-4 overflow-hidden">
                  {data.gpt.avatar ? (
                    <img 
                      src={data.gpt.avatar} 
                      alt={data.gpt.name} 
                      className="w-full h-full object-cover"
                      data-testid="img-gpt-avatar"
                    />
                  ) : (
                    <Bot className="h-10 w-10 text-muted-foreground" />
                  )}
                </div>

                <h2 className="text-xl font-semibold text-center mb-1" data-testid="text-gpt-name">
                  {data.gpt.name}
                </h2>

                {data.creator && (
                  <p className="text-sm text-muted-foreground flex items-center gap-1 mb-2" data-testid="text-gpt-creator">
                    Por {data.creator.name}
                    <User className="h-3 w-3" />
                  </p>
                )}

                {hasCreatorLinks && (
                  <div className="flex items-center gap-2 mb-4">
                    {creatorLinks?.website && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openExternal(creatorLinks.website!)}
                        data-testid="button-creator-website"
                      >
                        <Globe className="h-4 w-4 mr-2" />
                        Web <ExternalLink className="h-3 w-3 ml-1 text-muted-foreground" />
                      </Button>
                    )}
                    {creatorLinks?.linkedIn && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openExternal(creatorLinks.linkedIn!)}
                        data-testid="button-creator-linkedin"
                      >
                        <Linkedin className="h-4 w-4 mr-2" />
                        LinkedIn <ExternalLink className="h-3 w-3 ml-1 text-muted-foreground" />
                      </Button>
                    )}
                    {creatorLinks?.github && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openExternal(creatorLinks.github!)}
                        data-testid="button-creator-github"
                      >
                        <Github className="h-4 w-4 mr-2" />
                        GitHub <ExternalLink className="h-3 w-3 ml-1 text-muted-foreground" />
                      </Button>
                    )}
                  </div>
                )}

                <div className="text-center mb-6">
                  <p className="text-2xl font-bold" data-testid="text-conversation-count">
                    {data.conversationCount}
                  </p>
                  <p className="text-sm text-muted-foreground">Conversaciones</p>
                </div>

                {enabledCapabilities.length > 0 && (
                  <div className="w-full mb-6">
                    <h3 className="font-semibold mb-3">Funcionalidades</h3>
                    <div className="space-y-2">
                      {enabledCapabilities.map((cap) => {
                        const config = capabilityLabels[cap];
                        return (
                          <div 
                            key={cap} 
                            className="flex items-center gap-2 text-sm"
                            data-testid={`capability-${cap}`}
                          >
                            <Check className="h-4 w-4 text-green-600" />
                            <span>{config?.label || cap}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {data.relatedGpts.length > 0 && data.creator && (
                  <div className="w-full">
                    <h3 className="font-semibold mb-3">Más de {data.creator.name}</h3>
                    <ScrollArea className="w-full whitespace-nowrap">
                      <div className="flex gap-3 pb-2">
                        {data.relatedGpts.map((relatedGpt) => (
                          <button
                            key={relatedGpt.id}
                            onClick={() => {
                              onSelectGpt?.(relatedGpt);
                              onOpenChange(false);
                            }}
                            className="flex-shrink-0 w-64 p-3 border rounded-lg hover:bg-muted/50 transition-colors text-left"
                            data-testid={`related-gpt-${relatedGpt.id}`}
                          >
                            <div className="flex items-start gap-3">
                              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden">
                                {relatedGpt.avatar ? (
                                  <img 
                                    src={relatedGpt.avatar} 
                                    alt={relatedGpt.name}
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <Bot className="h-5 w-5 text-muted-foreground" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-sm truncate">{relatedGpt.name}</p>
                                <p className="text-xs text-muted-foreground line-clamp-2 whitespace-normal">
                                  {relatedGpt.description || "Sin descripción"}
                                </p>
                                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                                  Por {data.creator?.name}
                                  <span className="mx-1">·</span>
                                  <MessageSquare className="h-3 w-3" />
                                  {relatedGpt.usageCount || 0}
                                </p>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                      <ScrollBar orientation="horizontal" />
                    </ScrollArea>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
