import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Image,
  Video,
  FileText,
  Download,
  X,
  FolderOpen,
  Folder,
  FolderPlus,
  Trash2,
  Upload,
  HardDrive,
  LayoutGrid,
  Star,
  Home,
  MoreHorizontal,
  Pencil,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useCloudLibrary,
  LibraryFile,
  LibraryFolder,
  formatFileSize,
  formatStorageUsage,
  type FileType,
} from "@/hooks/use-cloud-library";
import { toast } from "@/hooks/use-toast";

interface UserLibraryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type FilterType = "all" | "image" | "video" | "document" | "app";
type SystemFolder = "all" | "favorites";

import { Grid, type CellComponentProps } from "react-window";
import { AutoSizer } from "react-virtualized-auto-sizer";

interface VirtualizedGridProps {
  items: LibraryFile[];
  onSelect: (item: LibraryFile) => void;
  onDelete: (item: LibraryFile) => void;
  onDownload: (item: LibraryFile) => void;
  onToggleFavorite: (item: LibraryFile) => void;
}

interface VirtualizedGridCellProps {
  items: LibraryFile[];
  onSelect: (item: LibraryFile) => void;
  onDelete: (item: LibraryFile) => void;
  onDownload: (item: LibraryFile) => void;
  onToggleFavorite: (item: LibraryFile) => void;
  columnCount: number;
}

const GUTTER_SIZE = 16;
const ITEM_HEIGHT = 200;
const OPTS_MIN_COLUMN_WIDTH = 180;

function VirtualizedMediaGridCell({
  columnIndex,
  rowIndex,
  style,
  items,
  onSelect,
  onDelete,
  onDownload,
  onToggleFavorite,
  columnCount,
}: CellComponentProps<VirtualizedGridCellProps>) {
  const index = rowIndex * columnCount + columnIndex;
  if (index >= items.length) return null;
  const item = items[index];

  const itemStyle = {
    ...style,
    left: Number(style.left),
    top: Number(style.top),
    width: Number(style.width) - GUTTER_SIZE,
    height: ITEM_HEIGHT,
  };

  return (
    <div style={itemStyle}>
      <MediaThumbnail
        item={item}
        onClick={() => onSelect(item)}
        onDelete={() => onDelete(item)}
        onDownload={() => onDownload(item)}
        onToggleFavorite={() => onToggleFavorite(item)}
      />
    </div>
  );
}

function VirtualizedMediaGrid({
  items,
  onSelect,
  onDelete,
  onDownload,
  onToggleFavorite,
}: VirtualizedGridProps) {
  const AutoSizerComponent = AutoSizer as any;
  const GridComponent = Grid as any;
  return (
    <AutoSizerComponent>
      {({ height, width }: { height: number; width: number }) => {
        const columnCount = Math.floor((width + GUTTER_SIZE) / (OPTS_MIN_COLUMN_WIDTH + GUTTER_SIZE));
        const safeColumnCount = Math.max(1, columnCount);
        const columnWidth = (width - (safeColumnCount - 1) * GUTTER_SIZE) / safeColumnCount;
        const rowCount = Math.ceil(items.length / safeColumnCount);

        return (
          <GridComponent
            cellComponent={VirtualizedMediaGridCell as any}
            cellProps={{ items, onSelect, onDelete, onDownload, onToggleFavorite, columnCount: safeColumnCount } as any}
            columnCount={safeColumnCount}
            columnWidth={columnWidth + GUTTER_SIZE}
            height={height}
            rowCount={rowCount}
            rowHeight={ITEM_HEIGHT + GUTTER_SIZE}
            width={width}
            className="px-6 py-4"
          />
        );
      }}
    </AutoSizerComponent>
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

function EmptyState({ filter, folderName }: { filter: FilterType; folderName?: string }) {
  const messages: Record<FilterType, string> = {
    all: folderName ? `La carpeta "${folderName}" está vacía` : "No tienes archivos en tu biblioteca",
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
      <p className="text-lg font-medium text-muted-foreground">{messages[filter]}</p>
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
  onToggleFavorite,
}: {
  item: LibraryFile;
  onClick: () => void;
  onDelete: () => void;
  onDownload: () => void;
  onToggleFavorite: () => void;
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
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
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

        {item.isFavorite && (
          <div className="absolute top-2 left-2 rounded-full bg-yellow-400/90 p-1.5 shadow-md">
            <Star className="h-3 w-3 fill-white text-white" />
          </div>
        )}

        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/0 opacity-0 transition-all duration-300 group-hover:bg-black/40 group-hover:opacity-100 group-hover:backdrop-blur-[2px]">
          <Button
            variant="secondary"
            size="icon"
            className="h-9 w-9 rounded-full bg-white/90 hover:bg-white shadow-lg hover:scale-110 transition-transform"
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite();
            }}
            aria-label={item.isFavorite ? "Quitar de favoritos" : "Marcar favorito"}
          >
            <Star className={cn("h-4 w-4", item.isFavorite ? "fill-yellow-400 text-yellow-500" : "text-gray-700")} />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            className="h-9 w-9 rounded-full bg-white/90 hover:bg-white shadow-lg hover:scale-110 transition-transform"
            onClick={(e) => {
              e.stopPropagation();
              onDownload();
            }}
            data-testid={`download-button-${item.uuid}`}
            aria-label={`Descargar ${item.name}`}
          >
            <Download className="h-4 w-4 text-gray-700" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            className="h-9 w-9 rounded-full bg-white/90 hover:bg-red-50 hover:text-red-500 shadow-lg hover:scale-110 transition-transform"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            data-testid={`delete-button-${item.uuid}`}
            aria-label={`Eliminar ${item.name}`}
          >
            <Trash2 className="h-4 w-4 text-red-600" />
          </Button>
        </div>
        {item.size > 0 && (
          <div className="absolute bottom-2 right-2 rounded-full bg-black/60 backdrop-blur-md px-2 py-1 text-[10px] font-medium text-white border border-white/10">
            {formatFileSize(item.size)}
          </div>
        )}
      </div>
      <div className="p-3 bg-background/50 backdrop-blur-xs border-t border-border/30">
        <p className="truncate text-sm font-medium text-foreground/90">{item.name}</p>
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
      <div className="max-h-[90vh] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
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
      <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-sm text-white/70">{item.name}</p>
    </div>
  );
}

function UploadProgressBar({
  uploads,
}: {
  uploads: { fileName: string; progress: number; status: string }[];
}) {
  if (uploads.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 space-y-2 rounded-lg bg-background border shadow-lg p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Upload className="h-4 w-4 animate-pulse" />
        Subiendo {uploads.length} archivo{uploads.length > 1 ? "s" : ""}
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

function StorageInfo({
  stats,
}: {
  stats: { totalBytes: number; quotaBytes: number; fileCount: number } | null;
}) {
  if (!stats) return null;
  const usagePercent = stats.quotaBytes > 0 ? (stats.totalBytes / stats.quotaBytes) * 100 : 0;

  return (
    <div className="flex items-center gap-3 text-sm text-muted-foreground">
      <HardDrive className="h-4 w-4" />
      <div className="flex-1 max-w-[180px]">
        <Progress value={usagePercent} className="h-1.5" />
      </div>
      <span className="whitespace-nowrap">{formatStorageUsage(stats.totalBytes, stats.quotaBytes)}</span>
      <span className="text-xs whitespace-nowrap">({stats.fileCount} archivos)</span>
    </div>
  );
}

function FolderSidebarItem({
  icon,
  label,
  count,
  active,
  onClick,
  onRename,
  onDelete,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-sm transition-colors",
        active
          ? "bg-[#A5A0FF]/10 text-[#A5A0FF] font-medium"
          : "text-foreground/80 hover:bg-muted/60"
      )}
      onClick={onClick}
      data-testid={`folder-item-${label}`}
    >
      <div className="shrink-0">{icon}</div>
      <span className="flex-1 truncate">{label}</span>
      {typeof count === "number" && (
        <span className="text-xs text-muted-foreground/70 tabular-nums">{count}</span>
      )}
      {(onRename || onDelete) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="opacity-0 group-hover:opacity-100 hover:bg-background rounded p-0.5 transition-opacity"
              onClick={(e) => e.stopPropagation()}
              aria-label="Opciones de carpeta"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent onClick={(e) => e.stopPropagation()} align="end">
            {onRename && (
              <DropdownMenuItem onClick={onRename}>
                <Pencil className="h-3.5 w-3.5 mr-2" /> Renombrar
              </DropdownMenuItem>
            )}
            {onDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onDelete} className="text-destructive">
                  <Trash2 className="h-3.5 w-3.5 mr-2" /> Eliminar
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function CreateFolderDialog({
  open,
  onOpenChange,
  onCreate,
  initialName = "",
  title = "Nueva carpeta",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string) => Promise<void> | void;
  initialName?: string;
  title?: string;
}) {
  const [name, setName] = useState(initialName);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await onCreate(trimmed);
      setName("");
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Organiza tus archivos en carpetas jerárquicas.</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre de la carpeta"
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          data-testid="folder-name-input"
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={!name.trim() || submitting} data-testid="folder-create-button">
            {submitting ? "Guardando..." : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UserLibrary({ open, onOpenChange }: UserLibraryProps) {
  const [activeTab, setActiveTab] = useState<FilterType>("all");
  const [lightboxItem, setLightboxItem] = useState<LibraryFile | null>(null);
  const [activeFolder, setActiveFolder] = useState<SystemFolder | number>("all");
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<LibraryFolder | null>(null);

  const filterType = activeTab === "all" ? undefined : activeTab;
  const folderFilter = typeof activeFolder === "number" ? activeFolder : undefined;

  const {
    files,
    folders,
    stats,
    isLoading,
    uploadProgress,
    deleteFile,
    updateFile,
    getDownloadUrl,
    uploadFile,
    isUploading,
    isAuthenticated,
    createFolder,
    updateFolder,
    deleteFolder,
  } = useCloudLibrary({ type: filterType as FileType | undefined, folder: folderFilter });

  const safeFiles = files ?? [];
  const safeFolders = folders ?? [];

  const filteredFiles = useMemo(() => {
    let list = safeFiles;
    if (activeFolder === "favorites") list = list.filter((f) => f.isFavorite);
    if (activeTab !== "all") list = list.filter((f) => f.type === activeTab);
    return list;
  }, [safeFiles, activeTab, activeFolder]);

  const activeFolderObj = useMemo(() => {
    if (typeof activeFolder === "number") return safeFolders.find((f) => f.id === activeFolder) ?? null;
    return null;
  }, [safeFolders, activeFolder]);

  const folderFileCount = useMemo(() => {
    const map = new Map<number, number>();
    for (const f of safeFiles) {
      if (typeof f.folderId === "number") {
        map.set(f.folderId, (map.get(f.folderId) ?? 0) + 1);
      }
    }
    return map;
  }, [safeFiles]);

  const favoritesCount = useMemo(() => safeFiles.filter((f) => f.isFavorite).length, [safeFiles]);

  const handleTabChange = (value: string) => setActiveTab(value as FilterType);

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
        window.open(fallbackUrl, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      console.error("Download failed:", error);
      toast({ title: "Error al descargar", description: "No se pudo descargar el archivo", variant: "destructive" });
    }
  };

  const handleDelete = async (item: LibraryFile) => {
    try {
      await deleteFile(item.uuid);
      toast({ title: "Archivo eliminado", description: `${item.name} ha sido eliminado` });
    } catch (error) {
      console.error("Delete failed:", error);
      toast({ title: "Error al eliminar", description: "No se pudo eliminar el archivo", variant: "destructive" });
    }
  };

  const handleToggleFavorite = async (item: LibraryFile) => {
    try {
      await updateFile({ fileId: item.uuid, updates: { isFavorite: !item.isFavorite } });
    } catch (error) {
      console.error("Favorite toggle failed:", error);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFiles = e.target.files;
    if (!uploadedFiles) return;

    const targetFolderId = typeof activeFolder === "number" ? activeFolder : undefined;

    for (const file of Array.from(uploadedFiles)) {
      try {
        await uploadFile({ file, folderId: targetFolderId });
        toast({ title: "Archivo subido", description: `${file.name} se ha guardado en tu biblioteca` });
      } catch (error) {
        console.error("Upload failed:", error);
        toast({ title: "Error al subir", description: `No se pudo subir ${file.name}`, variant: "destructive" });
      }
    }
    e.target.value = "";
  };

  const handleCreateFolder = async (name: string) => {
    try {
      await createFolder({ name });
      toast({ title: "Carpeta creada", description: name });
    } catch (error) {
      console.error("Create folder failed:", error);
      toast({ title: "Error", description: "No se pudo crear la carpeta", variant: "destructive" });
    }
  };

  const handleRenameFolder = async (name: string) => {
    if (!renameTarget) return;
    try {
      await updateFolder({ folderId: renameTarget.uuid, updates: { name } });
      toast({ title: "Carpeta renombrada" });
    } catch (error) {
      console.error("Rename folder failed:", error);
      toast({ title: "Error", description: "No se pudo renombrar", variant: "destructive" });
    } finally {
      setRenameTarget(null);
    }
  };

  const handleDeleteFolder = async (folder: LibraryFolder) => {
    if (!confirm(`¿Eliminar la carpeta "${folder.name}"? Los archivos no se eliminarán.`)) return;
    try {
      await deleteFolder(folder.uuid);
      if (activeFolder === folder.id) setActiveFolder("all");
      toast({ title: "Carpeta eliminada" });
    } catch (error) {
      console.error("Delete folder failed:", error);
      toast({ title: "Error", description: "No se pudo eliminar la carpeta", variant: "destructive" });
    }
  };

  const activeLabel =
    activeFolder === "all"
      ? "Todo"
      : activeFolder === "favorites"
      ? "Favoritos"
      : activeFolderObj?.name ?? "Carpeta";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-w-none w-screen h-screen max-h-screen p-0 rounded-none border-0 gap-0 flex flex-col"
          data-testid="user-library-dialog"
        >
          <DialogHeader className="px-6 py-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shrink-0">
            <div className="flex items-center justify-between gap-4">
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
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-full hover:bg-muted"
                  onClick={() => onOpenChange(false)}
                  aria-label="Cerrar biblioteca"
                  data-testid="library-close-button"
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
            </div>
            <VisuallyHidden>
              <DialogDescription>Explora y gestiona tus archivos multimedia</DialogDescription>
            </VisuallyHidden>
          </DialogHeader>

          <div className="flex flex-1 overflow-hidden">
            {/* Sidebar */}
            <aside className="w-64 shrink-0 border-r bg-muted/20 flex flex-col">
              <ScrollArea className="flex-1 px-2 py-3">
                <div className="space-y-0.5">
                  <FolderSidebarItem
                    icon={<Home className="h-4 w-4" />}
                    label="Todo"
                    count={safeFiles.length}
                    active={activeFolder === "all"}
                    onClick={() => setActiveFolder("all")}
                  />
                  <FolderSidebarItem
                    icon={<Star className="h-4 w-4" />}
                    label="Favoritos"
                    count={favoritesCount}
                    active={activeFolder === "favorites"}
                    onClick={() => setActiveFolder("favorites")}
                  />
                </div>

                <div className="mt-4 mb-1 px-3 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Mis carpetas
                  </span>
                  <button
                    className="hover:bg-muted rounded p-1 transition-colors"
                    onClick={() => setCreateFolderOpen(true)}
                    aria-label="Nueva carpeta"
                    data-testid="new-folder-button"
                  >
                    <FolderPlus className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="space-y-0.5">
                  {safeFolders.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground/60">
                      Crea tu primera carpeta
                    </p>
                  ) : (
                    safeFolders.map((folder) => (
                      <FolderSidebarItem
                        key={folder.id}
                        icon={<Folder className="h-4 w-4" style={{ color: folder.color || undefined }} />}
                        label={folder.name}
                        count={folderFileCount.get(folder.id) ?? 0}
                        active={activeFolder === folder.id}
                        onClick={() => setActiveFolder(folder.id)}
                        onRename={() => setRenameTarget(folder)}
                        onDelete={() => handleDeleteFolder(folder)}
                      />
                    ))
                  )}
                </div>
              </ScrollArea>
            </aside>

            {/* Main area */}
            <div className="flex-1 flex flex-col overflow-hidden">
              <Tabs value={activeTab} onValueChange={handleTabChange} className="flex flex-col h-full">
                <div className="px-6 pt-4 pb-2 border-b bg-background space-y-3">
                  <div className="flex items-center text-sm text-muted-foreground gap-1.5">
                    <FolderOpen className="h-3.5 w-3.5" />
                    <span>Biblioteca</span>
                    <ChevronRight className="h-3 w-3" />
                    <span className="font-medium text-foreground">{activeLabel}</span>
                  </div>

                  <TabsList className="h-10" data-testid="library-tabs">
                    <TabsTrigger value="all" className="px-4" data-testid="tab-all">
                      Todo ({filteredFiles.length})
                    </TabsTrigger>
                    <TabsTrigger value="image" className="px-4 gap-2" data-testid="tab-images">
                      <Image className="h-4 w-4" />
                      Imágenes
                    </TabsTrigger>
                    <TabsTrigger value="video" className="px-4 gap-2" data-testid="tab-videos">
                      <Video className="h-4 w-4" />
                      Videos
                    </TabsTrigger>
                    <TabsTrigger value="document" className="px-4 gap-2" data-testid="tab-documents">
                      <FileText className="h-4 w-4" />
                      Documentos
                    </TabsTrigger>
                    <TabsTrigger value="app" className="px-4 gap-2" data-testid="tab-apps">
                      <LayoutGrid className="h-4 w-4" />
                      Apps
                    </TabsTrigger>
                  </TabsList>
                </div>

                <div className="flex-1 overflow-hidden">
                  <TabsContent value={activeTab} className="mt-0 h-full">
                    {!isAuthenticated ? (
                      <div
                        className="flex flex-col items-center justify-center py-16 text-center"
                        data-testid="auth-required-state"
                      >
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
                      <EmptyState filter={activeTab} folderName={activeFolderObj?.name} />
                    ) : (
                      <div className="h-full w-full">
                        <VirtualizedMediaGrid
                          items={filteredFiles}
                          onSelect={(item) => setLightboxItem(item)}
                          onDelete={handleDelete}
                          onDownload={handleDownload}
                          onToggleFavorite={handleToggleFavorite}
                        />
                      </div>
                    )}
                  </TabsContent>
                </div>
              </Tabs>
            </div>
          </div>
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

      <CreateFolderDialog
        open={createFolderOpen}
        onOpenChange={setCreateFolderOpen}
        onCreate={handleCreateFolder}
      />

      <CreateFolderDialog
        open={renameTarget !== null}
        onOpenChange={(o) => !o && setRenameTarget(null)}
        onCreate={handleRenameFolder}
        initialName={renameTarget?.name ?? ""}
        title="Renombrar carpeta"
      />
    </>
  );
}
