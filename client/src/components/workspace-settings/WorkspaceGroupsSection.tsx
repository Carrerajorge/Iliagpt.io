import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { apiFetch } from "@/lib/apiClient";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { ChevronDown, Loader2, MoreHorizontal, Plus, Trash2, UserPlus, X } from "lucide-react";

type WorkspaceGroupSummary = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
  directSharedChatsCount: number;
  groupSharedChatsCount: number;
  sharedChatsCount: number;
};

type WorkspaceGroupMember = {
  userId: string;
  email: string | null;
  fullName: string | null;
  username: string | null;
  role: string | null;
  addedAt: string;
};

type MembersState = {
  loading: boolean;
  error: string | null;
  members: WorkspaceGroupMember[];
  addEmail: string;
  saving: boolean;
};

function emptyMembersState(): MembersState {
  return { loading: false, error: null, members: [], addEmail: "", saving: false };
}

function normalizeEmail(raw: string): string {
  return String(raw || "").trim().toLowerCase();
}

function splitEmails(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[,\n\s]+/g)
        .map((s) => normalizeEmail(s))
        .filter(Boolean)
    )
  );
}

export function WorkspaceGroupsSection({ canManage }: { canManage: boolean }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<WorkspaceGroupSummary[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");

  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [membersByGroupId, setMembersByGroupId] = useState<Record<string, MembersState>>({});

  const totalMembersAcrossGroups = useMemo(() => groups.reduce((sum, g) => sum + (g.memberCount || 0), 0), [groups]);

  const loadGroups = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/workspace/groups");
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || "No se pudieron cargar los grupos");
      }
      setGroups(Array.isArray(data?.groups) ? data.groups : []);
    } catch (e: any) {
      setError(e?.message || "No se pudieron cargar los grupos");
    } finally {
      setLoading(false);
    }
  };

  const loadMembers = async (groupId: string) => {
    setMembersByGroupId((prev) => ({
      ...prev,
      [groupId]: { ...(prev[groupId] || emptyMembersState()), loading: true, error: null },
    }));
    try {
      const res = await apiFetch(`/api/workspace/groups/${groupId}/members`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "No se pudieron cargar los miembros");

      const members = Array.isArray(data?.members) ? (data.members as WorkspaceGroupMember[]) : [];
      setMembersByGroupId((prev) => ({
        ...prev,
        [groupId]: { ...(prev[groupId] || emptyMembersState()), loading: false, error: null, members },
      }));
    } catch (e: any) {
      setMembersByGroupId((prev) => ({
        ...prev,
        [groupId]: {
          ...(prev[groupId] || emptyMembersState()),
          loading: false,
          error: e?.message || "Error al cargar miembros",
        },
      }));
    }
  };

  const handleCreateGroup = async () => {
    const name = createName.trim();
    if (!name) {
      toast({ title: "Error", description: "Ingresa un nombre para el grupo", variant: "destructive" });
      return;
    }

    setCreateSaving(true);
    try {
      const res = await apiFetch("/api/workspace/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: createDescription.trim() ? createDescription.trim() : null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "No se pudo crear el grupo");

      toast({ title: "Grupo creado", description: "Se creó el grupo correctamente" });
      setCreateName("");
      setCreateDescription("");
      setCreateOpen(false);
      await loadGroups();
    } catch (e: any) {
      toast({ title: "Error", description: e?.message || "No se pudo crear el grupo", variant: "destructive" });
    } finally {
      setCreateSaving(false);
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    const group = groups.find((g) => g.id === groupId);
    const ok = window.confirm(`Eliminar el grupo "${group?.name || "—"}"?`);
    if (!ok) return;

    try {
      const res = await apiFetch(`/api/workspace/groups/${groupId}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "No se pudo eliminar el grupo");

      toast({ title: "Grupo eliminado" });
      if (openGroupId === groupId) setOpenGroupId(null);
      await loadGroups();
    } catch (e: any) {
      toast({ title: "Error", description: e?.message || "No se pudo eliminar el grupo", variant: "destructive" });
    }
  };

  const handleAddMembers = async (groupId: string) => {
    const state = membersByGroupId[groupId] || emptyMembersState();
    const emails = splitEmails(state.addEmail);
    if (emails.length === 0) {
      toast({ title: "Error", description: "Ingresa al menos un email", variant: "destructive" });
      return;
    }

    setMembersByGroupId((prev) => ({
      ...prev,
      [groupId]: { ...state, saving: true, error: null },
    }));

    try {
      const res = await apiFetch(`/api/workspace/groups/${groupId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "No se pudieron agregar miembros");

      const results = Array.isArray(data?.results) ? data.results : [];
      const added = results.filter((r: any) => r?.status === "added").length;
      const skipped = results.filter((r: any) => r?.status === "skipped").length;

      toast({
        title: "Miembros actualizados",
        description: `Agregados: ${added}${skipped ? ` · Omitidos: ${skipped}` : ""}`,
      });

      setMembersByGroupId((prev) => ({
        ...prev,
        [groupId]: { ...(prev[groupId] || emptyMembersState()), addEmail: "", saving: false },
      }));
      await Promise.all([loadMembers(groupId), loadGroups()]);
    } catch (e: any) {
      setMembersByGroupId((prev) => ({
        ...prev,
        [groupId]: { ...(prev[groupId] || emptyMembersState()), saving: false, error: e?.message || "No se pudieron agregar" },
      }));
    }
  };

  const handleRemoveMember = async (groupId: string, userId: string) => {
    const ok = window.confirm("Quitar este miembro del grupo?");
    if (!ok) return;

    const state = membersByGroupId[groupId] || emptyMembersState();
    setMembersByGroupId((prev) => ({ ...prev, [groupId]: { ...state, saving: true, error: null } }));
    try {
      const res = await apiFetch(`/api/workspace/groups/${groupId}/members/${userId}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "No se pudo quitar el miembro");

      toast({ title: "Miembro quitado" });
      await Promise.all([loadMembers(groupId), loadGroups()]);
    } catch (e: any) {
      setMembersByGroupId((prev) => ({
        ...prev,
        [groupId]: { ...(prev[groupId] || emptyMembersState()), saving: false, error: e?.message || "No se pudo quitar" },
      }));
    }
  };

  useEffect(() => {
    if (!canManage) return;
    void loadGroups();
  }, [canManage]);

  if (!canManage) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Solo administrador</CardTitle>
          <CardDescription>Contacta al administrador para gestionar grupos del espacio de trabajo.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total de grupos</CardDescription>
            <CardTitle className="text-2xl">{groups.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Miembros (suma)</CardDescription>
            <CardTitle className="text-2xl">{totalMembersAcrossGroups}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-dashed">
          <CardHeader className="pb-2">
            <CardDescription>Crear grupo</CardDescription>
            <CardTitle className="text-base">Organiza el acceso</CardTitle>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={() => setCreateOpen((v) => !v)}
              data-testid="button-toggle-create-group"
            >
              <Plus className="h-4 w-4" />
              {createOpen ? "Cerrar" : "Nuevo grupo"}
            </Button>
          </CardContent>
        </Card>
      </div>

      {createOpen && (
        <Card>
          <CardHeader>
            <CardTitle>Nuevo grupo</CardTitle>
            <CardDescription>Crea un grupo y luego agrega miembros para ver el conteo de chats compartidos.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <div className="text-sm font-medium">Nombre</div>
                <Input
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="Ej: Ventas, Soporte, Dirección"
                  data-testid="input-group-name"
                />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium">Descripción (opcional)</div>
                <Input
                  value={createDescription}
                  onChange={(e) => setCreateDescription(e.target.value)}
                  placeholder="Ej: Equipo regional LATAM"
                  data-testid="input-group-description"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createSaving}>
                Cancelar
              </Button>
              <Button onClick={() => void handleCreateGroup()} disabled={createSaving} data-testid="button-create-group">
                {createSaving ? "Creando..." : "Crear"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Grupos</CardTitle>
            <CardDescription>Miembros por grupo y chats compartidos hacia miembros del grupo.</CardDescription>
          </div>
          <Button variant="outline" onClick={() => void loadGroups()} disabled={loading} data-testid="button-refresh-groups">
            {loading ? "Actualizando..." : "Actualizar"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && <div className="text-sm text-red-600">{error}</div>}

          {loading && groups.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando grupos...
            </div>
          )}

          {!loading && groups.length === 0 && !error && (
            <div className="text-sm text-muted-foreground">Aún no hay grupos.</div>
          )}

          <div className="space-y-2">
            {groups.map((g) => {
              const isOpen = openGroupId === g.id;
              const state = membersByGroupId[g.id] || emptyMembersState();

              return (
                <Collapsible
                  key={g.id}
                  open={isOpen}
                  onOpenChange={(next) => {
                    setOpenGroupId(next ? g.id : null);
                    if (next && !membersByGroupId[g.id]) {
                      void loadMembers(g.id);
                    }
                  }}
                >
                  <div className="rounded-lg border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="font-medium truncate">{g.name}</div>
                          <Badge variant="secondary">{g.memberCount} miembros</Badge>
                          <Badge variant="outline">{g.sharedChatsCount} chats compartidos</Badge>
                        </div>
                        {g.description && <div className="text-sm text-muted-foreground mt-1">{g.description}</div>}
                      </div>

                      <div className="flex items-center gap-2">
                        <CollapsibleTrigger asChild>
                          <Button variant="outline" size="sm" className="gap-2" data-testid={`button-manage-group-${g.id}`}>
                            Gestionar
                            <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen ? "rotate-180" : "rotate-0")} />
                          </Button>
                        </CollapsibleTrigger>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`button-group-more-${g.id}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              className="text-red-600 focus:text-red-600"
                              onClick={() => void handleDeleteGroup(g.id)}
                              data-testid={`button-delete-group-${g.id}`}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Eliminar
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>

                    <CollapsibleContent className="mt-4 space-y-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-md border bg-muted/10 p-3">
                          <div className="text-xs text-muted-foreground">Chats compartidos al grupo</div>
                          <div className="text-lg font-semibold">{g.groupSharedChatsCount}</div>
                        </div>
                        <div className="rounded-md border bg-muted/10 p-3">
                          <div className="text-xs text-muted-foreground">Chats compartidos a miembros</div>
                          <div className="text-lg font-semibold">{g.directSharedChatsCount}</div>
                        </div>
                      </div>

                      <div className="rounded-md bg-muted/20 border p-3">
                        <div className="text-sm font-medium mb-2 flex items-center gap-2">
                          <UserPlus className="h-4 w-4" />
                          Agregar miembro(s)
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <Input
                            value={state.addEmail}
                            onChange={(e) =>
                              setMembersByGroupId((prev) => ({
                                ...prev,
                                [g.id]: { ...(prev[g.id] || emptyMembersState()), addEmail: e.target.value },
                              }))
                            }
                            placeholder="email@empresa.com (puedes pegar varios)"
                            data-testid={`input-add-member-${g.id}`}
                          />
                          <Button
                            onClick={() => void handleAddMembers(g.id)}
                            disabled={state.saving}
                            className="gap-2"
                            data-testid={`button-add-member-${g.id}`}
                          >
                            {state.saving ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Guardando...
                              </>
                            ) : (
                              <>
                                <Plus className="h-4 w-4" />
                                Agregar
                              </>
                            )}
                          </Button>
                        </div>
                        {state.error && <div className="text-sm text-red-600 mt-2">{state.error}</div>}
                      </div>

                      <div className="space-y-2">
                        <div className="text-sm font-medium">Miembros</div>
                        {state.loading ? (
                          <div className="text-sm text-muted-foreground flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Cargando miembros...
                          </div>
                        ) : state.members.length === 0 ? (
                          <div className="text-sm text-muted-foreground">Este grupo no tiene miembros.</div>
                        ) : (
                          <div className="space-y-2">
                            {state.members.map((m) => {
                              const display = m.fullName || m.username || m.email || m.userId;
                              return (
                                <div key={m.userId} className="flex items-center justify-between gap-3 rounded-md border p-3">
                                  <div className="min-w-0">
                                    <div className="text-sm font-medium truncate">{display}</div>
                                    {m.email && <div className="text-xs text-muted-foreground truncate">{m.email}</div>}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {m.role && <Badge variant="secondary">{m.role}</Badge>}
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 text-red-600"
                                      onClick={() => void handleRemoveMember(g.id, m.userId)}
                                      disabled={state.saving}
                                      data-testid={`button-remove-member-${g.id}-${m.userId}`}
                                    >
                                      <X className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
