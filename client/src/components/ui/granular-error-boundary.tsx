
import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
    compact?: boolean;
    className?: string;
    onReset?: () => void;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class GranularErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("GranularErrorBoundary caught error:", error, errorInfo);
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null });
        this.props.onReset?.();
    };

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            const isCompact = this.props.compact;

            return (
                <div className={cn(
                    "flex flex-col items-center justify-center p-4 rounded-lg bg-destructive/5 border border-destructive/20",
                    isCompact ? "p-2 min-h-[60px]" : "min-h-[120px]",
                    this.props.className
                )}>
                    <div className="flex items-center gap-2 text-destructive mb-2">
                        <AlertCircle className={cn(isCompact ? "h-4 w-4" : "h-6 w-6")} />
                        {!isCompact && <span className="font-medium">Error al cargar componente</span>}
                    </div>

                    {!isCompact && (
                        <p className="text-xs text-muted-foreground mb-3 font-mono max-w-[200px] truncate">
                            {this.state.error?.message.slice(0, 50)}...
                        </p>
                    )}

                    <Button
                        variant="outline"
                        size="sm"
                        onClick={this.handleReset}
                        className={cn("gap-2", isCompact && "h-6 text-xs px-2")}
                    >
                        <RefreshCw className={cn("h-3 w-3", isCompact ? "h-2.5 w-2.5" : "")} />
                        Title
                    </Button>
                </div>
            );
        }

        return this.props.children;
    }
}
