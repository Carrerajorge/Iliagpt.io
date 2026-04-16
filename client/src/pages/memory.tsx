/**
 * Memory Management Page
 * 
 * Allows users to view, search, and manage their semantic memories
 */

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
    Brain, 
    Search, 
    Trash2, 
    Clock, 
    Tag, 
    Plus,
    RefreshCw,
    Sparkles,
    BookOpen,
    User,
    Lightbulb,
    Heart
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { usePlatformSettings } from "@/contexts/PlatformSettingsContext";
import { formatZonedDateTime, normalizeTimeZone } from "@/lib/platformDateTime";

interface MemoryChunk {
    id: string;
    content: string;
    type: "fact" | "preference" | "instruction" | "context" | "persona" | "emotional";
    metadata: {
        source: string;
        confidence: number;
        accessCount: number;
        createdAt: string;
        lastAccessed: string;
        tags: string[];
    };
}

interface MemoryStats {
    totalMemories: number;
    byType: Record<string, number>;
    avgConfidence: number;
    embeddingProvider: string;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
    fact: <BookOpen className="h-4 w-4" />,
    preference: <Heart className="h-4 w-4" />,
    instruction: <Lightbulb className="h-4 w-4" />,
    context: <Tag className="h-4 w-4" />,
    persona: <User className="h-4 w-4" />,
    emotional: <Sparkles className="h-4 w-4" />
};

const TYPE_COLORS: Record<string, string> = {
    fact: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    preference: "bg-pink-500/10 text-pink-500 border-pink-500/20",
    instruction: "bg-amber-500/10 text-amber-500 border-amber-500/20",
    context: "bg-purple-500/10 text-purple-500 border-purple-500/20",
    persona: "bg-green-500/10 text-green-500 border-green-500/20",
    emotional: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20"
};

export default function MemoryPage() {
    const { user } = useAuth();
    const { toast } = useToast();
    const { settings: platformSettings } = usePlatformSettings();
    const platformTimeZone = normalizeTimeZone(platformSettings.timezone_default);
    const platformDateFormat = platformSettings.date_format;
    
    const [memories, setMemories] = useState<MemoryChunk[]>([]);
    const [stats, setStats] = useState<MemoryStats | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<MemoryChunk[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSearching, setIsSearching] = useState(false);
    const [selectedType, setSelectedType] = useState<string>("all");
    
    // New memory form
    const [newMemoryContent, setNewMemoryContent] = useState("");
    const [newMemoryType, setNewMemoryType] = useState<string>("fact");

    const loadMemories = useCallback(async () => {
        if (!user) return;
        setIsLoading(true);
        try {
            const [memoriesRes, statsRes] = await Promise.all([
                apiRequest("GET", "/api/memory/semantic/recall?limit=100"),
                apiRequest("GET", "/api/memory/semantic/stats")
            ]);
            
            const memoriesData = await memoriesRes.json();
            const statsData = await statsRes.json();
            
            setMemories(memoriesData.memories || []);
            setStats(statsData);
        } catch (error) {
            console.error("Error loading memories:", error);
            toast({
                title: "Error",
                description: "No se pudieron cargar las memorias",
                variant: "destructive"
            });
        } finally {
            setIsLoading(false);
        }
    }, [user, toast]);

    useEffect(() => {
        loadMemories();
    }, [loadMemories]);

    const handleSearch = async () => {
        if (!searchQuery.trim()) return;
        
        setIsSearching(true);
        try {
            const res = await apiRequest("POST", "/api/memory/semantic/search", {
                query: searchQuery,
                limit: 20,
                threshold: 0.5
            });
            const data = await res.json();
            setSearchResults(data.results || []);
        } catch (error) {
            console.error("Search error:", error);
            toast({
                title: "Error",
                description: "Error al buscar memorias",
                variant: "destructive"
            });
        } finally {
            setIsSearching(false);
        }
    };

    const handleAddMemory = async () => {
        if (!newMemoryContent.trim()) return;
        
        try {
            await apiRequest("POST", "/api/memory/semantic/remember", {
                content: newMemoryContent,
                type: newMemoryType
            });
            
            toast({
                title: "Memoria guardada",
                description: "La memoria se ha guardado correctamente"
            });
            
            setNewMemoryContent("");
            loadMemories();
        } catch (error) {
            toast({
                title: "Error",
                description: "No se pudo guardar la memoria",
                variant: "destructive"
            });
        }
    };

    const handleDeleteMemory = async (memoryId: string) => {
        try {
            await apiRequest("DELETE", `/api/memory/semantic/${memoryId}`);
            toast({
                title: "Memoria eliminada",
                description: "La memoria se ha eliminado correctamente"
            });
            loadMemories();
        } catch (error) {
            toast({
                title: "Error",
                description: "No se pudo eliminar la memoria",
                variant: "destructive"
            });
        }
    };

    const filteredMemories = selectedType === "all" 
        ? memories 
        : memories.filter(m => m.type === selectedType);

    const formatDate = (dateStr: string) =>
        formatZonedDateTime(dateStr, { timeZone: platformTimeZone, dateFormat: platformDateFormat });

    if (!user) {
        return (
            <div className="container mx-auto p-6">
                <Card>
                    <CardContent className="p-12 text-center">
                        <Brain className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                        <h2 className="text-xl font-semibold mb-2">Inicia sesión para ver tus memorias</h2>
                        <p className="text-muted-foreground">
                            Las memorias te permiten personalizar la experiencia de Ilia
                        </p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="container mx-auto p-6 max-w-6xl">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-3xl font-bold flex items-center gap-3">
                        <Brain className="h-8 w-8 text-primary" />
                        Mis Memorias
                    </h1>
                    <p className="text-muted-foreground mt-1">
                        Gestiona lo que Ilia recuerda sobre ti
                    </p>
                </div>
                <Button onClick={loadMemories} variant="outline" disabled={isLoading}>
                    <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
                    Actualizar
                </Button>
            </div>

            {/* Stats */}
            {stats && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <Card>
                        <CardContent className="p-4">
                            <div className="text-2xl font-bold">{stats.totalMemories}</div>
                            <div className="text-sm text-muted-foreground">Total memorias</div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="p-4">
                            <div className="text-2xl font-bold">{Math.round(stats.avgConfidence)}%</div>
                            <div className="text-sm text-muted-foreground">Confianza promedio</div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="p-4">
                            <div className="text-2xl font-bold capitalize">{stats.embeddingProvider}</div>
                            <div className="text-sm text-muted-foreground">Proveedor embeddings</div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="p-4">
                            <div className="text-2xl font-bold">{Object.keys(stats.byType).length}</div>
                            <div className="text-sm text-muted-foreground">Tipos de memoria</div>
                        </CardContent>
                    </Card>
                </div>
            )}

            <Tabs defaultValue="browse" className="space-y-6">
                <TabsList>
                    <TabsTrigger value="browse">Explorar</TabsTrigger>
                    <TabsTrigger value="search">Buscar</TabsTrigger>
                    <TabsTrigger value="add">Agregar</TabsTrigger>
                </TabsList>

                {/* Browse Tab */}
                <TabsContent value="browse">
                    {/* Type Filter */}
                    <div className="flex flex-wrap gap-2 mb-4">
                        <Button
                            variant={selectedType === "all" ? "default" : "outline"}
                            size="sm"
                            onClick={() => setSelectedType("all")}
                        >
                            Todos
                        </Button>
                        {Object.entries(TYPE_ICONS).map(([type, icon]) => (
                            <Button
                                key={type}
                                variant={selectedType === type ? "default" : "outline"}
                                size="sm"
                                onClick={() => setSelectedType(type)}
                                className="capitalize"
                            >
                                {icon}
                                <span className="ml-1">{type}</span>
                                {stats?.byType[type] && (
                                    <Badge variant="secondary" className="ml-2">
                                        {stats.byType[type]}
                                    </Badge>
                                )}
                            </Button>
                        ))}
                    </div>

                    {/* Memory List */}
                    <div className="space-y-3">
                        {filteredMemories.length === 0 ? (
                            <Card>
                                <CardContent className="p-8 text-center">
                                    <Brain className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                                    <p className="text-muted-foreground">
                                        No hay memorias {selectedType !== "all" ? `de tipo "${selectedType}"` : ""}
                                    </p>
                                </CardContent>
                            </Card>
                        ) : (
                            filteredMemories.map((memory) => (
                                <Card key={memory.id} className="hover:shadow-md transition-shadow">
                                    <CardContent className="p-4">
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <Badge 
                                                        variant="outline" 
                                                        className={`${TYPE_COLORS[memory.type]} capitalize`}
                                                    >
                                                        {TYPE_ICONS[memory.type]}
                                                        <span className="ml-1">{memory.type}</span>
                                                    </Badge>
                                                    <Badge variant="secondary">
                                                        {memory.metadata.confidence}% confianza
                                                    </Badge>
                                                </div>
                                                <p className="text-sm leading-relaxed">{memory.content}</p>
                                                <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                                                    <span className="flex items-center gap-1">
                                                        <Clock className="h-3 w-3" />
                                                        {formatDate(memory.metadata.createdAt)}
                                                    </span>
                                                    <span>Accesos: {memory.metadata.accessCount}</span>
                                                    <span className="capitalize">Fuente: {memory.metadata.source}</span>
                                                </div>
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="text-destructive hover:text-destructive"
                                                onClick={() => handleDeleteMemory(memory.id)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))
                        )}
                    </div>
                </TabsContent>

                {/* Search Tab */}
                <TabsContent value="search">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Search className="h-5 w-5" />
                                Búsqueda Semántica
                            </CardTitle>
                            <CardDescription>
                                Busca memorias por significado, no solo por palabras exactas
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="flex gap-2">
                                <Input
                                    placeholder="¿Qué quieres recordar?"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                                />
                                <Button onClick={handleSearch} disabled={isSearching}>
                                    {isSearching ? (
                                        <RefreshCw className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <Search className="h-4 w-4" />
                                    )}
                                </Button>
                            </div>

                            {searchResults.length > 0 && (
                                <div className="mt-6 space-y-3">
                                    <h3 className="font-medium">Resultados ({searchResults.length})</h3>
                                    {searchResults.map((result: any) => (
                                        <Card key={result.chunk?.id || result.id} className="bg-muted/50">
                                            <CardContent className="p-4">
                                                <div className="flex items-center justify-between mb-2">
                                                    <Badge 
                                                        variant="outline" 
                                                        className={`${TYPE_COLORS[result.chunk?.type || result.type]} capitalize`}
                                                    >
                                                        {result.chunk?.type || result.type}
                                                    </Badge>
                                                    <Badge variant="secondary">
                                                        {Math.round((result.similarity || result.score || 0) * 100)}% similitud
                                                    </Badge>
                                                </div>
                                                <p className="text-sm">{result.chunk?.content || result.content}</p>
                                            </CardContent>
                                        </Card>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Add Tab */}
                <TabsContent value="add">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Plus className="h-5 w-5" />
                                Agregar Memoria
                            </CardTitle>
                            <CardDescription>
                                Enséñale algo nuevo a Ilia sobre ti
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div>
                                <label className="text-sm font-medium mb-2 block">Tipo de memoria</label>
                                <div className="flex flex-wrap gap-2">
                                    {Object.entries(TYPE_ICONS).map(([type, icon]) => (
                                        <Button
                                            key={type}
                                            variant={newMemoryType === type ? "default" : "outline"}
                                            size="sm"
                                            onClick={() => setNewMemoryType(type)}
                                            className="capitalize"
                                        >
                                            {icon}
                                            <span className="ml-1">{type}</span>
                                        </Button>
                                    ))}
                                </div>
                            </div>
                            
                            <div>
                                <label className="text-sm font-medium mb-2 block">Contenido</label>
                                <textarea
                                    className="w-full min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                                    placeholder={
                                        newMemoryType === "fact" ? "Ej: Mi cumpleaños es el 15 de marzo" :
                                        newMemoryType === "preference" ? "Ej: Prefiero respuestas cortas y directas" :
                                        newMemoryType === "instruction" ? "Ej: Siempre responde en español" :
                                        "Escribe algo que quieras que Ilia recuerde..."
                                    }
                                    value={newMemoryContent}
                                    onChange={(e) => setNewMemoryContent(e.target.value)}
                                />
                            </div>

                            <Button onClick={handleAddMemory} disabled={!newMemoryContent.trim()}>
                                <Plus className="h-4 w-4 mr-2" />
                                Guardar Memoria
                            </Button>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
