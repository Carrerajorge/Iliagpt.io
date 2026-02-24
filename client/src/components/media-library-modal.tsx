import { useState, useMemo, useCallback, useRef } from "react";
import { Grid } from "react-window";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Image,
  Video,
  FileText,
  Trash2,
  Download,
  Search,
  X,
  Grid3X3,
  List,
  ExternalLink,
  Clock,
  HardDrive,
  Upload
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMediaLibrary, formatFileSize } from "@/hooks/use-media-library";
import { usePlatformSettings } from "@/contexts/PlatformSettingsContext";
import { formatZonedDate, normalizeTimeZone } from "@/lib/platformDateTime";

interface MediaLibraryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect?: (item: MediaItem) => void;
  selectable?: boolean;
}

interface MediaItem {
  id: string;
  name: string;
  type: 'image' | 'video' | 'document';
  mimeType: string;
  size: number;
  url: string;
  thumbnailBase64?: string;
  createdAt: string;
  source?: string;
}

const VIRTUALIZATION_THRESHOLD = 50;
const COLUMN_COUNT = 4;
const ITEM_SIZE = 140;

function MediaItemCard({
  item,
  isSelected,
  onSelect,
  onDelete,
  onDownload,
  selectable
}: {
  item: MediaItem;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onDownload: () => void;
  selectable?: boolean;
}) {
  const TypeIcon = item.type === 'image' ? Image : item.type === 'video' ? Video : FileText;

  return (
    <div
      className={cn(
        "group relative aspect-square rounded-lg border bg-muted/30 overflow-hidden cursor-pointer transition-all",
        "hover:border-primary/50 hover:shadow-md",
        isSelected && "ring-2 ring-primary border-primary",
        selectable && "cursor-pointer"
      )}
      onClick={onSelect}
      data-testid={`media-item-${item.id}`}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        {item.thumbnailBase64 ? (
          <img
            src={item.thumbnailBase64}
            alt={item.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : item.type === 'image' ? (
          <img
            src={item.url}
            alt={item.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 p-4">
            <TypeIcon className="h-10 w-10 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground text-center truncate max-w-full px-2">
              {item.name.split('.').pop()?.toUpperCase()}
            </span>
          </div>
        )}
      </div>

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <p className="text-[10px] text-white truncate">{item.name}</p>
        <p className="text-[9px] text-white/70">{formatFileSize(item.size)}</p>
      </div>

      <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="secondary"
          size="icon"
          className="h-6 w-6 bg-white/90 hover:bg-white"
          onClick={(e) => { e.stopPropagation(); onDownload(); }}
          data-testid={`download-${item.id}`}
        >
          <Download className="h-3 w-3" />
        </Button>
        <Button
          variant="secondary"
          size="icon"
          className="h-6 w-6 bg-white/90 hover:bg-red-50 text-red-500"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          data-testid={`delete-${item.id}`}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      <div className="absolute top-1 left-1">
        <div className={cn(
          "h-5 w-5 rounded-full flex items-center justify-center",
          item.type === 'image' && "bg-blue-500",
          item.type === 'video' && "bg-purple-500",
          item.type === 'document' && "bg-orange-500"
        )}>
          <TypeIcon className="h-3 w-3 text-white" />
        </div>
      </div>
    </div>
  );
}

interface CellProps {
  items: MediaItem[];
  selectedId: string | null;
  onSelect: (item: MediaItem) => void;
  onDelete: (id: string) => void;
  onDownload: (item: MediaItem) => void;
  selectable?: boolean;
  columnCount: number;
}

function GridCell({
  columnIndex,
  rowIndex,
  style,
  items,
  selectedId,
  onSelect,
  onDelete,
  onDownload,
  selectable,
  columnCount
}: {
  columnIndex: number;
  rowIndex: number;
  style: React.CSSProperties;
} & CellProps) {
  const index = rowIndex * columnCount + columnIndex;
  if (index >= items.length) return null;
  const item = items[index];

  return (
    <div style={{ ...style, padding: 4 }}>
      <MediaItemCard
        item={item}
        isSelected={selectedId === item.id}
        onSelect={() => onSelect(item)}
        onDelete={() => onDelete(item.id)}
        onDownload={() => onDownload(item)}
        selectable={selectable}
      />
    </div>
  );
}

function VirtualizedGrid({
  items,
  selectedId,
  onSelect,
  onDelete,
  onDownload,
  selectable,
  containerWidth,
  containerHeight
}: {
  items: MediaItem[];
  selectedId: string | null;
  onSelect: (item: MediaItem) => void;
  onDelete: (id: string) => void;
  onDownload: (item: MediaItem) => void;
  selectable?: boolean;
  containerWidth: number;
  containerHeight: number;
}) {
  const columnCount = Math.max(1, Math.floor(containerWidth / ITEM_SIZE));
  const rowCount = Math.ceil(items.length / columnCount);
  const itemWidth = (containerWidth - 16) / columnCount;

  const cellProps = useMemo(() => ({
    items,
    selectedId,
    onSelect,
    onDelete,
    onDownload,
    selectable,
    columnCount,
  }), [items, selectedId, onSelect, onDelete, onDownload, selectable, columnCount]);

  return (
    <Grid
      cellComponent={GridCell}
      cellProps={cellProps}
      columnCount={columnCount}
      columnWidth={itemWidth}
      defaultHeight={containerHeight}
      defaultWidth={containerWidth}
      rowCount={rowCount}
      rowHeight={itemWidth}
      style={{ height: containerHeight, width: containerWidth }}
    />
  );
}

export function MediaLibraryModal({
  open,
  onOpenChange,
  onSelect,
  selectable = false,
}: MediaLibraryModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const containerRef = useRef<HTMLDivElement>(null);
  const { settings: platformSettings } = usePlatformSettings();
  const platformTimeZone = normalizeTimeZone(platformSettings.timezone_default);
  const platformDateFormat = platformSettings.date_format;

  const {
    items,
    isLoading,
    filter,
    setFilter,
    remove,
    loadAll,
    totalCount
  } = useMediaLibrary();

  const filteredItems = useMemo(() => {
    let result = filter === 'all' ? items : items.filter(item => item.type === filter);

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(item =>
        item.name.toLowerCase().includes(query) ||
        item.type.toLowerCase().includes(query)
      );
    }

    return result;
  }, [items, filter, searchQuery]);

  const handleSelect = useCallback((item: MediaItem) => {
    if (selectable) {
      setSelectedId(item.id);
      onSelect?.(item);
      onOpenChange(false);
    } else {
      // FRONTEND FIX #28: Add noopener,noreferrer to prevent opener attacks
      window.open(item.url, '_blank', 'noopener,noreferrer');
    }
  }, [selectable, onSelect, onOpenChange]);

  const handleDelete = useCallback(async (id: string) => {
    await remove(id);
    if (selectedId === id) setSelectedId(null);
  }, [remove, selectedId]);

  const handleDownload = useCallback((item: MediaItem) => {
    const a = document.createElement('a');
    a.href = item.url;
    a.download = item.name;
    a.click();
  }, []);

  const containerWidth = containerRef.current?.clientWidth || 600;
  const containerHeight = containerRef.current?.clientHeight || 600;
  const useVirtualization = filteredItems.length > VIRTUALIZATION_THRESHOLD;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-screen h-screen max-w-none max-h-none m-0 rounded-none flex flex-col p-0 gap-0"
        data-testid="modal-media-library"
      >
        <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg font-semibold">Biblioteca de Medios</DialogTitle>
            <VisuallyHidden>
              <DialogDescription>Gestiona tus archivos multimedia</DialogDescription>
            </VisuallyHidden>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <HardDrive className="h-3.5 w-3.5" />
              <span>{totalCount} archivo{totalCount !== 1 ? 's' : ''}</span>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-3 border-b flex items-center gap-3 flex-shrink-0">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar archivos..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9"
              data-testid="input-search-media"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                onClick={() => setSearchQuery("")}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
            <TabsList className="h-9">
              <TabsTrigger value="all" className="text-xs px-3">Todos</TabsTrigger>
              <TabsTrigger value="image" className="text-xs px-3">
                <Image className="h-3.5 w-3.5 mr-1" />
                Imágenes
              </TabsTrigger>
              <TabsTrigger value="video" className="text-xs px-3">
                <Video className="h-3.5 w-3.5 mr-1" />
                Videos
              </TabsTrigger>
              <TabsTrigger value="document" className="text-xs px-3">
                <FileText className="h-3.5 w-3.5 mr-1" />
                Docs
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex border rounded-md">
            <Button
              variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
              size="icon"
              className="h-9 w-9 rounded-r-none"
              onClick={() => setViewMode('grid')}
            >
              <Grid3X3 className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === 'list' ? 'secondary' : 'ghost'}
              size="icon"
              className="h-9 w-9 rounded-l-none"
              onClick={() => setViewMode('list')}
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div ref={containerRef} className="flex-1 overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-16 px-6">
              {/* Ilustración animada */}
              <div className="relative mb-6">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-purple-500/20 rounded-full blur-2xl animate-pulse" />
                <div className="relative w-24 h-24 rounded-2xl bg-gradient-to-br from-primary/10 to-purple-500/10 border border-border flex items-center justify-center">
                  <Upload className="h-10 w-10 text-primary/60" />
                </div>
              </div>

              {/* Título y descripción */}
              <h3 className="text-lg font-semibold text-foreground mb-2">
                Tu biblioteca está vacía
              </h3>
              <p className="text-sm text-muted-foreground max-w-sm mb-6">
                Sube imágenes, documentos y videos para usarlos en tus conversaciones y proyectos
              </p>

              {/* CTA Principal */}
              <label className="cursor-pointer">
                <input
                  type="file"
                  className="hidden"
                  multiple
                  accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                  onChange={(e) => {
                    // Trigger file upload through media library hook
                    console.log('File selected:', e.target.files);
                  }}
                />
                <Button className="gap-2 mb-4" asChild>
                  <span>
                    <Upload className="h-4 w-4" />
                    Subir primer archivo
                  </span>
                </Button>
              </label>

              {/* Tipos soportados */}
              <div className="flex flex-wrap justify-center gap-2 max-w-xs">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-medium">
                  <Image className="h-3 w-3" /> Imágenes
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 text-xs font-medium">
                  <Video className="h-3 w-3" /> Videos
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-orange-500/10 text-orange-600 dark:text-orange-400 text-xs font-medium">
                  <FileText className="h-3 w-3" /> Documentos
                </span>
              </div>
            </div>
          ) : viewMode === 'grid' ? (
            useVirtualization ? (
              <VirtualizedGrid
                items={filteredItems}
                selectedId={selectedId}
                onSelect={handleSelect}
                onDelete={handleDelete}
                onDownload={handleDownload}
                selectable={selectable}
                containerWidth={containerWidth}
                containerHeight={containerHeight}
              />
            ) : (
              <ScrollArea className="h-full px-6 py-4">
                <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-3">
                  {filteredItems.map((item) => (
                    <MediaItemCard
                      key={item.id}
                      item={item}
                      isSelected={selectedId === item.id}
                      onSelect={() => handleSelect(item)}
                      onDelete={() => handleDelete(item.id)}
                      onDownload={() => handleDownload(item)}
                      selectable={selectable}
                    />
                  ))}
                </div>
              </ScrollArea>
            )
          ) : (
            <ScrollArea className="h-full">
              <div className="flex flex-col divide-y">
                {filteredItems.map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      "flex items-center gap-4 px-6 py-3 hover:bg-muted/50 cursor-pointer transition-colors",
                      selectedId === item.id && "bg-primary/5"
                    )}
                    onClick={() => handleSelect(item)}
                    data-testid={`media-list-item-${item.id}`}
                  >
                    <div className="h-12 w-12 rounded-lg overflow-hidden bg-muted flex-shrink-0">
                      {item.thumbnailBase64 ? (
                        // FRONTEND FIX #10: Add meaningful alt text for accessibility
                        <img src={item.thumbnailBase64} alt={`Thumbnail for ${item.name}`} className="h-full w-full object-cover" />
                      ) : item.type === 'image' ? (
                        <img src={item.url} alt={item.name || 'Media image'} className="h-full w-full object-cover" />
                      ) : (
                        <div className="h-full w-full flex items-center justify-center">
                          {item.type === 'video' ? (
                            <Video className="h-5 w-5 text-muted-foreground" />
                          ) : (
                            <FileText className="h-5 w-5 text-muted-foreground" />
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.name}</p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatZonedDate(item.createdAt, { timeZone: platformTimeZone, dateFormat: platformDateFormat })}
                        </span>
                        <span>{formatFileSize(item.size)}</span>
                        <span className="capitalize">{item.type}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        // FRONTEND FIX #29: Add noopener,noreferrer
                        onClick={(e) => { e.stopPropagation(); window.open(item.url, '_blank', 'noopener,noreferrer'); }}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => { e.stopPropagation(); handleDownload(item); }}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-red-500 hover:text-red-600"
                        onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>

        {filteredItems.length > 0 && (
          <div className="px-6 py-3 border-t text-xs text-muted-foreground flex items-center justify-between flex-shrink-0">
            <span>
              {filteredItems.length} archivo{filteredItems.length !== 1 ? 's' : ''}
              {filter !== 'all' && ` (${filter})`}
            </span>
            {totalCount > items.length && (
              <Button
                variant="link"
                size="sm"
                className="text-xs h-auto p-0"
                onClick={loadAll}
              >
                Cargar todos ({totalCount})
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
