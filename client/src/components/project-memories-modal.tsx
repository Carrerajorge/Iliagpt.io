/**
 * Project Memories Modal
 * 
 * Displays and manages memories/context stored for a project.
 * Shows system prompt, extracted entities, and allows editing.
 */

import { useState } from "react";
import { Brain, FileText, MessageSquare, Trash2, Plus, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Project } from "@/hooks/use-projects";
import { usePlatformSettings } from "@/contexts/PlatformSettingsContext";
import { formatZonedDate, normalizeTimeZone } from "@/lib/platformDateTime";

interface Memory {
    id: string;
    type: "fact" | "preference" | "context";
    content: string;
    createdAt: Date;
}

interface ProjectMemoriesModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    project: Project | null;
    onUpdateProject: (projectId: string, updates: Partial<Project>) => void;
}

export function ProjectMemoriesModal({
    open,
    onOpenChange,
    project,
    onUpdateProject
}: ProjectMemoriesModalProps) {
    const [newMemory, setNewMemory] = useState("");
    const [memories, setMemories] = useState<Memory[]>([]);
    const [editingPrompt, setEditingPrompt] = useState(false);
    const [promptDraft, setPromptDraft] = useState("");
    const { settings: platformSettings } = usePlatformSettings();
    const platformTimeZone = normalizeTimeZone(platformSettings.timezone_default);
    const platformDateFormat = platformSettings.date_format;

    if (!project) return null;

    const handleAddMemory = () => {
        if (!newMemory.trim()) return;

        const memory: Memory = {
            id: `mem_${Date.now()}`,
            type: "fact",
            content: newMemory.trim(),
            createdAt: new Date()
        };
        setMemories([memory, ...memories]);
        setNewMemory("");
    };

    const handleDeleteMemory = (memoryId: string) => {
        setMemories(memories.filter(m => m.id !== memoryId));
    };

    const handleSavePrompt = () => {
        onUpdateProject(project.id, { systemPrompt: promptDraft });
        setEditingPrompt(false);
    };

    const startEditingPrompt = () => {
        setPromptDraft(project.systemPrompt || "");
        setEditingPrompt(true);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-hidden flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Brain className="h-5 w-5" />
                        Project Memories
                    </DialogTitle>
                    <DialogDescription>
                        View and manage context and memories for "{project.name}"
                    </DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="prompt" className="flex-1 flex flex-col overflow-hidden">
                    <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="prompt">System Prompt</TabsTrigger>
                        <TabsTrigger value="memories">Memories</TabsTrigger>
                        <TabsTrigger value="files">Files</TabsTrigger>
                    </TabsList>

                    <ScrollArea className="flex-1 mt-4">
                        {/* System Prompt Tab */}
                        <TabsContent value="prompt" className="m-0 space-y-4">
                            <Card>
                                <CardHeader className="pb-3">
                                    <CardTitle className="text-base flex items-center justify-between">
                                        <span>System Prompt</span>
                                        {!editingPrompt && (
                                            <Button variant="outline" size="sm" onClick={startEditingPrompt}>
                                                Edit
                                            </Button>
                                        )}
                                    </CardTitle>
                                    <CardDescription>
                                        Instructions that will be applied to all chats in this project
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    {editingPrompt ? (
                                        <div className="space-y-3">
                                            <Textarea
                                                value={promptDraft}
                                                onChange={(e) => setPromptDraft(e.target.value)}
                                                placeholder="Enter system prompt..."
                                                className="min-h-[120px]"
                                            />
                                            <div className="flex gap-2 justify-end">
                                                <Button variant="outline" size="sm" onClick={() => setEditingPrompt(false)}>
                                                    Cancel
                                                </Button>
                                                <Button size="sm" onClick={handleSavePrompt}>
                                                    Save
                                                </Button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="rounded-lg bg-muted/50 p-3 text-sm">
                                            {project.systemPrompt || (
                                                <span className="text-muted-foreground italic">No system prompt set</span>
                                            )}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </TabsContent>

                        {/* Memories Tab */}
                        <TabsContent value="memories" className="m-0 space-y-4">
                            <Card>
                                <CardHeader className="pb-3">
                                    <CardTitle className="text-base">Add Memory</CardTitle>
                                    <CardDescription>
                                        Add facts or context that the AI should remember
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="flex gap-2">
                                        <Input
                                            value={newMemory}
                                            onChange={(e) => setNewMemory(e.target.value)}
                                            placeholder="e.g., The user prefers formal responses"
                                            onKeyDown={(e) => e.key === "Enter" && handleAddMemory()}
                                        />
                                        <Button onClick={handleAddMemory} disabled={!newMemory.trim()}>
                                            <Plus className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>

                            {memories.length > 0 ? (
                                <div className="space-y-2">
                                    {memories.map((memory) => (
                                        <Card key={memory.id}>
                                            <CardContent className="flex items-start gap-3 p-3">
                                                <MessageSquare className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm">{memory.content}</p>
                                                    <p className="text-xs text-muted-foreground mt-1">
                                                        {formatZonedDate(memory.createdAt, { timeZone: platformTimeZone, dateFormat: platformDateFormat })}
                                                    </p>
                                                </div>
                                                <Badge variant="outline" className="text-xs">{memory.type}</Badge>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7"
                                                    onClick={() => handleDeleteMemory(memory.id)}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </CardContent>
                                        </Card>
                                    ))}
                                </div>
                            ) : (
                                <Card>
                                    <CardContent className="flex flex-col items-center justify-center py-8 text-center">
                                        <Brain className="h-10 w-10 text-muted-foreground/50 mb-3" />
                                        <p className="text-sm text-muted-foreground">No memories yet</p>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            Add facts and context for the AI to remember
                                        </p>
                                    </CardContent>
                                </Card>
                            )}
                        </TabsContent>

                        {/* Files Tab */}
                        <TabsContent value="files" className="m-0 space-y-4">
                            <Card>
                                <CardHeader className="pb-3">
                                    <CardTitle className="text-base">Attached Files</CardTitle>
                                    <CardDescription>
                                        Documents and files available in this project
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    {project.files.length > 0 ? (
                                        <div className="space-y-2">
                                            {project.files.map((file) => (
                                                <div
                                                    key={file.id}
                                                    className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/50"
                                                >
                                                    <FileText className="h-4 w-4 text-muted-foreground" />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-medium truncate">{file.name}</p>
                                                        <p className="text-xs text-muted-foreground">
                                                            {(file.size / 1024).toFixed(1)} KB
                                                        </p>
                                                    </div>
                                                    <Badge variant="outline" className="text-xs">{file.source}</Badge>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center py-6 text-center">
                                            <FileText className="h-8 w-8 text-muted-foreground/50 mb-2" />
                                            <p className="text-sm text-muted-foreground">No files attached</p>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </TabsContent>
                    </ScrollArea>
                </Tabs>

                <div className="flex justify-end pt-4 border-t">
                    <Button onClick={() => onOpenChange(false)}>Close</Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

export default ProjectMemoriesModal;
