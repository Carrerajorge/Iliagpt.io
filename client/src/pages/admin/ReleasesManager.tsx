import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Plus, Trash2, Edit2, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

type AppRelease = {
    id: string;
    platform: string;
    version: string;
    size: string;
    requirements: string;
    available: string;
    fileName: string;
    downloadUrl: string;
    note: string | null;
    isActive: string;
    createdAt: string;
};

export default function ReleasesManager() {
    const { toast } = useToast();
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState<Partial<AppRelease>>({});

    const { data: releases, isLoading } = useQuery<AppRelease[]>({
        queryKey: ["/api/admin/releases"],
    });

    const createMutation = useMutation({
        mutationFn: async (data: Partial<AppRelease>) => {
            const res = await apiRequest("POST", "/api/admin/releases", data);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/admin/releases"] });
            setFormData({});
            toast({ title: "Release created successfully." });
        },
    });

    const updateMutation = useMutation({
        mutationFn: async ({ id, data }: { id: string; data: Partial<AppRelease> }) => {
            const res = await apiRequest("PATCH", `/api/admin/releases/${id}`, data);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/admin/releases"] });
            setEditingId(null);
            setFormData({});
            toast({ title: "Release updated." });
        },
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            await apiRequest("DELETE", `/api/admin/releases/${id}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/admin/releases"] });
            toast({ title: "Release deleted." });
        },
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (editingId) {
            updateMutation.mutate({ id: editingId, data: formData });
        } else {
            createMutation.mutate(formData as Partial<AppRelease>);
        }
    };

    const handleEdit = (release: AppRelease) => {
        setEditingId(release.id);
        setFormData(release);
    };

    if (isLoading) {
        return (
            <div className="flex h-96 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-cyan-500" />
            </div>
        );
    }

    return (
        <div className="space-y-6 max-w-5xl mx-auto py-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight text-white">Software Releases</h2>
                    <p className="text-zinc-400">Configure desktop app downloads for macOS, Windows, and Linux.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-1 border border-zinc-800 bg-zinc-950 p-6 rounded-xl h-fit">
                    <h3 className="text-lg font-medium text-white mb-4">
                        {editingId ? "Edit Release" : "New Release"}
                    </h3>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="text-xs font-medium text-zinc-400">Platform</label>
                            <Input
                                value={formData.platform || ""}
                                onChange={(e) => setFormData({ ...formData, platform: e.target.value })}
                                placeholder="macOS, Windows, or Linux"
                                className="bg-zinc-900 border-zinc-800"
                                required
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-zinc-400">Version</label>
                            <Input
                                value={formData.version || ""}
                                onChange={(e) => setFormData({ ...formData, version: e.target.value })}
                                placeholder="v2.1.0"
                                className="bg-zinc-900 border-zinc-800"
                                required
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs font-medium text-zinc-400">Size</label>
                                <Input
                                    value={formData.size || ""}
                                    onChange={(e) => setFormData({ ...formData, size: e.target.value })}
                                    placeholder="~98 MB"
                                    className="bg-zinc-900 border-zinc-800"
                                    required
                                />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-zinc-400">Status Availability</label>
                                <select
                                    value={formData.available || "false"}
                                    onChange={(e) => setFormData({ ...formData, available: e.target.value })}
                                    className="w-full h-10 px-3 rounded-md bg-zinc-900 border border-zinc-800 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500"
                                >
                                    <option value="true">Available</option>
                                    <option value="false">Próximamente</option>
                                </select>
                            </div>
                        </div>
                        <div>
                            <label className="text-xs font-medium text-zinc-400">Requirements</label>
                            <Input
                                value={formData.requirements || ""}
                                onChange={(e) => setFormData({ ...formData, requirements: e.target.value })}
                                placeholder="macOS 11+"
                                className="bg-zinc-900 border-zinc-800"
                                required
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-zinc-400">File Name</label>
                            <Input
                                value={formData.fileName || ""}
                                onChange={(e) => setFormData({ ...formData, fileName: e.target.value })}
                                placeholder="iliagpt-2.1.0-arm64.dmg"
                                className="bg-zinc-900 border-zinc-800"
                                required
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-zinc-400">Download URL (GitHub Release or S3)</label>
                            <Input
                                value={formData.downloadUrl || ""}
                                onChange={(e) => setFormData({ ...formData, downloadUrl: e.target.value })}
                                placeholder="https://github.com/.../iliagpt-2.1.0-arm64.dmg"
                                className="bg-zinc-900 border-zinc-800"
                                required
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-zinc-400">Note (Optional)</label>
                            <Input
                                value={formData.note || ""}
                                onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                                placeholder="Apple Silicon M1/M2/M3"
                                className="bg-zinc-900 border-zinc-800"
                            />
                        </div>
                        <div className="flex items-center space-x-2 pt-2">
                            <Checkbox
                                checked={formData.isActive !== "false"}
                                onCheckedChange={(c) => setFormData({ ...formData, isActive: c ? "true" : "false" })}
                                id="active"
                            />
                            <label htmlFor="active" className="text-sm text-zinc-300">
                                Is Active (Visible on Public Page)
                            </label>
                        </div>

                        <div className="flex gap-2 pt-4">
                            <Button type="submit" className="w-full bg-cyan-600 hover:bg-cyan-500">
                                {editingId ? "Update" : "Create"} Release
                            </Button>
                            {editingId && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="w-full border-zinc-700 hover:bg-zinc-800"
                                    onClick={() => { setEditingId(null); setFormData({}); }}
                                >
                                    Cancel
                                </Button>
                            )}
                        </div>
                    </form>
                </div>

                <div className="lg:col-span-2 space-y-4">
                    {releases?.length === 0 ? (
                        <div className="border border-zinc-800 bg-zinc-950 p-12 rounded-xl text-center text-zinc-500">
                            <Download className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p>No software releases found. Add your first binary to publish it to users.</p>
                        </div>
                    ) : (
                        releases?.map((release) => (
                            <div key={release.id} className="border border-zinc-800 bg-zinc-950 p-5 rounded-xl flex items-center justify-between">
                                <div>
                                    <div className="flex items-center gap-3 mb-1">
                                        <span className="font-semibold text-zinc-100">{release.platform}</span>
                                        <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300">
                                            {release.version}
                                        </span>
                                        {release.isActive === "true" ? (
                                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950/50 text-emerald-400 border border-emerald-800/50">
                                                Active
                                            </span>
                                        ) : (
                                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-950/50 text-red-400 border border-red-800/50">
                                                Inactive
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-xs text-zinc-400 mb-2">
                                        {release.fileName} • {release.size}
                                    </div>
                                    <div className="text-xs text-zinc-500 truncate max-w-sm">
                                        {release.downloadUrl}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="hover:bg-zinc-800 text-zinc-400 hover:text-white"
                                        onClick={() => handleEdit(release)}
                                    >
                                        <Edit2 className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="hover:bg-red-950/50 text-zinc-400 hover:text-red-400"
                                        onClick={() => {
                                            if (confirm("Are you sure you want to delete this release history from the DB?")) {
                                                deleteMutation.mutate(release.id);
                                            }
                                        }}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
