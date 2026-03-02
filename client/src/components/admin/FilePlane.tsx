import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2, FolderOpen, File, FileText, Shield, Search, RefreshCw,
  Eye, ShieldAlert, HardDrive, ArrowRight, Clock
} from "lucide-react";

interface FileEntry {
  name: string;
  isDirectory: boolean;
  size?: number;
  modified?: string;
}

interface AuditEntry {
  id: string;
  timestamp: number;
  userId: string;
  operation: string;
  filePath: string;
  result: string;
  details?: string;
  bytesTransferred?: number;
}

interface GatewayStats {
  totalReads: number;
  totalWrites: number;
  totalDeletes: number;
  totalSearches: number;
  bytesRead: number;
  bytesWritten: number;
  blockedAttempts: number;
  pathTraversalBlocks: number;
}

const resultColors: Record<string, string> = {
  success: "bg-green-500/20 text-green-400",
  denied: "bg-red-500/20 text-red-400",
  error: "bg-yellow-500/20 text-yellow-400",
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export default function FilePlane() {
  const [currentDir, setCurrentDir] = useState(".");
  const [searchQuery, setSearchQuery] = useState("");
  const [previewPath, setPreviewPath] = useState<string | null>(null);

  const { data: filesData, isLoading: filesLoading, refetch: refetchFiles } = useQuery({
    queryKey: ["/api/files/list", currentDir],
    queryFn: async () => {
      const res = await fetch(`/api/files/list?dir=${encodeURIComponent(currentDir)}`);
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ["/api/files/stats"],
    refetchInterval: 15000,
  });

  const { data: auditData } = useQuery({
    queryKey: ["/api/files/audit"],
    refetchInterval: 15000,
  });

  const { data: previewData, isLoading: previewLoading } = useQuery({
    queryKey: ["/api/files/read", previewPath],
    queryFn: async () => {
      if (!previewPath) return null;
      const res = await fetch("/api/files/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath: previewPath, parse: true }),
      });
      return res.json();
    },
    enabled: !!previewPath,
  });

  const { data: searchData, isLoading: searchLoading } = useQuery({
    queryKey: ["/api/files/search", searchQuery],
    queryFn: async () => {
      if (!searchQuery.trim()) return null;
      const res = await fetch("/api/files/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery, workspace: "project" }),
      });
      return res.json();
    },
    enabled: searchQuery.trim().length > 2,
  });

  const files: FileEntry[] = (filesData as any)?.files || [];
  const stats: GatewayStats = (statsData as any) || {
    totalReads: 0, totalWrites: 0, totalDeletes: 0, totalSearches: 0,
    bytesRead: 0, bytesWritten: 0, blockedAttempts: 0, pathTraversalBlocks: 0,
  };
  const auditEntries: AuditEntry[] = (auditData as any)?.entries || [];
  const searchResults: any[] = (searchData as any)?.results || [];

  if (statsLoading) {
    return (
      <div className="flex items-center justify-center p-12" data-testid="files-loading">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="file-plane-dashboard">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <FolderOpen className="h-6 w-6" />
            File Plane
          </h2>
          <p className="text-muted-foreground text-sm mt-1">Secure file gateway, multi-format parsing, audit logging</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetchFiles()} data-testid="btn-refresh-files">
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Eye className="h-4 w-4 text-blue-400" />
              <span className="text-xs text-muted-foreground">Reads</span>
            </div>
            <div className="text-2xl font-bold" data-testid="stat-reads">{stats.totalReads}</div>
            <div className="text-xs text-muted-foreground">{formatBytes(stats.bytesRead)} transferred</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <FileText className="h-4 w-4 text-green-400" />
              <span className="text-xs text-muted-foreground">Writes</span>
            </div>
            <div className="text-2xl font-bold" data-testid="stat-writes">{stats.totalWrites}</div>
            <div className="text-xs text-muted-foreground">{formatBytes(stats.bytesWritten)} transferred</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Search className="h-4 w-4 text-purple-400" />
              <span className="text-xs text-muted-foreground">Searches</span>
            </div>
            <div className="text-2xl font-bold" data-testid="stat-searches">{stats.totalSearches}</div>
            <div className="text-xs text-muted-foreground">{stats.totalDeletes} deletes</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <ShieldAlert className="h-4 w-4 text-red-400" />
              <span className="text-xs text-muted-foreground">Blocked</span>
            </div>
            <div className="text-2xl font-bold text-red-400" data-testid="stat-blocked">{stats.blockedAttempts}</div>
            <div className="text-xs text-muted-foreground">{stats.pathTraversalBlocks} path traversal</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FolderOpen className="h-4 w-4" />
              Workspace Browser
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2 mb-3">
              <Input
                value={currentDir}
                onChange={(e) => setCurrentDir(e.target.value)}
                placeholder="Directory path..."
                className="text-xs font-mono"
                data-testid="input-dir"
              />
              <Button size="sm" onClick={() => refetchFiles()} data-testid="btn-browse">
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>

            {filesLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : files.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <FolderOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No files found in this directory</p>
              </div>
            ) : (
              <div className="space-y-1 max-h-80 overflow-y-auto">
                {files.map((file, idx) => (
                  <div
                    key={file.name || idx}
                    className="flex items-center justify-between p-2 rounded border hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => {
                      if (file.isDirectory) {
                        setCurrentDir(currentDir === "." ? file.name : `${currentDir}/${file.name}`);
                      } else {
                        setPreviewPath(currentDir === "." ? file.name : `${currentDir}/${file.name}`);
                      }
                    }}
                    data-testid={`file-entry-${file.name}`}
                  >
                    <div className="flex items-center gap-2">
                      {file.isDirectory ? (
                        <FolderOpen className="h-3.5 w-3.5 text-yellow-400" />
                      ) : (
                        <File className="h-3.5 w-3.5 text-blue-400" />
                      )}
                      <span className="text-xs font-mono">{file.name}</span>
                    </div>
                    {file.size !== undefined && (
                      <span className="text-[10px] text-muted-foreground">{formatBytes(file.size)}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              File Preview
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!previewPath ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>Click a file to preview its contents</p>
              </div>
            ) : previewLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : previewData?.error ? (
              <div className="text-center py-8 text-red-400 text-sm">
                <ShieldAlert className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>{previewData.error}</p>
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono text-muted-foreground" data-testid="preview-path">{previewPath}</span>
                  <Button variant="ghost" size="sm" onClick={() => setPreviewPath(null)} className="h-6 px-2 text-[10px]">
                    Close
                  </Button>
                </div>
                <pre className="bg-muted/50 rounded p-3 text-xs font-mono overflow-auto max-h-64 whitespace-pre-wrap" data-testid="preview-content">
                  {previewData?.content?.content || previewData?.parsed?.content || JSON.stringify(previewData, null, 2).slice(0, 5000)}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="h-4 w-4" />
            File Search
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3 mb-3">
            <Input
              placeholder="Search file contents..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              data-testid="input-search"
            />
          </div>
          {searchLoading && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}
          {searchResults.length > 0 && (
            <div className="space-y-1">
              {searchResults.slice(0, 20).map((result: any, idx: number) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-2 rounded border hover:bg-muted/30 cursor-pointer"
                  onClick={() => setPreviewPath(result.filePath || result.path)}
                  data-testid={`search-result-${idx}`}
                >
                  <div className="flex items-center gap-2">
                    <File className="h-3 w-3 text-blue-400" />
                    <span className="text-xs font-mono">{result.filePath || result.path}</span>
                  </div>
                  {result.lineNumber && (
                    <span className="text-[10px] text-muted-foreground">Line {result.lineNumber}</span>
                  )}
                </div>
              ))}
            </div>
          )}
          {searchQuery.trim().length > 2 && !searchLoading && searchResults.length === 0 && (
            <div className="text-center py-4 text-muted-foreground text-sm">No matches found</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4" />
            File Access Audit Log
          </CardTitle>
        </CardHeader>
        <CardContent>
          {auditEntries.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <HardDrive className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No file access events recorded yet</p>
            </div>
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {auditEntries.slice(0, 50).map((entry) => (
                <div key={entry.id} className="flex items-center justify-between p-2 rounded border" data-testid={`audit-${entry.id}`}>
                  <div className="flex items-center gap-2">
                    <Badge className={resultColors[entry.result] || "bg-muted text-muted-foreground"}>
                      {entry.result}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{entry.operation}</span>
                    <span className="text-xs font-mono">{entry.filePath.length > 40 ? "..." + entry.filePath.slice(-37) : entry.filePath}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {entry.bytesTransferred !== undefined && entry.bytesTransferred > 0 && (
                      <span className="text-[10px] text-muted-foreground">{formatBytes(entry.bytesTransferred)}</span>
                    )}
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Clock className="h-2.5 w-2.5" />
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
