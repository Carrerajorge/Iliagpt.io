/**
 * Edit Project Modal Component
 * 
 * Modal for editing existing projects with:
 * - Project name
 * - Background image
 * - System prompt
 * - Files management
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { X, Upload, FileText, Trash2, Image, Loader2, Save } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Project } from "@/hooks/use-projects";
import type { ProjectFile } from "@/components/create-project-modal";

const PROJECT_COLORS = [
    "#3b82f6", "#22c55e", "#a855f7", "#f97316",
    "#ef4444", "#ec4899", "#14b8a6", "#f59e0b",
];

interface EditProjectModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    project: Project | null;
    onSave: (projectId: string, updates: Partial<Project>) => void;
}

export function EditProjectModal({
    open,
    onOpenChange,
    project,
    onSave
}: EditProjectModalProps) {
    const [name, setName] = useState("");
    const [systemPrompt, setSystemPrompt] = useState("");
    const [backgroundImage, setBackgroundImage] = useState<string | null>(null);
    const [selectedColor, setSelectedColor] = useState(PROJECT_COLORS[0]);
    const [files, setFiles] = useState<ProjectFile[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const imageInputRef = useRef<HTMLInputElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Populate form when project changes
    useEffect(() => {
        if (project) {
            setName(project.name);
            setSystemPrompt(project.systemPrompt || "");
            setBackgroundImage(project.backgroundImage);
            setSelectedColor(project.color);
            setFiles(project.files || []);
        }
    }, [project]);

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
        const uploadedFiles = e.target.files;
        if (uploadedFiles) {
            const newFiles: ProjectFile[] = Array.from(uploadedFiles).map((file) => ({
                id: `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                name: file.name,
                type: file.type,
                size: file.size,
                source: "upload" as const
            }));
            setFiles((prev) => [...prev, ...newFiles]);
        }
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    }, []);

    const handleRemoveFile = useCallback((fileId: string) => {
        setFiles((prev) => prev.filter((f) => f.id !== fileId));
    }, []);

    const handleSubmit = async () => {
        if (!name.trim() || !project) return;

        setIsSubmitting(true);
        try {
            onSave(project.id, {
                name: name.trim(),
                backgroundImage,
                systemPrompt,
                color: selectedColor,
                files
            });
            onOpenChange(false);
        } finally {
            setIsSubmitting(false);
        }
    };

    const formatFileSize = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    if (!project) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-hidden flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Save className="h-5 w-5" />
                        Edit Project
                    </DialogTitle>
                    <DialogDescription>
                        Modify project settings and attached files.
                    </DialogDescription>
                </DialogHeader>

                <ScrollArea className="flex-1 pr-4 -mr-4">
                    <div className="space-y-6 py-4">
                        {/* Project Name */}
                        <div className="space-y-2">
                            <Label htmlFor="edit-project-name">Project Name</Label>
                            <Input
                                id="edit-project-name"
                                placeholder="Enter project name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                data-testid="input-edit-project-name"
                            />
                        </div>

                        {/* Project Color */}
                        <div className="space-y-2">
                            <Label>Project Color</Label>
                            <div className="flex gap-2 flex-wrap">
                                {PROJECT_COLORS.map((color) => (
                                    <button
                                        key={color}
                                        type="button"
                                        className={cn(
                                            "h-8 w-8 rounded-full transition-all ring-2 ring-offset-2 ring-offset-background",
                                            selectedColor === color ? "ring-foreground scale-110" : "ring-transparent hover:scale-105"
                                        )}
                                        style={{ backgroundColor: color }}
                                        onClick={() => setSelectedColor(color)}
                                    />
                                ))}
                            </div>
                        </div>

                        {/* Background Image */}
                        <div className="space-y-2">
                            <Label>Background Image</Label>
                            <input
                                ref={imageInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={handleBackgroundUpload}
                            />
                            {backgroundImage ? (
                                <div className="relative rounded-lg overflow-hidden border">
                                    <img src={backgroundImage} alt="Background" className="w-full h-24 object-cover" />
                                    <Button
                                        variant="destructive"
                                        size="icon"
                                        className="absolute top-2 right-2 h-7 w-7"
                                        onClick={() => setBackgroundImage(null)}
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>
                            ) : (
                                <Button
                                    variant="outline"
                                    className="w-full h-20 border-dashed"
                                    onClick={() => imageInputRef.current?.click()}
                                >
                                    <Image className="h-5 w-5 mr-2" />
                                    Upload Image
                                </Button>
                            )}
                        </div>

                        {/* System Prompt */}
                        <div className="space-y-2">
                            <Label htmlFor="edit-system-prompt">System Prompt</Label>
                            <Textarea
                                id="edit-system-prompt"
                                placeholder="Write custom instructions for this project..."
                                value={systemPrompt}
                                onChange={(e) => setSystemPrompt(e.target.value)}
                                className="min-h-[80px]"
                            />
                        </div>

                        {/* Files */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <Label>Files ({files.length})</Label>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    multiple
                                    className="hidden"
                                    onChange={handleFileUpload}
                                />
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    <Upload className="h-4 w-4 mr-1" />
                                    Add Files
                                </Button>
                            </div>

                            {files.length > 0 && (
                                <div className="space-y-2">
                                    {files.map((file) => (
                                        <div
                                            key={file.id}
                                            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border"
                                        >
                                            <FileText className="h-4 w-4 text-muted-foreground" />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium truncate">{file.name}</p>
                                                <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                                            </div>
                                            <Badge variant="outline" className="text-xs">{file.source}</Badge>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7"
                                                onClick={() => handleRemoveFile(file.id)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </ScrollArea>

                <div className="flex justify-end gap-2 pt-4 border-t">
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                        Cancel
                    </Button>
                    <Button onClick={handleSubmit} disabled={!name.trim() || isSubmitting}>
                        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Changes"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

export default EditProjectModal;
