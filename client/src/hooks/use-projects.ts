/**
 * Projects Hook
 * 
 * Manages project folders with full CRUD operations.
 * Persists to localStorage with optional server sync.
 */

import { useState, useEffect, useCallback } from "react";
import type { CreateProjectData, ProjectFile } from "@/components/create-project-modal";

export interface Project {
    id: string;
    name: string;
    color: string;
    backgroundImage: string | null;
    systemPrompt: string;
    files: ProjectFile[];
    chatIds: string[];
    createdAt: number;
    updatedAt: number;
}

const STORAGE_KEY = "iliagpt-projects";

export function useProjects() {
    const [projects, setProjects] = useState<Project[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Load projects from localStorage on mount
    useEffect(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved) as Project[];
                setProjects(parsed);
            }
        } catch (error) {
            console.error("[useProjects] Failed to load projects:", error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Persist to localStorage on change
    useEffect(() => {
        if (!isLoading) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
        }
    }, [projects, isLoading]);

    /**
     * Create a new project
     */
    const createProject = useCallback(async (data: CreateProjectData): Promise<Project> => {
        const now = Date.now();
        const newProject: Project = {
            id: `project_${now}_${Math.random().toString(36).slice(2, 8)}`,
            name: data.name,
            color: data.color,
            backgroundImage: data.backgroundImage,
            systemPrompt: data.systemPrompt,
            files: data.files,
            chatIds: [],
            createdAt: now,
            updatedAt: now
        };

        setProjects((prev) => [...prev, newProject]);
        console.log(`[useProjects] Created project: ${newProject.name}`);

        return newProject;
    }, []);

    /**
     * Update an existing project
     */
    const updateProject = useCallback((projectId: string, updates: Partial<Omit<Project, "id" | "createdAt">>) => {
        setProjects((prev) =>
            prev.map((p) =>
                p.id === projectId
                    ? { ...p, ...updates, updatedAt: Date.now() }
                    : p
            )
        );
    }, []);

    /**
     * Delete a project
     */
    const deleteProject = useCallback((projectId: string) => {
        setProjects((prev) => prev.filter((p) => p.id !== projectId));
    }, []);

    /**
     * Add a chat to a project
     */
    const addChatToProject = useCallback((chatId: string, projectId: string) => {
        setProjects((prev) =>
            prev.map((p) => {
                if (p.id === projectId) {
                    if (!p.chatIds.includes(chatId)) {
                        return { ...p, chatIds: [...p.chatIds, chatId], updatedAt: Date.now() };
                    }
                }
                // Remove from other projects
                if (p.chatIds.includes(chatId)) {
                    return { ...p, chatIds: p.chatIds.filter((id) => id !== chatId), updatedAt: Date.now() };
                }
                return p;
            })
        );
    }, []);

    /**
     * Remove a chat from its project
     */
    const removeChatFromProject = useCallback((chatId: string) => {
        setProjects((prev) =>
            prev.map((p) => ({
                ...p,
                chatIds: p.chatIds.filter((id) => id !== chatId),
                updatedAt: p.chatIds.includes(chatId) ? Date.now() : p.updatedAt
            }))
        );
    }, []);

    /**
     * Get the project containing a specific chat
     */
    const getProjectForChat = useCallback(
        (chatId: string): Project | null => {
            return projects.find((p) => p.chatIds.includes(chatId)) || null;
        },
        [projects]
    );

    /**
     * Get project by ID
     */
    const getProject = useCallback(
        (projectId: string): Project | null => {
            return projects.find((p) => p.id === projectId) || null;
        },
        [projects]
    );

    /**
     * Rename a project
     */
    const renameProject = useCallback((projectId: string, newName: string) => {
        updateProject(projectId, { name: newName });
    }, [updateProject]);

    /**
     * Add files to a project
     */
    const addFilesToProject = useCallback((projectId: string, files: ProjectFile[]) => {
        setProjects((prev) =>
            prev.map((p) =>
                p.id === projectId
                    ? {
                        ...p,
                        files: [...p.files, ...files.filter(f => !p.files.some(pf => pf.id === f.id))],
                        updatedAt: Date.now()
                    }
                    : p
            )
        );
    }, []);

    /**
     * Remove a file from a project
     */
    const removeFileFromProject = useCallback((projectId: string, fileId: string) => {
        setProjects((prev) =>
            prev.map((p) =>
                p.id === projectId
                    ? {
                        ...p,
                        files: p.files.filter((f) => f.id !== fileId),
                        updatedAt: Date.now()
                    }
                    : p
            )
        );
    }, []);

    return {
        projects,
        isLoading,
        createProject,
        updateProject,
        deleteProject,
        addChatToProject,
        removeChatFromProject,
        getProjectForChat,
        getProject,
        renameProject,
        addFilesToProject,
        removeFileFromProject
    };
}

export default useProjects;
