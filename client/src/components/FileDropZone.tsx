/**
 * File Drop Zone Component
 * Drag & drop file upload for chat interface
 */

import React, { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, File, X, Image, FileText, FileSpreadsheet, FilePlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

interface FileDropZoneProps {
    onFilesDropped: (files: File[]) => void;
    children: React.ReactNode;
    acceptedTypes?: string[];
    maxFiles?: number;
    maxSize?: number; // in MB
    className?: string;
}

interface DroppedFilePreview {
    file: File;
    preview?: string;
}

const DEFAULT_ACCEPTED_TYPES = [
    'image/*',
    'audio/*',
    'application/pdf',
    '.doc', '.docx',
    '.xls', '.xlsx',
    '.ppt', '.pptx',
    '.txt', '.md',
    '.csv', '.json',
    '.mp3', '.wav', '.m4a', '.ogg', '.flac', '.webm', '.aac',
];

const MAX_FILE_SIZE_MB = 500;

export function FileDropZone({
    onFilesDropped,
    children,
    acceptedTypes = DEFAULT_ACCEPTED_TYPES,
    maxFiles = 10,
    maxSize = MAX_FILE_SIZE_MB,
    className,
}: FileDropZoneProps) {
    const [isDragging, setIsDragging] = useState(false);
    const [droppedFiles, setDroppedFiles] = useState<DroppedFilePreview[]>([]);
    const dragCounter = useRef(0);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { toast } = useToast();

    const handleDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter.current++;
        if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
            setIsDragging(true);
        }
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter.current--;
        if (dragCounter.current === 0) {
            setIsDragging(false);
        }
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    const validateFiles = useCallback((files: File[]): File[] => {
        const validFiles: File[] = [];
        const errors: string[] = [];

        for (const file of files) {
            // Check file count
            if (validFiles.length >= maxFiles) {
                errors.push(`Maximum ${maxFiles} files allowed`);
                break;
            }

            // Check file size
            if (file.size > maxSize * 1024 * 1024) {
                errors.push(`${file.name} exceeds ${maxSize}MB limit`);
                continue;
            }

            validFiles.push(file);
        }

        if (errors.length > 0) {
            toast({
                title: 'Some files were rejected',
                description: errors.join(', '),
                variant: 'destructive',
            });
        }

        return validFiles;
    }, [maxFiles, maxSize, toast]);

    const processFiles = useCallback(async (files: File[]) => {
        const validFiles = validateFiles(files);
        if (validFiles.length === 0) return;

        const previews: DroppedFilePreview[] = await Promise.all(
            validFiles.map(async (file) => {
                if (file.type.startsWith('image/')) {
                    return new Promise<DroppedFilePreview>((resolve) => {
                        const reader = new FileReader();
                        reader.onload = () => {
                            resolve({ file, preview: reader.result as string });
                        };
                        reader.readAsDataURL(file);
                    });
                }
                return { file };
            })
        );

        setDroppedFiles(previews);
        onFilesDropped(validFiles);
    }, [validateFiles, onFilesDropped]);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        dragCounter.current = 0;

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const files = Array.from(e.dataTransfer.files);
            processFiles(files);
            e.dataTransfer.clearData();
        }
    }, [processFiles]);

    const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const files = Array.from(e.target.files);
            processFiles(files);
        }
    }, [processFiles]);

    const removeFile = useCallback((index: number) => {
        setDroppedFiles(prev => prev.filter((_, i) => i !== index));
    }, []);

    const clearFiles = useCallback(() => {
        setDroppedFiles([]);
    }, []);

    const getFileIcon = (file: File) => {
        if (file.type.startsWith('image/')) return Image;
        if (file.type.includes('spreadsheet') || file.name.match(/\.(xlsx?|csv)$/i)) return FileSpreadsheet;
        if (file.type.includes('pdf') || file.type.includes('document') || file.name.match(/\.(docx?|pdf)$/i)) return FileText;
        return File;
    };

    const formatFileSize = (bytes: number): string => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    return (
        <div
            className={cn("relative", className)}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
        >
            {/* Hidden file input */}
            <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                accept={acceptedTypes.join(',')}
                onChange={handleFileInputChange}
            />

            {/* Main content */}
            {children}

            {/* Drag overlay */}
            <AnimatePresence>
                {isDragging && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 z-50 flex items-center justify-center bg-primary/10 backdrop-blur-sm border-2 border-dashed border-primary rounded-lg"
                    >
                        <div className="flex flex-col items-center gap-4 p-8 text-center">
                            <motion.div
                                animate={{ y: [0, -10, 0] }}
                                transition={{ repeat: Infinity, duration: 1.5 }}
                            >
                                <Upload className="h-16 w-16 text-primary" />
                            </motion.div>
                            <div>
                                <p className="text-xl font-semibold text-primary">Suelta los archivos aquí</p>
                                <p className="text-sm text-muted-foreground mt-1">
                                    Máximo {maxFiles} archivos, {maxSize}MB cada uno
                                </p>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* File previews */}
            {droppedFiles.length > 0 && (
                <div className="absolute bottom-full left-0 right-0 mb-2">
                    <div className="flex flex-wrap gap-2 p-3 bg-muted/80 backdrop-blur rounded-lg border">
                        {droppedFiles.map((item, index) => {
                            const FileIcon = getFileIcon(item.file);
                            return (
                                <div
                                    key={index}
                                    className="flex items-center gap-2 px-3 py-2 bg-background rounded-md border group"
                                >
                                    {item.preview ? (
                                        <img
                                            src={item.preview}
                                            alt={item.file.name}
                                            className="h-8 w-8 object-cover rounded"
                                        />
                                    ) : (
                                        <FileIcon className="h-5 w-5 text-muted-foreground" />
                                    )}
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium truncate max-w-[120px]">
                                            {item.file.name}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {formatFileSize(item.file.size)}
                                        </p>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 opacity-0 group-hover:opacity-100"
                                        onClick={() => removeFile(index)}
                                    >
                                        <X className="h-3 w-3" />
                                    </Button>
                                </div>
                            );
                        })}
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground"
                            onClick={clearFiles}
                        >
                            Limpiar todo
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}

// Export a button variant for triggering file select
export function FileUploadButton({
    onFilesSelected,
    acceptedTypes = DEFAULT_ACCEPTED_TYPES,
    multiple = true,
    className,
    children,
}: {
    onFilesSelected: (files: File[]) => void;
    acceptedTypes?: string[];
    multiple?: boolean;
    className?: string;
    children?: React.ReactNode;
}) {
    const inputRef = useRef<HTMLInputElement>(null);

    const handleClick = () => {
        inputRef.current?.click();
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            onFilesSelected(Array.from(e.target.files));
            e.target.value = ''; // Reset to allow selecting same file again
        }
    };

    return (
        <>
            <input
                ref={inputRef}
                type="file"
                multiple={multiple}
                className="hidden"
                accept={acceptedTypes.join(',')}
                onChange={handleChange}
            />
            <Button
                variant="ghost"
                size="icon"
                onClick={handleClick}
                className={className}
            >
                {children || <FilePlus className="h-5 w-5" />}
            </Button>
        </>
    );
}
