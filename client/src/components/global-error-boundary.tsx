import React, { Component, ErrorInfo, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
    onReset?: () => void;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

export class GlobalErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
        errorInfo: null,
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error, errorInfo: null };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("Uncaught error:", error, errorInfo);
        this.setState({ errorInfo });
        // Here you would typically log to an error reporting service
    }

    private handleReset = () => {
        this.setState({ hasError: false, error: null, errorInfo: null });
        this.props.onReset?.();
    };

    public render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="min-h-[400px] w-full flex items-center justify-center p-4 bg-background">
                    <Card className="w-full max-w-md border-destructive/20 shadow-lg">
                        <CardHeader className="text-center pb-2">
                            <div className="mx-auto bg-destructive/10 p-3 rounded-full w-fit mb-4">
                                <AlertTriangle className="h-8 w-8 text-destructive" />
                            </div>
                            <CardTitle className="text-xl">Algo salió mal</CardTitle>
                        </CardHeader>
                        <CardContent className="text-center space-y-4">
                            <p className="text-muted-foreground text-sm">
                                Hemos encontrado un error inesperado. Por favor, intenta recargar la sección.
                            </p>
                            {this.state.error && (
                                <details className="text-left">
                                    <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                                        Detalles del error
                                    </summary>
                                    <div className="bg-muted p-3 rounded-md text-left overflow-auto max-h-40 text-xs font-mono mt-2">
                                        <p className="font-bold text-red-500 mb-1">{this.state.error.toString()}</p>
                                        {this.state.errorInfo?.componentStack && (
                                            <pre className="text-muted-foreground whitespace-pre-wrap">
                                                {this.state.errorInfo.componentStack}
                                            </pre>
                                        )}
                                    </div>
                                </details>
                            )}
                        </CardContent>
                        <CardFooter className="flex justify-center">
                            <Button onClick={this.handleReset} className="w-full sm:w-auto">
                                <RefreshCw className="mr-2 h-4 w-4" />
                                Intentar de nuevo
                            </Button>
                        </CardFooter>
                    </Card>
                </div>
            );
        }

        return this.props.children;
    }
}
