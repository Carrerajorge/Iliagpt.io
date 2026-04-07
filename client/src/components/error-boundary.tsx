import { Component, type ReactNode, type ComponentType, useState } from "react";
import { AlertTriangle, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Section-specific messages
// ---------------------------------------------------------------------------

const SECTION_MESSAGES: Record<string, { heading: string; description: string }> = {
  chat: {
    heading: "Error en el chat",
    description: "No se pudo cargar la conversacion. Intenta recargar esta seccion.",
  },
  sidebar: {
    heading: "Error en el panel lateral",
    description: "El panel lateral encontro un problema. Intenta recargar.",
  },
  admin: {
    heading: "Error en administracion",
    description: "El panel de administracion fallo al cargar. Intenta de nuevo.",
  },
  settings: {
    heading: "Error en configuracion",
    description: "No se pudo cargar la configuracion. Intenta recargar.",
  },
};

const DEFAULT_MESSAGE = {
  heading: "Algo salio mal",
  description: "Hemos encontrado un error inesperado. Intenta recargar la seccion.",
};

// ---------------------------------------------------------------------------
// Props & State
// ---------------------------------------------------------------------------

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional custom fallback UI. When provided, section/default UI is bypassed. */
  fallback?: ReactNode;
  /** Called when an error is caught — useful for external error tracking. */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  /** Determines the contextual message shown in the default fallback. */
  section?: "chat" | "sidebar" | "admin" | "settings";
  /** Additional CSS classes applied to the root fallback container. */
  className?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// ---------------------------------------------------------------------------
// Expandable error details (function component for hooks usage)
// ---------------------------------------------------------------------------

function ErrorDetails({ error }: { error: Error }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        aria-expanded={expanded}
        aria-controls="error-details-content"
      >
        {expanded ? (
          <ChevronUp className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
        Detalles del error
      </button>
      {expanded && (
        <div
          id="error-details-content"
          className="bg-muted p-3 rounded-md text-xs font-mono overflow-auto max-h-40 mt-2"
        >
          <p className="text-destructive font-semibold break-words">
            {error.message || "Error desconocido"}
          </p>
          {error.stack && (
            <pre className="text-muted-foreground whitespace-pre-wrap mt-1 text-[10px] leading-relaxed">
              {error.stack}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ErrorBoundary (class component)
// ---------------------------------------------------------------------------

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[ErrorBoundary] Uncaught error:", error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    // Custom fallback takes precedence
    if (this.props.fallback) {
      return this.props.fallback;
    }

    const messages = this.props.section
      ? SECTION_MESSAGES[this.props.section] ?? DEFAULT_MESSAGE
      : DEFAULT_MESSAGE;

    return (
      <div
        className={cn(
          "flex items-center justify-center p-4 min-h-[200px] w-full",
          this.props.className,
        )}
        role="alert"
      >
        <Card className="w-full max-w-md border-destructive/20 shadow-lg">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto bg-destructive/10 p-3 rounded-full w-fit mb-3">
              <AlertTriangle className="h-7 w-7 text-destructive" aria-hidden="true" />
            </div>
            <CardTitle className="text-lg">{messages.heading}</CardTitle>
          </CardHeader>

          <CardContent className="text-center space-y-4">
            <p className="text-sm text-muted-foreground">{messages.description}</p>

            {this.state.error && <ErrorDetails error={this.state.error} />}
          </CardContent>

          <CardFooter className="flex flex-col gap-2">
            <Button onClick={this.handleRetry} className="w-full gap-2">
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Reintentar
            </Button>
            <button
              type="button"
              onClick={this.handleReload}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
            >
              Recargar pagina
            </button>
          </CardFooter>
        </Card>
      </div>
    );
  }
}

// ---------------------------------------------------------------------------
// HOC: withErrorBoundary
// ---------------------------------------------------------------------------

export function withErrorBoundary<P extends object>(
  WrappedComponent: ComponentType<P>,
  boundaryProps?: Omit<ErrorBoundaryProps, "children">,
) {
  const displayName = WrappedComponent.displayName || WrappedComponent.name || "Component";

  function WithErrorBoundary(props: P) {
    return (
      <ErrorBoundary {...boundaryProps}>
        <WrappedComponent {...props} />
      </ErrorBoundary>
    );
  }

  WithErrorBoundary.displayName = `withErrorBoundary(${displayName})`;
  return WithErrorBoundary;
}
