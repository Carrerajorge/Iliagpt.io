/**
 * Create Project Modal Component
 * 
 * Modal for creating new project folders with:
 * - Project name
 * - Background image upload
 * - System prompt configuration
 * - Knowledge base file selection/upload
 */

import { useState, useRef, useCallback } from "react";
import { X, Upload, FileText, Trash2, Image, Plus, FolderPlus, Check, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface ProjectFile {
    id: string;
    name: string;
    type: string;
    size: number;
    source: "upload" | "knowledge";
}

export interface CreateProjectData {
    name: string;
    backgroundImage: string | null;
    systemPrompt: string;
    files: ProjectFile[];
    color: string;
}

interface CreateProjectModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreateProject: (data: CreateProjectData) => Promise<void>;
    knowledgeFiles?: Array<{ id: string; name: string; type: string; size: number }>;
}

const PROJECT_COLORS = [
    "#3b82f6", // blue
    "#22c55e", // green
    "#a855f7", // purple
    "#f97316", // orange
    "#ef4444", // red
    "#ec4899", // pink
    "#14b8a6", // teal
    "#f59e0b", // amber
];

export function CreateProjectModal({
    open,
    onOpenChange,
    onCreateProject,
    knowledgeFiles = []
}: CreateProjectModalProps) {
    const [name, setName] = useState("");
    const [systemPrompt, setSystemPrompt] = useState("");
    const [backgroundImage, setBackgroundImage] = useState<string | null>(null);
    const [selectedFiles, setSelectedFiles] = useState<ProjectFile[]>([]);
    const [selectedColor, setSelectedColor] = useState(PROJECT_COLORS[0]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showKnowledgeSelector, setShowKnowledgeSelector] = useState(false);

    const imageInputRef = useRef<HTMLInputElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleBackgroundUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file && file.type.startsWith("image/")) {
            const reader = new FileReader();
            reader.onload = (event) => {
                setBackgroundImage(event.target?.result as string);
            };
            reader.readAsDataURL(file);
        }
    }, []);

    const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files) {
            const newFiles: ProjectFile[] = Array.from(files).map((file) => ({
                id: `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                name: file.name,
                type: file.type,
                size: file.size,
                source: "upload" as const
            }));
            setSelectedFiles((prev) => [...prev, ...newFiles]);
        }
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    }, []);

    const handleSelectKnowledge = useCallback((file: { id: string; name: string; type: string; size: number }) => {
        const alreadySelected = selectedFiles.some(f => f.id === file.id);
        if (!alreadySelected) {
            setSelectedFiles((prev) => [
                ...prev,
                {
                    ...file,
                    source: "knowledge" as const
                }
            ]);
        }
    }, [selectedFiles]);

    const handleRemoveFile = useCallback((fileId: string) => {
        setSelectedFiles((prev) => prev.filter((f) => f.id !== fileId));
    }, []);

    const handleSubmit = async () => {
        if (!name.trim()) return;

        setIsSubmitting(true);
        try {
            await onCreateProject({
                name: name.trim(),
                backgroundImage,
                systemPrompt,
                files: selectedFiles,
                color: selectedColor
            });

            // Reset form
            setName("");
            setSystemPrompt("");
            setBackgroundImage(null);
            setSelectedFiles([]);
            setSelectedColor(PROJECT_COLORS[0]);
            onOpenChange(false);
        } catch (error) {
            console.error("Failed to create project:", error);
        } finally {
            setIsSubmitting(false);
        }
    };

    const formatFileSize = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-hidden flex flex-col shadow-2xl border-white/20 bg-white/95 backdrop-blur-xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <FolderPlus className="h-5 w-5" />
                        Create Project
                    </DialogTitle>
                    <DialogDescription>
                        Create a new project folder with custom configuration and knowledge base.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto pr-4 -mr-4">
                    <div className="space-y-6 py-4">
                        {/* Project Name */}
                        <div className="space-y-2">
                            <Label htmlFor="project-name" className="text-sm font-medium">
                                Project Name
                            </Label>
                            <Input
                                id="project-name"
                                placeholder="Enter project name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="h-11 rounded-xl bg-neutral-50 border-neutral-200 focus-visible:ring-[#A5A0FF] focus-visible:border-[#A5A0FF] transition-all shadow-sm"
                                data-testid="input-project-name"
                            />
                        </div>

                        {/* Project Color */}
                        <div className="space-y-2">
                            <Label className="text-sm font-medium">Project Color</Label>
                            <div className="flex gap-3 flex-wrap pt-1">
                                {PROJECT_COLORS.map((color) => (
                                    <button
                                        key={color}
                                        type="button"
                                        className={cn(
                                            "h-9 w-9 rounded-full transition-all duration-300 ring-2 ring-offset-2 flex items-center justify-center shadow-sm",
                                            selectedColor === color ? "ring-[#A5A0FF] scale-110" : "ring-transparent hover:scale-105"
                                        )}
                                        style={{ backgroundColor: color }}
                                        onClick={() => setSelectedColor(color)}
                                        data-testid={`color-${color}`}
                                    >
                                        {selectedColor === color && <Check className="h-4 w-4 text-white drop-shadow-md" />}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Background Image */}
                        <div className="space-y-2">
                            <Label className="text-sm font-medium">Project Background Image</Label>
                            <input
                                ref={imageInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={handleBackgroundUpload}
                                data-testid="input-background-image"
                            />
                            {backgroundImage ? (
                                <div className="relative rounded-lg overflow-hidden border">
                                    <img
                                        src={backgroundImage}
                                        alt="Project background"
                                        className="w-full h-32 object-cover"
                                    />
                                    <Button
                                        variant="destructive"
                                        size="icon"
                                        className="absolute top-2 right-2 h-8 w-8"
                                        onClick={() => setBackgroundImage(null)}
                                        data-testid="button-remove-background"
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>
                            ) : (
                                <Button
                                    variant="outline"
                                    className="w-full h-28 border-2 border-dashed border-neutral-200 bg-neutral-50/50 hover:bg-neutral-50 hover:border-[#A5A0FF]/50 flex flex-col gap-3 transition-colors shadow-sm rounded-xl group"
                                    onClick={() => imageInputRef.current?.click()}
                                    data-testid="button-upload-background"
                                >
                                    <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform border border-neutral-100">
                                        <Image className="h-5 w-5 text-neutral-500 group-hover:text-[#A5A0FF] transition-colors" />
                                    </div>
                                    <span className="text-sm font-medium text-neutral-600">Click to upload image</span>
                                </Button>
                            )}
                        </div>

                        {/* System Prompt */}
                        <div className="space-y-2">
                            <Label htmlFor="system-prompt" className="text-sm font-medium">
                                System Prompt
                            </Label>
                            <Textarea
                                id="system-prompt"
                                placeholder="Escribe tu prompt de sistema aquí...&#10;ej. Eres un asistentente enfocado en neurociencias."
                                value={systemPrompt}
                                onChange={(e) => setSystemPrompt(e.target.value)}
                                className="min-h-[110px] resize-y rounded-xl bg-neutral-50 border-neutral-200 focus-visible:ring-[#A5A0FF] focus-visible:border-[#A5A0FF] shadow-sm transition-all"
                                data-testid="textarea-system-prompt"
                            />
                        </div>

                        {/* Files Section */}
                        <div className="space-y-3">
                            <Label className="text-sm font-medium">Files</Label>

                            {/* Action Buttons */}
                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="gap-2 rounded-full font-normal shadow-sm"
                                    onClick={() => setShowKnowledgeSelector(!showKnowledgeSelector)}
                                    data-testid="button-select-knowledge"
                                >
                                    <FileText className="h-4 w-4" />
                                    Select Knowledge
                                </Button>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    multiple
                                    className="hidden"
                                    onChange={handleFileUpload}
                                    data-testid="input-upload-files"
                                />
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="gap-2 rounded-full font-normal shadow-sm"
                                    onClick={() => fileInputRef.current?.click()}
                                    data-testid="button-upload-files"
                                >
                                    <Upload className="h-4 w-4" />
                                    Upload Files
                                </Button>
                            </div>

                            {/* Knowledge Selector */}
                            {showKnowledgeSelector && (
                                <div className="border rounded-lg p-3 bg-muted/30">
                                    <p className="text-xs text-muted-foreground mb-2">
                                        Select from your knowledge base:
                                    </p>
                                    {knowledgeFiles.length > 0 ? (
                                        <div className="space-y-1 max-h-32 overflow-y-auto">
                                            {knowledgeFiles.map((file) => {
                                                const isSelected = selectedFiles.some(f => f.id === file.id);
                                                return (
                                                    <button
                                                        key={file.id}
                                                        type="button"
                                                        className={cn(
                                                            "w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm transition-colors",
                                                            isSelected
                                                                ? "bg-primary/10 text-primary"
                                                                : "hover:bg-accent"
                                                        )}
                                                        onClick={() => handleSelectKnowledge(file)}
                                                        disabled={isSelected}
                                                        data-testid={`knowledge-file-${file.id}`}
                                                    >
                                                        <FileText className="h-4 w-4 flex-shrink-0" />
                                                        <span className="truncate flex-1">{file.name}</span>
                                                        {isSelected && <Check className="h-4 w-4 text-primary" />}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <p className="text-sm text-muted-foreground italic">
                                            No knowledge files available. Add them to the "Knowledge" workspace first.
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* Info Text */}
                            <p className="text-xs text-muted-foreground">
                                To attach knowledge base here, add them to the "Knowledge" workspace first.
                            </p>

                            {/* Selected Files List */}
                            {selectedFiles.length > 0 && (
                                <div className="space-y-2">
                                    {selectedFiles.map((file) => (
                                        <div
                                            key={file.id}
                                            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border"
                                        >
                                            <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium truncate">{file.name}</p>
                                                <p className="text-xs text-muted-foreground">
                                                    {formatFileSize(file.size)} • {file.source === "knowledge" ? "Knowledge" : "Uploaded"}
                                                </p>
                                            </div>
                                            <Badge variant="outline" className="text-xs">
                                                {file.source}
                                            </Badge>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7 hover:bg-destructive/10 hover:text-destructive"
                                                onClick={() => handleRemoveFile(file.id)}
                                                data-testid={`remove-file-${file.id}`}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-3 pt-4 border-t px-2">
                    <Button
                        variant="outline"
                        className="rounded-xl px-6 font-medium shadow-none hover:bg-muted"
                        onClick={() => onOpenChange(false)}
                        disabled={isSubmitting}
                        data-testid="button-cancel"
                    >
                        Cancelar
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={!name.trim() || isSubmitting}
                        className="rounded-xl min-w-[90px] px-6 font-medium bg-[#A5A0FF] hover:bg-[#8D88E6] text-white shadow-none"
                        data-testid="button-save-project"
                    >
                        {isSubmitting ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            "Guardar"
                        )}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

export default CreateProjectModal;
