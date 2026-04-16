import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Star, Trash2, MessageSquare, Search, X } from "lucide-react";
import { FavoriteMessage } from "@/hooks/use-favorites";
import { cn } from "@/lib/utils";
import { usePlatformSettings } from "@/contexts/PlatformSettingsContext";
import { formatZonedDate, normalizeTimeZone } from "@/lib/platformDateTime";

interface FavoritesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  favorites: FavoriteMessage[];
  onRemove: (id: string) => void;
  onSelect: (chatId: string) => void;
}

export function FavoritesDialog({
  open,
  onOpenChange,
  favorites,
  onRemove,
  onSelect,
}: FavoritesDialogProps) {
  const { settings: platformSettings } = usePlatformSettings();
  const platformTimeZone = normalizeTimeZone(platformSettings.timezone_default);
  const platformDateFormat = platformSettings.date_format;
  const [search, setSearch] = useState("");

  const filteredFavorites = favorites.filter(
    (f) =>
      f.content.toLowerCase().includes(search.toLowerCase()) ||
      f.chatTitle.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Star className="h-5 w-5 text-yellow-500" />
            Mensajes guardados
          </DialogTitle>
          <VisuallyHidden>
            <DialogDescription>Tus mensajes favoritos guardados</DialogDescription>
          </VisuallyHidden>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar en guardados..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-9"
          />
          {search && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
              onClick={() => setSearch("")}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        <ScrollArea className="h-[400px] pr-4">
          {filteredFavorites.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Star className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <p className="text-muted-foreground">
                {search ? "No se encontraron resultados" : "No hay mensajes guardados"}
              </p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Guarda mensajes importantes haciendo clic en el ícono de estrella
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredFavorites.map((fav) => (
                <div
                  key={fav.id}
                  className="group rounded-lg border p-3 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <MessageSquare className="h-3 w-3" />
                      <span
                        className="hover:underline cursor-pointer"
                        onClick={() => {
                          onSelect(fav.chatId);
                          onOpenChange(false);
                        }}
                      >
                        {fav.chatTitle}
                      </span>
                      <span>•</span>
                      <span>
                        {formatZonedDate(fav.savedAt, { timeZone: platformTimeZone, dateFormat: platformDateFormat })}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-red-500 hover:text-red-600"
                      onClick={() => onRemove(fav.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <p
                    className={cn(
                      "text-sm line-clamp-3",
                      fav.role === "user" && "text-muted-foreground"
                    )}
                  >
                    {fav.content}
                  </p>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
