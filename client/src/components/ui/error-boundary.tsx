import React from "react";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
    children: React.ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: React.ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error: Error) {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error("Uncaught error:", error, errorInfo);
        this.setState({ errorInfo });
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null, errorInfo: null });
        window.location.reload();
    };

    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen flex items-center justify-center p-4 bg-background">
                    <Card className="max-w-md w-full border-destructive/20 shadow-lg">
                        <CardHeader>
                            <div className="flex items-center gap-2 text-destructive mb-2">
                                <AlertCircle className="h-6 w-6" />
                                <CardTitle>Algo salió mal</CardTitle>
                            </div>
                            <CardDescription>
                                Se ha producido un error inesperado en la aplicación.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="bg-muted p-3 rounded-md text-xs font-mono overflow-auto max-h-[200px]">
                                {this.state.error?.message || "Error desconocido"}
                                {this.state.errorInfo && (
                                    <pre className="mt-2 text-muted-foreground">
                                        {this.state.errorInfo.componentStack}
                                    </pre>
                                )}
                            </div>
                        </CardContent>
                        <CardFooter>
                            <Button onClick={this.handleReset} className="w-full gap-2">
                                <RefreshCw className="h-4 w-4" />
                                Recargar Aplicación
                            </Button>
                        </CardFooter>
                    </Card>
                </div>
            );
        }

        return this.props.children;
    }
}
