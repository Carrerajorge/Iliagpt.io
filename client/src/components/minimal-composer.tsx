import { memo, useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  ArrowUp,
  Plus,
  Mic,
  Paperclip,
  Image,
  FileText,
  Settings,
  Sparkles,
  X,
  Globe,
  Code,
  Loader2
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

interface MinimalComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onFileUpload?: (files: FileList) => void;
  onVoiceStart?: () => void;
  isLoading?: boolean;
  placeholder?: string;
  className?: string;
  showAdvanced?: boolean;
  onToggleAdvanced?: () => void;
  disabled?: boolean;
  maxLength?: number;
}

export const MinimalComposer = memo(function MinimalComposer({
  value,
  onChange,
  onSubmit,
  onFileUpload,
  onVoiceStart,
  isLoading = false,
  placeholder = "Escribe tu mensaje...",
  className,
  showAdvanced = false,
  onToggleAdvanced,
  disabled = false,
  maxLength = 10000,
}: MinimalComposerProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !isLoading && !disabled) {
        onSubmit();
      }
    }
  }, [value, isLoading, disabled, onSubmit]);

  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      const newHeight = Math.min(textarea.scrollHeight, 200);
      textarea.style.height = `${newHeight}px`;
    }
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && onFileUpload) {
      onFileUpload(e.target.files);
    }
  }, [onFileUpload]);

  const canSubmit = value.trim().length > 0 && !isLoading && !disabled;

  return (
    <div className={cn("relative", className)}>
      {/* Gradient border effect on focus */}
      <div
        className={cn(
          "absolute -inset-[1px] rounded-[18px] opacity-0 transition-opacity duration-300",
          "bg-gradient-to-r from-blue-500/50 via-purple-500/50 to-pink-500/50",
          isFocused && "opacity-100"
        )}
      />
      <div
        className={cn(
          "relative rounded-2xl border transition-all duration-300",
          "bg-background/80 backdrop-blur-xl",
          isFocused
            ? "border-white/20 shadow-[0_8px_32px_-8px_rgba(59,130,246,0.25)]"
            : "border-border/60 hover:border-border shadow-lg shadow-black/5",
          disabled && "opacity-50 pointer-events-none"
        )}
      >
        <div className="flex items-end gap-2 p-2">
          <AnimatePresence>
            {(isFocused || showActions) && (
              <motion.div
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                className="flex items-center gap-1 overflow-hidden"
              >
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Paperclip className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Adjuntar archivo</TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                {onVoiceStart && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
                          onClick={onVoiceStart}
                        >
                          <Mic className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Mensaje de voz</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex-1 relative">
            <Textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => setIsFocused(true)}
              onBlur={() => {
                setIsFocused(false);
                setTimeout(() => setShowActions(false), 200);
              }}
              placeholder={placeholder}
              disabled={disabled}
              className={cn(
                "min-h-[40px] max-h-[200px] resize-none",
                "border-0 bg-transparent outline-none focus-visible:outline-none focus-visible:ring-0",
                "py-2 px-1",
                "text-base placeholder:text-muted-foreground/60"
              )}
              rows={1}
              maxLength={maxLength}
            />
          </div>

          <div className="flex items-center gap-1">
            {onToggleAdvanced && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className={cn(
                        "h-8 w-8 rounded-full",
                        showAdvanced
                          ? "text-primary bg-primary/10"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                      onClick={onToggleAdvanced}
                    >
                      <Sparkles className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Opciones avanzadas</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            <Button
              type="button"
              size="icon"
              disabled={!canSubmit}
              onClick={onSubmit}
              className={cn(
                "h-9 w-9 rounded-full transition-all duration-300",
                canSubmit
                  ? "bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 hover:scale-105"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {value.length > maxLength * 0.9 && (
          <div className="px-3 pb-2">
            <span className={cn(
              "text-xs",
              value.length >= maxLength ? "text-red-500" : "text-muted-foreground"
            )}>
              {value.length}/{maxLength}
            </span>
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileSelect}
        accept=".pdf,.doc,.docx,.txt,.md,.xlsx,.csv,.png,.jpg,.jpeg,.gif"
      />

      <AnimatePresence>
        {showAdvanced && (
          <motion.div
            initial={{ opacity: 0, y: -10, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -10, height: 0 }}
            className="mt-2"
          >
            <AdvancedOptions />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

const AdvancedOptions = memo(function AdvancedOptions() {
  return (
    <div className="flex items-center gap-2 p-2 rounded-xl bg-muted/50 border border-border/50">
      <span className="text-xs text-muted-foreground px-2">Modo:</span>
      <div className="flex items-center gap-1">
        {[
          { icon: Globe, label: "Web" },
          { icon: Code, label: "Código" },
          { icon: FileText, label: "Documento" },
          { icon: Image, label: "Imagen" },
        ].map(({ icon: Icon, label }) => (
          <Button
            key={label}
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs gap-1.5"
          >
            <Icon className="h-3 h-3" />
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
});

export default MinimalComposer;
