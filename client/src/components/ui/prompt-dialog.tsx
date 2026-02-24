import { useEffect, useMemo, useState } from "react";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type PromptDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
  required?: boolean;
  multiline?: boolean;
  inputType?: React.HTMLInputTypeAttribute;
  autoFocus?: boolean;
  maxLength?: number;
  validate?: (value: string) => string | null;
  onConfirm: (value: string) => void | Promise<void>;
};

export function PromptDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  placeholder,
  defaultValue,
  confirmText = "Guardar",
  cancelText = "Cancelar",
  required = true,
  multiline = false,
  inputType = "text",
  autoFocus = true,
  maxLength,
  validate,
  onConfirm,
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) setValue(defaultValue ?? "");
  }, [open, defaultValue]);

  const error = useMemo(() => {
    const trimmed = value.trim();
    if (required && !trimmed) return "Este campo es obligatorio.";
    return validate ? validate(value) : null;
  }, [required, validate, value]);

  const canSubmit = !isSubmitting && !error;

  const handleConfirm = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    try {
      await onConfirm(required ? value.trim() : value);
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!isSubmitting ? onOpenChange(next) : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : (
            <VisuallyHidden>
              <DialogDescription>{title}</DialogDescription>
            </VisuallyHidden>
          )}
        </DialogHeader>
        <div className="space-y-2">
          {label ? <Label>{label}</Label> : null}
          {multiline ? (
            <Textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              autoFocus={autoFocus}
              maxLength={maxLength}
            />
          ) : (
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              type={inputType}
              autoFocus={autoFocus}
              maxLength={maxLength}
            />
          )}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            {cancelText}
          </Button>
          <Button onClick={handleConfirm} disabled={!canSubmit}>
            {isSubmitting ? "Guardando..." : confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

