import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertCircle, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class SimulatorErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("Uncaught error in Simulator:", error, errorInfo);
    }

    private handleRetry = () => {
        this.setState({ hasError: false, error: null });
    };

    public render() {
        if (this.state.hasError) {
            return (
                <Card className="w-full h-full border-red-200 bg-red-50/50 dark:bg-red-900/10">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-red-600 dark:text-red-400 text-lg">
                            <AlertCircle className="h-5 w-5" />
                            Simulator Visualization Error
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            Something went wrong while rendering the plan visualization. The agent is likely still running in the background.
                        </p>
                        {this.state.error && (
                            <pre className="text-xs bg-black/5 dark:bg-white/5 p-2 rounded overflow-auto max-h-[100px]">
                                {this.state.error.message}
                            </pre>
                        )}
                        <Button variant="outline" size="sm" onClick={this.handleRetry} className="gap-2">
                            <RefreshCcw className="h-4 w-4" />
                            Try to recover view
                        </Button>
                    </CardContent>
                </Card>
            );
        }

        return this.props.children;
    }
}
