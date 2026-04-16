/**
 * Long-Term Memories Management Page
 *
 * View, search, and delete long-term memories extracted from conversations.
 * Uses the /api/memories endpoints backed by the LongTermMemoryService.
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/apiClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Brain,
  Search,
  Trash2,
  Clock,
  ShieldCheck,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MemoryFact {
  id: string;
  userId: string;
  fact: string;
  category: "preference" | "personal" | "work" | "knowledge" | "instruction";
  importance: number;
  mentionCount: number;
  createdAt: string;
  updatedAt: string;
}

interface MemoriesResponse {
  memories: MemoryFact[];
  count: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORIES = [
  "all",
  "preference",
  "personal",
  "work",
  "knowledge",
  "instruction",
] as const;

type CategoryFilter = (typeof CATEGORIES)[number];

const CATEGORY_COLORS: Record<string, string> = {
  preference: "bg-blue-500/10 text-blue-600 border-blue-500/20 dark:text-blue-400",
  personal: "bg-purple-500/10 text-purple-600 border-purple-500/20 dark:text-purple-400",
  work: "bg-green-500/10 text-green-600 border-green-500/20 dark:text-green-400",
  knowledge: "bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400",
  instruction: "bg-rose-500/10 text-rose-600 border-rose-500/20 dark:text-rose-400",
};

const CATEGORY_LABELS: Record<string, string> = {
  all: "All",
  preference: "Preference",
  personal: "Personal",
  work: "Work",
  knowledge: "Knowledge",
  instruction: "Instruction",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function confidenceLabel(importance: number): { text: string; className: string } {
  if (importance >= 0.7) return { text: "High", className: "text-green-600 dark:text-green-400" };
  if (importance >= 0.4) return { text: "Medium", className: "text-amber-600 dark:text-amber-400" };
  return { text: "Low", className: "text-muted-foreground" };
}

// ---------------------------------------------------------------------------
// Skeleton loader
// ---------------------------------------------------------------------------

function MemoryCardSkeleton() {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-4 w-14" />
        </div>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <div className="flex items-center gap-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MemoriesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // ---- Data fetching ----

  const {
    data,
    isLoading,
    isError,
  } = useQuery<MemoriesResponse>({
    queryKey: ["memories"],
    queryFn: async () => {
      const res = await apiFetch("/api/memories?limit=100");
      if (!res.ok) throw new Error("Failed to fetch memories");
      return res.json();
    },
    enabled: !!user,
  });

  const memories = data?.memories ?? [];

  // ---- Delete mutation ----

  const deleteMutation = useMutation({
    mutationFn: async (memoryId: string) => {
      const res = await apiFetch(`/api/memories/${memoryId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete memory");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      toast({ title: "Memory deleted", description: "The memory has been removed." });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Could not delete the memory. Please try again.",
        variant: "destructive",
      });
    },
  });

  // ---- Filtering ----

  const filteredMemories = useMemo(() => {
    let result = memories;

    if (categoryFilter !== "all") {
      result = result.filter((m) => m.category === categoryFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((m) => m.fact.toLowerCase().includes(q));
    }

    return result;
  }, [memories, categoryFilter, searchQuery]);

  // ---- Auth guard ----

  if (!user) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="p-12 text-center">
            <Brain className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">Sign in to view your memories</h2>
            <p className="text-muted-foreground">
              Memories allow Ilia to personalize your experience across conversations.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Brain className="h-8 w-8 text-primary" />
          Long-Term Memories
        </h1>
        <p className="text-muted-foreground mt-1">
          Facts and preferences Ilia has learned about you over time.
        </p>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search memories..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Category filters */}
      <div className="flex flex-wrap gap-2 mb-6">
        {CATEGORIES.map((cat) => (
          <Button
            key={cat}
            variant={categoryFilter === cat ? "default" : "outline"}
            size="sm"
            onClick={() => setCategoryFilter(cat)}
          >
            {CATEGORY_LABELS[cat]}
            {cat !== "all" && (
              <Badge variant="secondary" className="ml-1.5 text-xs">
                {memories.filter((m) => m.category === cat).length}
              </Badge>
            )}
          </Button>
        ))}
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <MemoryCardSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Error state */}
      {isError && !isLoading && (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-destructive font-medium">Failed to load memories.</p>
            <p className="text-sm text-muted-foreground mt-1">Please try refreshing the page.</p>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!isLoading && !isError && filteredMemories.length === 0 && (
        <Card>
          <CardContent className="p-12 text-center">
            <Brain className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
            <h3 className="text-lg font-semibold mb-1">No memories found</h3>
            <p className="text-muted-foreground text-sm">
              {searchQuery || categoryFilter !== "all"
                ? "Try adjusting your search or filter."
                : "Ilia will learn about you as you chat. Memories will appear here automatically."}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Memory cards */}
      {!isLoading && !isError && filteredMemories.length > 0 && (
        <div className="space-y-3">
          {filteredMemories.map((memory) => {
            const confidence = confidenceLabel(memory.importance);
            return (
              <Card key={memory.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {/* Badges row */}
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <Badge
                          variant="outline"
                          className={`capitalize ${CATEGORY_COLORS[memory.category] ?? ""}`}
                        >
                          {memory.category}
                        </Badge>
                        <span className={`inline-flex items-center gap-1 text-xs font-medium ${confidence.className}`}>
                          <ShieldCheck className="h-3 w-3" />
                          {confidence.text}
                        </span>
                      </div>

                      {/* Fact text */}
                      <p className="text-sm leading-relaxed">{memory.fact}</p>

                      {/* Meta row */}
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDate(memory.createdAt)}
                        </span>
                        {memory.mentionCount > 1 && (
                          <span>Mentioned {memory.mentionCount} times</span>
                        )}
                      </div>
                    </div>

                    {/* Delete button */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => deleteMutation.mutate(memory.id)}
                      disabled={deleteMutation.isPending}
                      aria-label={`Delete memory: ${memory.fact.slice(0, 40)}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
