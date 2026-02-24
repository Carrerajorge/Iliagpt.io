import { useState, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { MonacoCodeEditor } from '@/components/monaco-code-editor';
import { X, Download, Play, Loader2, Eye, Code, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

interface DocxCodeEditorProps {
    title: string;
    initialCode?: string;
    onClose: () => void;
    onCodeChange?: (code: string) => void;
    generatedDocUrl?: string | null;
    isGenerating?: boolean;
    generationProgress?: number;
    generationStage?: string;
}

// Default template code for docx library
const DEFAULT_DOCX_CODE = `// Documento generado con docx library
// Usa este código para personalizar tu documento

async function createDocument() {
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: "Arial", size: 24 }
        }
      }
    },
    sections: [{
      properties: {
        page: {
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
        }
      },
      children: [
        // Título
        new Paragraph({
          children: [
            new TextRun({
              text: "Título del Documento",
              bold: true,
              size: 48
            })
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 }
        }),
        
        // Contenido
        new Paragraph({
          children: [
            new TextRun("Escribe tu contenido aquí...")
          ]
        }),
        
        // Sección de Firmas (lado izquierdo y derecho)
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: { /* sin bordes */ },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  width: { size: 50, type: WidthType.PERCENTAGE },
                  children: [
                    new Paragraph({
                      children: [new TextRun("_________________________")],
                      alignment: AlignmentType.CENTER
                    }),
                    new Paragraph({
                      children: [new TextRun("Firma Izquierda")],
                      alignment: AlignmentType.CENTER
                    })
                  ]
                }),
                new TableCell({
                  width: { size: 50, type: WidthType.PERCENTAGE },
                  children: [
                    new Paragraph({
                      children: [new TextRun("_________________________")],
                      alignment: AlignmentType.CENTER
                    }),
                    new Paragraph({
                      children: [new TextRun("Firma Derecha")],
                      alignment: AlignmentType.CENTER
                    })
                  ]
                })
              ]
            })
          ]
        })
      ]
    }]
  });
  
  return doc;
}
`;

export function DocxCodeEditor({
    title,
    initialCode = DEFAULT_DOCX_CODE,
    onClose,
    onCodeChange,
    generatedDocUrl,
    isGenerating = false,
    generationProgress = 0,
    generationStage = '',
}: DocxCodeEditorProps) {
    const [code, setCode] = useState(initialCode);
    const [activeTab, setActiveTab] = useState<'code' | 'preview'>('code');
    const [isExecuting, setIsExecuting] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(generatedDocUrl || null);
    const { toast } = useToast();

    const handleCodeChange = useCallback((newCode: string) => {
        setCode(newCode);
        onCodeChange?.(newCode);
    }, [onCodeChange]);

    const handleExecuteCode = useCallback(async () => {
        setIsExecuting(true);
        try {
            // Call backend to execute the docx code
            const response = await fetch('/api/documents/execute-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code }),
            });

            if (!response.ok) {
                throw new Error('Failed to execute code');
            }

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            setPreviewUrl(url);
            setActiveTab('preview');

            toast({
                title: 'Documento generado',
                description: 'El código se ejecutó correctamente',
            });
        } catch (error) {
            console.error('Execution error:', error);
            toast({
                title: 'Error de ejecución',
                description: 'No se pudo ejecutar el código. Revisa la sintaxis.',
                variant: 'destructive',
            });
        } finally {
            setIsExecuting(false);
        }
    }, [code, toast]);

    const handleDownload = useCallback(() => {
        if (!previewUrl) return;

        const a = document.createElement('a');
        a.href = previewUrl;
        a.download = `${title}.docx`;
        a.click();
    }, [previewUrl, title]);

    return (
        <div className="h-full flex flex-col bg-background">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
                <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-600">
                        <span className="text-white text-sm font-bold">W</span>
                    </div>
                    <h2 className="font-semibold text-lg truncate max-w-md">{title}</h2>
                </div>

                <div className="flex items-center gap-2">
                    {/* Tab switcher */}
                    <div className="flex items-center bg-muted rounded-lg p-0.5">
                        <button
                            onClick={() => setActiveTab('code')}
                            className={cn(
                                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                                activeTab === 'code'
                                    ? "bg-background text-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <Code className="h-4 w-4" />
                            Código
                        </button>
                        <button
                            onClick={() => setActiveTab('preview')}
                            className={cn(
                                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                                activeTab === 'preview'
                                    ? "bg-background text-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <Eye className="h-4 w-4" />
                            Preview
                        </button>
                    </div>

                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleExecuteCode}
                        disabled={isExecuting || isGenerating}
                    >
                        {isExecuting ? (
                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        ) : (
                            <Play className="h-4 w-4 mr-1" />
                        )}
                        Ejecutar
                    </Button>

                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDownload}
                        disabled={!previewUrl}
                    >
                        <Download className="h-4 w-4 mr-1" />
                        Descargar
                    </Button>

                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onClose}
                        className="bg-red-500 hover:bg-red-600 text-white rounded-md"
                    >
                        <X className="h-5 w-5" />
                    </Button>
                </div>
            </div>

            {/* Generation progress overlay */}
            {isGenerating && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
                    <div className="flex flex-col items-center gap-4 p-6 bg-card border rounded-xl shadow-xl max-w-md">
                        <Loader2 className="h-12 w-12 animate-spin text-blue-500" />
                        <div className="text-center">
                            <p className="font-medium">{generationStage || 'Generando documento...'}</p>
                            <div className="mt-2 w-64 h-2 bg-muted rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-blue-500 transition-all duration-300"
                                    style={{ width: `${generationProgress}%` }}
                                />
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">{generationProgress}%</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Content area */}
            <div className="flex-1 overflow-hidden">
                {activeTab === 'code' ? (
                    <div className="h-full">
                        <MonacoCodeEditor
                            code={code}
                            language="typescript"
                            onChange={handleCodeChange}
                            height="100%"
                        />
                    </div>
                ) : (
                    <div className="h-full flex items-center justify-center bg-gray-100 dark:bg-gray-900 p-8">
                        {previewUrl ? (
                            <div className="flex flex-col items-center gap-4">
                                <div className="bg-white dark:bg-gray-800 shadow-lg rounded-lg p-8 max-w-2xl">
                                    <div className="text-center">
                                        <div className="w-16 h-16 mx-auto mb-4 flex items-center justify-center bg-blue-100 dark:bg-blue-900 rounded-full">
                                            <span className="text-3xl">📄</span>
                                        </div>
                                        <h3 className="text-lg font-semibold mb-2">Documento Generado</h3>
                                        <p className="text-muted-foreground mb-4">
                                            El documento DOCX está listo para descargar
                                        </p>
                                        <Button onClick={handleDownload}>
                                            <Download className="h-4 w-4 mr-2" />
                                            Descargar DOCX
                                        </Button>
                                    </div>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setActiveTab('code')}
                                    className="text-muted-foreground"
                                >
                                    <RefreshCw className="h-4 w-4 mr-1" />
                                    Modificar código
                                </Button>
                            </div>
                        ) : (
                            <div className="text-center text-muted-foreground">
                                <Code className="h-16 w-16 mx-auto mb-4 opacity-50" />
                                <p>Ejecuta el código para ver la vista previa</p>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="mt-4"
                                    onClick={() => setActiveTab('code')}
                                >
                                    <Code className="h-4 w-4 mr-1" />
                                    Ir al código
                                </Button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
