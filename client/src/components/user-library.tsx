import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Image, Video, FileText, Download, X, FolderOpen, Trash2, Upload, HardDrive, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useCloudLibrary,
  LibraryFile,
  formatFileSize,
  formatStorageUsage,
  type FileType
} from "@/hooks/use-cloud-library";
import { toast } from "@/hooks/use-toast";

interface UserLibraryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type FilterType = "all" | "image" | "video" | "document" | "app";

import { FixedSizeGrid as Grid, type GridChildComponentProps } from "react-window";
import AutoSizer from "react-virtualized-auto-sizer";

// ... existing imports ...

interface VirtualizedGridProps {
  items: LibraryFile[];
  onSelect: (item: LibraryFile) => void;
  onDelete: (item: LibraryFile) => void;
  onDownload: (item: LibraryFile) => void;
}

const GUTTER_SIZE = 16;
const ITEM_HEIGHT = 200; // Approximate height of card + text
const OPTS_MIN_COLUMN_WIDTH = 180;

function VirtualizedMediaGrid({ items, onSelect, onDelete, onDownload }: VirtualizedGridProps) {
  return (
    <AutoSizer>
      {({ height, width }: { height: number; width: number }) => {
        const columnCount = Math.floor((width + GUTTER_SIZE) / (OPTS_MIN_COLUMN_WIDTH + GUTTER_SIZE));
        const safeColumnCount = Math.max(1, columnCount);
        const columnWidth = (width - (safeColumnCount - 1) * GUTTER_SIZE) / safeColumnCount;
        const rowCount = Math.ceil(items.length / safeColumnCount);

        return (
          <Grid
            columnCount={safeColumnCount}
            columnWidth={columnWidth + GUTTER_SIZE}
            height={height}
            rowCount={rowCount}
            rowHeight={ITEM_HEIGHT + GUTTER_SIZE}
            width={width}
            className="px-6 py-4"
          >
            {({ columnIndex, rowIndex, style }: GridChildComponentProps) => {
              const index = rowIndex * safeColumnCount + columnIndex;
              if (index >= items.length) return null;
              const item = items[index];

              // Adjust style for gutter
              const itemStyle = {
                ...style,
                left: Number(style.left),
                top: Number(style.top),
                width: columnWidth,
                height: ITEM_HEIGHT,
              };

              return (
                <div style={itemStyle}>
                  <MediaThumbnail
                    item={item}
                    onClick={() => onSelect(item)}
                    onDelete={() => onDelete(item)}
                    onDownload={() => onDownload(item)}
                  />
                </div>
              );
            }}
          </Grid>
        );
      }}
    </AutoSizer>
  );
}

function MediaItemSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="aspect-square w-full rounded-lg" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  );
}

function EmptyState({ filter }: { filter: FilterType }) {
  const messages: Record<FilterType, string> = {
    all: "No tienes archivos en tu biblioteca",
    image: "No tienes imágenes guardadas",
    video: "No tienes videos guardados",
    document: "No tienes documentos guardados",
    app: "No tienes aplicaciones guardadas",
  };

  return (
    <div
      className="flex flex-col items-center justify-center py-16 text-center"
      data-testid="empty-state"
    >
      <FolderOpen className="h-16 w-16 text-muted-foreground/50 mb-4" />
      <p className="text-lg font-medium text-muted-foreground">
        {messages[filter]}
      </p>
      <p className="text-sm text-muted-foreground/70 mt-1">
        Los archivos que subas aparecerán aquí
      </p>
    </div>
  );
}

function MediaThumbnail({
  item,
  onClick,
  onDelete,
  onDownload,
}: {
  item: LibraryFile;
  onClick: () => void;
  onDelete: () => void;
  onDownload: () => void;
}) {
  const thumbnailUrl = item.thumbnailUrl || item.storageUrl || item.storagePath;
  const displayType = item.type as FileType;

  return (
    <div
      className="group relative flex flex-col h-full cursor-pointer rounded-3xl border border-border/50 bg-card overflow-hidden hover:bg-[#A5A0FF]/[0.02] hover:border-[#A5A0FF]/40 transition-all duration-300 hover:shadow-lg hover:shadow-[#A5A0FF]/10 hover:-translate-y-1"
      onClick={onClick}
      data-testid={`media-item-${item.uuid}`}
    >
      <div className="relative flex-1 w-full overflow-hidden bg-muted/30">
        {displayType === "image" ? (
          <img
            src={thumbnailUrl}
            alt={item.name}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : displayType === "video" ? (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-purple-500/10 to-[#A5A0FF]/20">
            <Video className="h-12 w-12 text-[#A5A0FF]/70 transition-transform duration-500 group-hover:scale-110" />
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#A5A0FF]/10 to-transparent">
            <FileText className="h-12 w-12 text-[#A5A0FF]/70 transition-transform duration-500 group-hover:scale-110" />
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center gap-3 bg-black/0 opacity-0 transition-all duration-300 group-hover:bg-black/40 group-hover:opacity-100 group-hover:backdrop-blur-[2px]">
          <Button
            variant="secondary"
            size="icon"
            className="h-10 w-10 rounded-full bg-white/90 hover:bg-white shadow-lg hover:scale-110 transition-transform"
            onClick={(e) => {
              e.stopPropagation();
              onDownload();
            }}
            data-testid={`download-button-${item.uuid}`}
            aria-label={`Descargar ${item.name}`}
          >
            <Download className="h-5 w-5 text-gray-700" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            className="h-10 w-10 rounded-full bg-white/90 hover:bg-red-50 hover:text-red-500 shadow-lg hover:scale-110 transition-transform"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            data-testid={`delete-button-${item.uuid}`}
            aria-label={`Eliminar ${item.name}`}
          >
            <Trash2 className="h-5 w-5 text-red-600" />
          </Button>
        </div>
        {item.size > 0 && (
          <div className="absolute bottom-2 right-2 rounded-full bg-black/60 backdrop-blur-md px-2 py-1 text-[10px] font-medium text-white border border-white/10">
            {formatFileSize(item.size)}
          </div>
        )}
      </div>
      <div className="p-3 bg-background/50 backdrop-blur-xs border-t border-border/30">
        <p className="truncate text-sm font-medium text-foreground/90">
          {item.name}
        </p>
      </div>
    </div>
  );
}

function LightboxView({
  item,
  onClose,
  onDownload,
}: {
  item: LibraryFile;
  onClose: () => void;
  onDownload: () => void;
}) {
  const fileUrl = item.storageUrl || item.storagePath;
  const displayType = item.type as FileType;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-xl animate-in fade-in duration-300"
      onClick={onClose}
      data-testid="lightbox-overlay"
    >
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-4 top-4 h-10 w-10 rounded-full bg-white/10 text-white hover:bg-white/20"
        onClick={onClose}
        data-testid="lightbox-close"
        aria-label="Cerrar vista previa"
      >
        <X className="h-6 w-6" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-16 top-4 h-10 w-10 rounded-full bg-white/10 text-white hover:bg-white/20"
        onClick={(e) => {
          e.stopPropagation();
          onDownload();
        }}
        data-testid="lightbox-download"
        aria-label="Descargar archivo"
      >
        <Download className="h-5 w-5" />
      </Button>
      <div
        className="max-h-[90vh] max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        {displayType === "image" ? (
          <img
            src={fileUrl}
            alt={item.name}
            className="max-h-[90vh] max-w-[90vw] object-contain rounded-2xl shadow-2xl ring-1 ring-white/10"
          />
        ) : displayType === "video" ? (
          <video
            src={fileUrl}
            controls
            autoPlay
            className="max-h-[90vh] max-w-[90vw] rounded-2xl shadow-2xl ring-1 ring-white/10"
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-6 rounded-3xl bg-white/5 border border-white/10 backdrop-blur-3xl p-16 shadow-2xl">
            <div className="p-6 rounded-3xl bg-gradient-to-br from-[#A5A0FF]/20 to-transparent shadow-inner">
              <FileText className="h-24 w-24 text-[#A5A0FF]" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-2xl font-semibold text-white tracking-tight">{item.name}</p>
              <p className="text-base text-white/50">{formatFileSize(item.size)}</p>
            </div>
            <Button
              size="lg"
              className="mt-6 rounded-full bg-[#A5A0FF] hover:bg-[#8E88FF] text-white shadow-lg shadow-[#A5A0FF]/20 transition-all hover:scale-105"
              onClick={(e) => {
                e.stopPropagation();
                onDownload();
              }}
              data-testid="lightbox-download-document"
            >
              <Download className="h-5 w-5 mr-2" />
              Descargar documento
            </Button>
          </div>
        )}
      </div>
      <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-sm text-white/70">
        {item.name}
      </p>
    </div>
  );
}

function UploadProgressBar({ uploads }: { uploads: { fileName: string; progress: number; status: string }[] }) {
  if (uploads.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 space-y-2 rounded-lg bg-background border shadow-lg p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Upload className="h-4 w-4 animate-pulse" />
        Subiendo {uploads.length} archivo{uploads.length > 1 ? 's' : ''}
      </div>
      {uploads.map((upload, i) => (
        <div key={i} className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span className="truncate max-w-[200px]">{upload.fileName}</span>
            <span>{upload.progress}%</span>
          </div>
          <Progress value={upload.progress} className="h-1" />
        </div>
      ))}
    </div>
  );
}

function StorageInfo({ stats }: { stats: { totalBytes: number; quotaBytes: number; fileCount: number } | null }) {
  if (!stats) return null;

  const usagePercent = stats.quotaBytes > 0 ? (stats.totalBytes / stats.quotaBytes) * 100 : 0;

  return (
    <div className="flex items-center gap-3 text-sm text-muted-foreground">
      <HardDrive className="h-4 w-4" />
      <div className="flex-1 max-w-[200px]">
        <Progress value={usagePercent} className="h-1.5" />
      </div>
      <span>{formatStorageUsage(stats.totalBytes, stats.quotaBytes)}</span>
      <span className="text-xs">({stats.fileCount} archivos)</span>
    </div>
  );
}

export function UserLibrary({ open, onOpenChange }: UserLibraryProps) {
  const [activeTab, setActiveTab] = useState<FilterType>("all");
  const [lightboxItem, setLightboxItem] = useState<LibraryFile | null>(null);

  const filterType = activeTab === "all" ? undefined : activeTab;

  const {
    files,
    stats,
    isLoading,
    uploadProgress,
    deleteFile,
    getDownloadUrl,
    uploadFile,
    isUploading,
    isAuthenticated,
    libraryError,
  } = useCloudLibrary({ type: filterType as FileType | undefined });

  const safeFiles = files ?? [];

  const filteredFiles = useMemo(() => {
    if (activeTab === "all") return safeFiles;
    return safeFiles.filter((f) => f.type === activeTab);
  }, [safeFiles, activeTab]);

  const handleTabChange = (value: string) => {
    setActiveTab(value as FilterType);
  };

  const handleDownload = async (item: LibraryFile) => {
    try {
      const downloadUrl = await getDownloadUrl(item.uuid);
      if (downloadUrl) {
        const response = await fetch(downloadUrl);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = item.originalName || item.name;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        const fallbackUrl = item.storageUrl || item.storagePath;
        // FRONTEND FIX #35: Add noopener,noreferrer to prevent window.opener attacks
        window.open(fallbackUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (error) {
      console.error("Download failed:", error);
      toast({
        title: "Error al descargar",
        description: "No se pudo descargar el archivo",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (item: LibraryFile) => {
    try {
      await deleteFile(item.uuid);
      toast({
        title: "Archivo eliminado",
        description: `${item.name} ha sido eliminado`,
      });
    } catch (error) {
      console.error("Delete failed:", error);
      toast({
        title: "Error al eliminar",
        description: "No se pudo eliminar el archivo",
        variant: "destructive",
      });
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFiles = e.target.files;
    if (!uploadedFiles) return;

    for (const file of Array.from(uploadedFiles)) {
      try {
        await uploadFile({ file });
        toast({
          title: "Archivo subido",
          description: `${file.name} se ha guardado en tu biblioteca`,
        });
      } catch (error) {
        console.error("Upload failed:", error);
        toast({
          title: "Error al subir",
          description: `No se pudo subir ${file.name}`,
          variant: "destructive",
        });
      }
    }
    e.target.value = '';
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-w-none w-screen h-screen max-h-screen p-0 rounded-none border-0 gap-0"
          data-testid="user-library-dialog"
        >
          <DialogHeader className="px-6 py-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-xl font-semibold" data-testid="library-title">
                Tu Biblioteca de Medios
              </DialogTitle>
              <div className="flex items-center gap-4">
                <StorageInfo stats={stats ?? null} />
                <label htmlFor="file-upload">
                  <Button asChild variant="outline" size="sm" disabled={isUploading}>
                    <span>
                      <Upload className="h-4 w-4 mr-2" />
                      Subir archivo
                    </span>
                  </Button>
                </label>
                <input
                  id="file-upload"
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleFileUpload}
                  data-testid="file-upload-input"
                />
              </div>
            </div>
            <VisuallyHidden>
              <DialogDescription>Explora y gestiona tus archivos multimedia</DialogDescription>
            </VisuallyHidden>
          </DialogHeader>

          <Tabs
            value={activeTab}
            onValueChange={handleTabChange}
            className="flex flex-col h-[calc(100vh-73px)]"
          >
            <div className="px-6 pt-4 pb-2 border-b bg-background">
              <TabsList className="h-10" data-testid="library-tabs">
                <TabsTrigger
                  value="all"
                  className="px-4"
                  data-testid="tab-all"
                >
                  Todo ({safeFiles.length})
                </TabsTrigger>
                <TabsTrigger
                  value="image"
                  className="px-4 gap-2"
                  data-testid="tab-images"
                >
                  <Image className="h-4 w-4" />
                  Imágenes
                </TabsTrigger>
                <TabsTrigger
                  value="video"
                  className="px-4 gap-2"
                  data-testid="tab-videos"
                >
                  <Video className="h-4 w-4" />
                  Videos
                </TabsTrigger>
                <TabsTrigger
                  value="document"
                  className="px-4 gap-2"
                  data-testid="tab-documents"
                >
                  <FileText className="h-4 w-4" />
                  Documentos
                </TabsTrigger>

                <TabsTrigger
                  value="app"
                  className="px-4 gap-2"
                  data-testid="tab-apps"
                >
                  <LayoutGrid className="h-4 w-4" />
                  Apps
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 overflow-hidden">
              <TabsContent value={activeTab} className="mt-0 h-full">
                {!isAuthenticated ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="auth-required-state">
                    <FolderOpen className="h-16 w-16 text-muted-foreground/50 mb-4" />
                    <p className="text-lg font-medium text-muted-foreground">
                      Inicia sesión para ver tu biblioteca
                    </p>
                    <p className="text-sm text-muted-foreground/70 mt-1">
                      Necesitas estar autenticado para acceder a tus archivos
                    </p>
                  </div>
                ) : isLoading ? (
                  <div
                    className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 p-6"
                    data-testid="loading-skeleton"
                  >
                    {Array.from({ length: 12 }).map((_, i) => (
                      <MediaItemSkeleton key={i} />
                    ))}
                  </div>
                ) : filteredFiles.length === 0 ? (
                  <EmptyState filter={activeTab} />
                ) : (
                  <div className="h-full w-full">
                    <VirtualizedMediaGrid
                      items={filteredFiles}
                      onSelect={(item) => setLightboxItem(item)}
                      onDelete={handleDelete}
                      onDownload={handleDownload}
                    />
                  </div>
                )}
              </TabsContent>
            </div>
          </Tabs>
        </DialogContent>
      </Dialog>

      {lightboxItem && (
        <LightboxView
          item={lightboxItem}
          onClose={() => setLightboxItem(null)}
          onDownload={() => handleDownload(lightboxItem)}
        />
      )}

      <UploadProgressBar uploads={uploadProgress} />
    </>
  );
}
