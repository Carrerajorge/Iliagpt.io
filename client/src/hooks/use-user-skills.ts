import { useCallback, useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/apiClient";

export interface UserSkill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  category: "documents" | "data" | "integrations" | "custom";
  enabled: boolean;
  builtIn: false;
  features: string[];
  triggers?: string[];
  createdAt: string;
  updatedAt: string;
}

type UserSkillUpsert = Omit<UserSkill, "id" | "createdAt" | "updatedAt" | "builtIn">;
type UserSkillPatch = Partial<UserSkillUpsert>;
type EnsureSkillParams = { name?: string; prompt: string };

const STORAGE_KEY = "sira-user-skills";
const QUERY_KEY = ["user-skills"];

function safeJsonParse<T>(text: string | null): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function coerceSkill(raw: any): UserSkill | null {
  if (!raw || typeof raw !== "object") return null;

  const id = typeof raw.id === "string" ? raw.id : "";
  const name = typeof raw.name === "string" ? raw.name : "";
  const description = typeof raw.description === "string" ? raw.description : "";
  const instructions = typeof raw.instructions === "string" ? raw.instructions : "";
  const category = raw.category === "documents" || raw.category === "data" || raw.category === "integrations" || raw.category === "custom"
    ? raw.category
    : "custom";
  const enabled = typeof raw.enabled === "boolean" ? raw.enabled : true;
  const features = Array.isArray(raw.features) ? raw.features.filter((f: any) => typeof f === "string") : [];
  const triggers = Array.isArray(raw.triggers) ? raw.triggers.filter((t: any) => typeof t === "string") : undefined;
  const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString();
  const updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString();

  if (!id || !name || !instructions) return null;

  return {
    id,
    name,
    description,
    instructions,
    category,
    enabled,
    builtIn: false,
    features,
    triggers,
    createdAt,
    updatedAt,
  };
}

function loadLocalSkills(): UserSkill[] {
  const parsed = safeJsonParse<any[]>(localStorage.getItem(STORAGE_KEY));
  if (!parsed || !Array.isArray(parsed)) return [];
  return parsed.map(coerceSkill).filter(Boolean) as UserSkill[];
}

function saveLocalSkills(skills: UserSkill[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(skills));
  } catch {
    // Ignore write failures (private mode, quota, etc.)
  }
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

async function fetchServerSkills(): Promise<UserSkill[]> {
  const res = await apiFetch("/api/skills", { method: "GET" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || `Error ${res.status}`);
  }
  const data = await res.json().catch(() => ({}));
  const skills = Array.isArray(data?.skills) ? data.skills : [];
  const coerced = skills.map(coerceSkill).filter(Boolean) as UserSkill[];
  saveLocalSkills(coerced);
  return coerced;
}

// runtime skills fetch removed


async function importSkillsToServer(skills: UserSkillUpsert[]): Promise<void> {
  const res = await apiFetch("/api/skills/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skills }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || `Error ${res.status}`);
  }
}

export function useUserSkills() {
  const queryClient = useQueryClient();
  const localSnapshot = useMemo(() => loadLocalSkills(), []);
  const didAttemptMigration = useRef(false);

  const query = useQuery<UserSkill[]>({
    queryKey: QUERY_KEY,
    queryFn: fetchServerSkills,
    initialData: localSnapshot,
    // Treat localStorage as a fast placeholder; always refetch on mount for server truth.
    initialDataUpdatedAt: 0,
    staleTime: 1000 * 30,
    refetchOnWindowFocus: true,
  });

  // runtime query removed

  // One-time migration: if there are skills in localStorage that are missing on the server, import them.
  useEffect(() => {
    if (didAttemptMigration.current) return;
    if (!query.isFetchedAfterMount) return;
    if (!query.isSuccess) return;
    didAttemptMigration.current = true;

    const serverSkills = query.data || [];
    if (!localSnapshot.length) return;

    const serverNames = new Set(serverSkills.map((s) => normalizeName(s.name)));
    const missing = localSnapshot.filter((s) => !serverNames.has(normalizeName(s.name)));
    if (!missing.length) return;

    const payload: UserSkillUpsert[] = missing.map((s) => ({
      name: s.name,
      description: s.description,
      instructions: s.instructions,
      category: s.category,
      enabled: s.enabled,
      features: s.features,
      triggers: s.triggers || [],
    }));

    importSkillsToServer(payload)
      .then(() => queryClient.invalidateQueries({ queryKey: QUERY_KEY }))
      .catch((e) => console.warn("[useUserSkills] Migration failed:", e?.message || e));
  }, [localSnapshot, query.data, query.isFetchedAfterMount, query.isSuccess, queryClient]);

  const createMutation = useMutation({
    mutationFn: async (skill: UserSkillUpsert): Promise<UserSkill> => {
      const res = await apiFetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(skill),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `Error ${res.status}`);
      }
      const data = await res.json().catch(() => ({}));
      const created = coerceSkill(data?.skill);
      if (!created) throw new Error("Respuesta inválida del servidor");
      return created;
    },
    onSuccess: (created) => {
      queryClient.setQueryData<UserSkill[]>(QUERY_KEY, (prev) => {
        const list = Array.isArray(prev) ? prev : [];
        const next = [created, ...list.filter((s) => s.id !== created.id)];
        saveLocalSkills(next);
        return next;
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (params: { id: string; patch: UserSkillPatch }): Promise<UserSkill> => {
      const res = await apiFetch(`/api/skills/${params.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params.patch),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `Error ${res.status}`);
      }
      const data = await res.json().catch(() => ({}));
      const updated = coerceSkill(data?.skill);
      if (!updated) throw new Error("Respuesta inválida del servidor");
      return updated;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<UserSkill[]>(QUERY_KEY, (prev) => {
        const list = Array.isArray(prev) ? prev : [];
        const next = list.map((s) => (s.id === updated.id ? updated : s));
        saveLocalSkills(next);
        return next;
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const res = await apiFetch(`/api/skills/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `Error ${res.status}`);
      }
    },
    onSuccess: (_data, id) => {
      queryClient.setQueryData<UserSkill[]>(QUERY_KEY, (prev) => {
        const list = Array.isArray(prev) ? prev : [];
        const next = list.filter((s) => s.id !== id);
        saveLocalSkills(next);
        return next;
      });
    },
  });

  const createSkill = useCallback(async (skill: UserSkillUpsert) => {
    return await createMutation.mutateAsync(skill);
  }, [createMutation]);

  const updateSkill = useCallback(async (id: string, patch: UserSkillPatch) => {
    await updateMutation.mutateAsync({ id, patch });
  }, [updateMutation]);

  const ensureMutation = useMutation({
    mutationFn: async (params: EnsureSkillParams): Promise<UserSkill> => {
      const res = await apiFetch("/api/skills/ensure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `Error ${res.status}`);
      }
      const data = await res.json().catch(() => ({}));
      const ensured = coerceSkill(data?.skill);
      if (!ensured) throw new Error("Respuesta inválida del servidor");
      return ensured;
    },
    onSuccess: (ensured) => {
      queryClient.setQueryData<UserSkill[]>(QUERY_KEY, (prev) => {
        const list = Array.isArray(prev) ? prev : [];
        const next = [ensured, ...list.filter((s) => s.id !== ensured.id)];
        saveLocalSkills(next);
        return next;
      });
    },
  });

  const ensureSkill = useCallback(async (params: EnsureSkillParams) => {
    return await ensureMutation.mutateAsync(params);
  }, [ensureMutation]);

  const deleteSkill = useCallback(async (id: string) => {
    await deleteMutation.mutateAsync(id);
  }, [deleteMutation]);

  const toggleSkill = useCallback(async (id: string) => {
    const list = queryClient.getQueryData<UserSkill[]>(QUERY_KEY) || [];
    const skill = list.find((s) => s.id === id);
    if (!skill) return;
    await updateSkill(id, { enabled: !skill.enabled });
  }, [queryClient, updateSkill]);

  const duplicateSkill = useCallback(async (id: string) => {
    const list = queryClient.getQueryData<UserSkill[]>(QUERY_KEY) || [];
    const skill = list.find((s) => s.id === id);
    if (!skill) return null;

    const baseName = `${skill.name} (copia)`;
    const used = new Set(list.map((s) => normalizeName(s.name)));
    let name = baseName;
    let i = 2;
    while (used.has(normalizeName(name))) {
      name = `${baseName} ${i}`;
      i += 1;
    }

    return await createSkill({
      name,
      description: skill.description,
      instructions: skill.instructions,
      category: skill.category,
      enabled: skill.enabled,
      features: skill.features,
      triggers: skill.triggers || [],
    });
  }, [createSkill, queryClient]);

  return {
    skills: query.data || [],
    isLoading: query.isLoading,
    createSkill,
    ensureSkill,
    updateSkill,
    deleteSkill,
    toggleSkill,
    duplicateSkill,
  };
}
