import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./use-auth";

export interface PinnedGpt {
  id: string;
  userId: string;
  gptId: string;
  displayOrder: number;
  pinnedAt: string;
  gpt: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    avatar: string | null;
  };
}

export function usePinnedGpts() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: pinnedGpts = [], isLoading, error } = useQuery<PinnedGpt[]>({
    queryKey: ["/api/users", user?.id, "sidebar-gpts"],
    queryFn: async () => {
      if (!user?.id) return [];
      const res = await fetch(`/api/users/${user.id}/sidebar-gpts`);
      if (!res.ok) {
        console.warn("[usePinnedGpts] Fallback: unable to fetch pinned GPTs", res.status);
        return [];
      }
      return res.json();
    },
    enabled: !!user?.id,
  });

  const pinMutation = useMutation({
    mutationFn: async ({ gptId, displayOrder }: { gptId: string; displayOrder?: number }) => {
      if (!user?.id) throw new Error("User not authenticated");
      const res = await fetch(`/api/users/${user.id}/sidebar-gpts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gptId, displayOrder }),
      });
      if (!res.ok) throw new Error("Failed to pin GPT");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", user?.id, "sidebar-gpts"] });
    },
  });

  const unpinMutation = useMutation({
    mutationFn: async (gptId: string) => {
      if (!user?.id) throw new Error("User not authenticated");
      const res = await fetch(`/api/users/${user.id}/sidebar-gpts/${gptId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to unpin GPT");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", user?.id, "sidebar-gpts"] });
    },
  });

  const isPinned = (gptId: string) => {
    return pinnedGpts.some((p) => p.gptId === gptId);
  };

  const pinGpt = (gptId: string, displayOrder?: number) => {
    return pinMutation.mutateAsync({ gptId, displayOrder });
  };

  const unpinGpt = (gptId: string) => {
    return unpinMutation.mutateAsync(gptId);
  };

  const togglePin = async (gptId: string) => {
    if (isPinned(gptId)) {
      await unpinGpt(gptId);
    } else {
      await pinGpt(gptId);
    }
  };

  return {
    pinnedGpts,
    isLoading,
    error,
    isPinned,
    pinGpt,
    unpinGpt,
    togglePin,
    isPinning: pinMutation.isPending,
    isUnpinning: unpinMutation.isPending,
  };
}
