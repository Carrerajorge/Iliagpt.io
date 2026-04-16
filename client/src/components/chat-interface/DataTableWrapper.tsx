import React, { useState } from "react";
import { Download, Maximize2, X, Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GranularErrorBoundary } from "@/components/ui/granular-error-boundary";
import { extractTableData, extractTextFromChildren, isNumericValue } from "./utils";

export const downloadTableAsExcel = (children: React.ReactNode) => {
    const data = extractTableData(children);
    if (data.length === 0) return;

    let csv = data.map(row =>
        row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')
    ).join('\n');

    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tabla_${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

export const copyTableToClipboard = (children: React.ReactNode) => {
    const data = extractTableData(children);
    if (data.length === 0) return;
    const text = data.map(row => row.join('\t')).join('\n');
    navigator.clipboard.writeText(text);
};

export const DataTableWrapper = ({ children }: { children?: React.ReactNode }) => {
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [copied, setCopied] = useState(false);
    const childArray = React.Children.toArray(children);
    let colCount = 0;
    childArray.forEach((child: any) => {
        if (child?.props?.children) {
            const rows = React.Children.toArray(child.props.children);
            rows.forEach((row: any) => {
                if (row?.props?.children) {
                    const cells = React.Children.toArray(row.props.children);
                    colCount = Math.max(colCount, cells.length);
                }
            });
        }
    });
    const minWidth = Math.min(Math.max(colCount * 150, 400), 1400);

    const handleCopy = () => {
        copyTableToClipboard(children);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const renderTable = () => (
        <table className="data-table" style={{ minWidth: `${minWidth}px` }}>
            {children}
        </table>
    );

    return (
        <GranularErrorBoundary compact>
            <>
                <div className="table-container group relative my-4">
                    <div className="table-actions absolute top-2 right-2 flex gap-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    onClick={() => downloadTableAsExcel(children)}
                                    className="p-1.5 rounded-md bg-background/90 backdrop-blur-sm border border-border hover:bg-accent transition-colors shadow-sm"
                                    data-testid="button-download-excel"
                                >
                                    <Download className="h-3.5 w-3.5 text-muted-foreground" />
                                </button>
                            </TooltipTrigger>
                            <TooltipContent>Descargar</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    onClick={() => setIsFullscreen(true)}
                                    className="p-1.5 rounded-md bg-background/90 backdrop-blur-sm border border-border hover:bg-accent transition-colors shadow-sm"
                                    data-testid="button-fullscreen-table"
                                >
                                    <Maximize2 className="h-3.5 w-3.5 text-muted-foreground" />
                                </button>
                            </TooltipTrigger>
                            <TooltipContent>Ampliar</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    onClick={handleCopy}
                                    className="p-1.5 rounded-md bg-background/90 backdrop-blur-sm border border-border hover:bg-accent transition-colors shadow-sm"
                                    data-testid="button-copy-table"
                                >
                                    {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
                                </button>
                            </TooltipTrigger>
                            <TooltipContent>{copied ? "Copiado" : "Copiar"}</TooltipContent>
                        </Tooltip>
                    </div>
                    <div className="table-wrap">
                        {renderTable()}
                    </div>
                </div>

                {isFullscreen && (
                    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col">
                        <div className="flex items-center justify-between p-4 border-b">
                            <h3 className="font-semibold">Vista ampliada</h3>
                            <div className="flex gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => downloadTableAsExcel(children)}
                                    data-testid="button-download-excel-fullscreen"
                                >
                                    <Download className="h-4 w-4 mr-2" />
                                    Descargar
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setIsFullscreen(false)}
                                    data-testid="button-close-fullscreen"
                                >
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-auto p-4">
                            <div className="table-wrap">
                                {renderTable()}
                            </div>
                        </div>
                    </div>
                )}
            </>
        </GranularErrorBoundary>
    )
}

export const CleanDataTableComponents = {
    table: DataTableWrapper,
    thead: ({ children }: { children?: React.ReactNode }) => <thead>{children}</thead>,
    tbody: ({ children }: { children?: React.ReactNode }) => <tbody>{children}</tbody>,
    tr: ({ children }: { children?: React.ReactNode }) => <tr>{children}</tr>,
    th: ({ children }: { children?: React.ReactNode }) => {
        const text = extractTextFromChildren(children);
        const isNumeric = isNumericValue(text);
        return (
            <th scope="col" className={isNumeric ? "text-right" : ""}>
                {children}
            </th>
        );
    },
    td: ({ children }: { children?: React.ReactNode }) => {
        const text = extractTextFromChildren(children);
        const isNumeric = isNumericValue(text);
        const isLong = text.length > 50;
        return (
            <td className={`${isNumeric ? "text-right" : ""} ${isLong ? "wrap-cell" : ""}`}>
                {children}
            </td>
        );
    }
};
