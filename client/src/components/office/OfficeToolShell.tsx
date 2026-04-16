import React, { useState } from 'react';
import {
    X, Download, FileCode, Eye,
    Menu, Save, Maximize2, Minimize2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';

export type OfficeViewMode = 'visual' | 'code';
export type OfficeToolType = 'word' | 'excel' | 'ppt';

interface OfficeToolShellProps {
    title: string;
    type: OfficeToolType;
    onClose: () => void;
    onDownload: () => void;
    onSave?: () => void;
    viewMode: OfficeViewMode;
    onViewModeChange: (mode: OfficeViewMode) => void;
    children: React.ReactNode;
    toolbar?: React.ReactNode;
    sidebar?: React.ReactNode;
    statusBar?: React.ReactNode;
    className?: string;
}

export function OfficeToolShell({
    title,
    type,
    onClose,
    onDownload,
    onSave,
    viewMode,
    onViewModeChange,
    children,

    toolbar,
    sidebar,
    statusBar,
    className
}: OfficeToolShellProps) {
    const [isFullscreen, setIsFullscreen] = useState(false);

    const getThemeColor = () => {
        switch (type) {
            case 'word': return 'bg-blue-600';
            case 'excel': return 'bg-green-600';
            case 'ppt': return 'bg-orange-600';
            default: return 'bg-gray-800';
        }
    };

    return (
        <div className={cn("flex flex-col h-full bg-white dark:bg-neutral-900 overflow-hidden", isFullscreen ? "fixed inset-0 z-50" : "relative", className)}>
            {/* Top Ribbon / Header */}
            <div className={cn("h-14 flex-shrink-0 flex items-center justify-between px-4 text-white shadow-md z-20 transition-colors", getThemeColor())}>
                {/* Left Side: Menu Trigger, Title, Tabs */}
                <div className="flex items-center gap-3">
                    {sidebar && (
                        <Sheet>
                            <SheetTrigger asChild>
                                <Button variant="ghost" size="icon" className="hover:bg-white/20 text-white h-9 w-9">
                                    <Menu className="h-5 w-5" />
                                </Button>
                            </SheetTrigger>
                            <SheetContent side="left" className="w-[300px] p-0">
                                {sidebar}
                            </SheetContent>
                        </Sheet>
                    )}

                    <div className="flex items-center gap-2 select-none">
                        <div className="bg-white/20 p-1.5 rounded-lg">
                            {type === 'word' && <FileCode className="h-4 w-4" />}
                            {type === 'excel' && <Menu className="h-4 w-4" />}
                            {type === 'ppt' && <Menu className="h-4 w-4" />}
                        </div>
                        <span className="font-semibold tracking-tight text-sm sm:text-base">{title}</span>
                    </div>

                    <div className="h-6 w-px bg-white/30 mx-2 hidden sm:block" />

                    <div className="hidden md:flex items-center gap-1 text-xs font-medium">
                        <button className="px-3 py-1.5 hover:bg-white/20 rounded-md transition-colors border-b-2 border-transparent hover:border-white/50">Archivo</button>
                        <button className="px-3 py-1.5 hover:bg-white/20 rounded-md transition-colors border-b-2 border-white font-bold bg-white/10">Inicio</button>
                        <button className="px-3 py-1.5 hover:bg-white/20 rounded-md transition-colors border-b-2 border-transparent hover:border-white/50">Insertar</button>
                        <button className="px-3 py-1.5 hover:bg-white/20 rounded-md transition-colors border-b-2 border-transparent hover:border-white/50">Vista</button>
                    </div>
                </div>

                {/* Right Side: View Toggles, Actions */}
                <div className="flex items-center gap-2">
                    <div className="bg-black/20 rounded-lg p-1 flex items-center mr-2 shadow-inner">
                        <button
                            onClick={() => onViewModeChange('visual')}
                            className={cn(
                                "px-3 py-1.5 rounded-md text-xs font-semibold transition-all flex items-center gap-2",
                                viewMode === 'visual' ? "bg-white text-black shadow-sm" : "text-white/70 hover:text-white hover:bg-white/10"
                            )}
                            title="Modo Visual (WYSIWYG)"
                        >
                            <Eye className="h-3.5 w-3.5" />
                            <span className="hidden lg:inline">Visual</span>
                        </button>
                        <button
                            onClick={() => onViewModeChange('code')}
                            className={cn(
                                "px-3 py-1.5 rounded-md text-xs font-semibold transition-all flex items-center gap-2",
                                viewMode === 'code' ? "bg-white text-black shadow-sm" : "text-white/70 hover:text-white hover:bg-white/10"
                            )}
                            title="Editar código fuente"
                        >
                            <FileCode className="h-3.5 w-3.5" />
                            <span className="hidden lg:inline">Código</span>
                        </button>
                    </div>

                    <div className="h-6 w-px bg-white/20 mr-1 hidden sm:block" />

                    <Button
                        variant="ghost"
                        size="sm"
                        className="hover:bg-white/20 text-white h-9 px-3 gap-2 hidden sm:flex"
                        onClick={onSave}
                        title="Guardar (Ctrl+S)"
                    >
                        <Save className="h-4 w-4" />
                        <span className="hidden xl:inline">Guardar</span>
                    </Button>

                    <Button
                        variant="secondary"
                        size="sm"
                        className="bg-white text-black hover:bg-gray-100 h-9 px-3 gap-2 shadow-sm font-semibold border-none"
                        onClick={onDownload}
                        title="Exportar archivo"
                    >
                        <Download className="h-4 w-4" />
                        <span className="hidden sm:inline">Exportar</span>
                    </Button>

                    <Button
                        variant="ghost"
                        size="icon"
                        className="hover:bg-white/20 text-white h-9 w-9 ml-1"
                        onClick={() => setIsFullscreen(!isFullscreen)}
                        title={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
                    >
                        {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                    </Button>

                    <Button
                        variant="ghost"
                        size="icon"
                        className="hover:bg-red-500 hover:text-white text-white/90 h-9 w-9 ml-1 transition-colors"
                        onClick={onClose}
                        title="Cerrar documento"
                    >
                        <X className="h-5 w-5" />
                    </Button>
                </div>
            </div>

            {/* Toolbar Area (Contextual) */}
            {toolbar && viewMode === 'visual' && (
                <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-800 bg-gray-50/95 dark:bg-neutral-800/95 backdrop-blur px-4 py-2 flex items-center gap-2 overflow-x-auto z-10 shadow-sm">
                    {toolbar}
                </div>
            )}

            {/* Main Content Area */}
            <div className="flex-1 overflow-hidden relative bg-gray-100 dark:bg-neutral-900/50">
                {children}
            </div>

            {/* Status Bar */}
            <div className="h-7 flex-shrink-0 bg-white dark:bg-neutral-900 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between px-3 text-[10px] text-gray-500 select-none z-20">
                {statusBar ? (
                    statusBar
                ) : (
                    <div className="flex items-center gap-3">
                        <span className="font-medium text-gray-700 dark:text-gray-400">Listo</span>
                        <span className="w-px h-3 bg-gray-300" />
                        <span>Español (Internacional)</span>
                        <span className="w-px h-3 bg-gray-300" />
                        <span className="hidden sm:inline">Accesibilidad: Todo correcto</span>
                    </div>
                )}
                {!statusBar && (
                    <div className="flex items-center gap-3">
                        <span>{viewMode === 'visual' ? 'Modo de Diseño' : 'Editor de Código'}</span>
                        <span className="w-px h-3 bg-gray-300" />
                        <span>100%</span>
                        <span className="w-px h-3 bg-gray-300" />
                        <Maximize2 className="h-3 w-3 cursor-pointer hover:text-black" onClick={() => setIsFullscreen(!isFullscreen)} />
                    </div>
                )}
            </div>
        </div>
    );
}
