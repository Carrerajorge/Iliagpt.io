import { toast as sonnerToast } from "sonner";

type ToasterToast = {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: "default" | "destructive";
  duration?: number;
  className?: string;
  action?: React.ReactNode;
};

type Toast = Omit<ToasterToast, "id">;

function toast({ title, description, variant, duration, action, ...rest }: Toast) {
  const options: Record<string, unknown> = {
    description,
    duration,
    action,
    ...rest,
  };

  let id: string | number;

  if (variant === "destructive") {
    id = sonnerToast.error(title, options);
  } else {
    id = sonnerToast(title, options);
  }

  return {
    id: String(id),
    dismiss: () => sonnerToast.dismiss(id),
    update: (props: Partial<ToasterToast>) => {
      // Sonner doesn't support in-place updates the same way;
      // dismiss old toast and show a new one with merged props.
      sonnerToast.dismiss(id);
      toast({ title, description, variant, duration, action, ...rest, ...props });
    },
  };
}

function useToast() {
  return {
    toast,
    dismiss: (toastId?: string) => {
      if (toastId) {
        sonnerToast.dismiss(toastId);
      } else {
        sonnerToast.dismiss();
      }
    },
    // Sonner manages its own state; keep this for API compatibility.
    toasts: [] as ToasterToast[],
  };
}

export { useToast, toast };
