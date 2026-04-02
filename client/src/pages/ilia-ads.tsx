import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Plus, Megaphone, Eye, MousePointer, ToggleLeft, ToggleRight, Trash2, BarChart3, Target, Globe, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

interface Ad {
  id: number;
  title: string;
  description: string;
  imageUrl?: string | null;
  targetUrl: string;
  advertiser: string;
  keywords: string[];
  category: string;
  costPerImpression: number;
  dailyBudget: number;
  totalBudget?: number | null;
  impressions: number;
  clicks: number;
  active: boolean;
  targetCountry: string;
  minAge: number;
  advantagePlus: boolean;
  createdAt: string;
}

interface Stats {
  totalAds: number;
  activeAds: number;
  totalImpressions: number;
  totalClicks: number;
  ctr: string;
}

export default function IliaAdsPage() {
  const [, setLocation] = useLocation();
  const [ads, setAds] = useState<Ad[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const [form, setForm] = useState({
    title: "",
    description: "",
    imageUrl: "",
    targetUrl: "",
    advertiser: "",
    keywords: "",
    category: "general",
    dailyBudget: 350,
    targetCountry: "PE",
    minAge: 18,
  });

  const fetchAds = useCallback(async () => {
    try {
      const [adsRes, statsRes] = await Promise.all([
        fetch("/api/ads/list"),
        fetch("/api/ads/stats"),
      ]);
      const adsData = await adsRes.json();
      const statsData = await statsRes.json();
      setAds(adsData.ads || []);
      setStats(statsData.summary || null);
    } catch (e) {
      console.error("Error fetching ads:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAds();
  }, [fetchAds]);

  const handleCreate = async () => {
    try {
      const res = await fetch("/api/ads/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          keywords: form.keywords.split(",").map(k => k.trim()).filter(Boolean),
          imageUrl: form.imageUrl || null,
        }),
      });
      if (!res.ok) throw new Error("Error creating ad");
      toast({ title: "Anuncio creado" });
      setShowCreate(false);
      setForm({ title: "", description: "", imageUrl: "", targetUrl: "", advertiser: "", keywords: "", category: "general", dailyBudget: 350, targetCountry: "PE", minAge: 18 });
      fetchAds();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const toggleAd = async (id: number, active: boolean) => {
    await fetch(`/api/ads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !active }),
    });
    fetchAds();
  };

  const deleteAd = async (id: number) => {
    await fetch(`/api/ads/${id}`, { method: "DELETE" });
    fetchAds();
    toast({ title: "Anuncio eliminado" });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-8">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/")} data-testid="button-back-ads">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <Megaphone className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold" data-testid="text-ads-title">IliaADS</h1>
          </div>
          <Badge variant="outline" className="ml-2">Beta</Badge>
          <Button className="ml-auto" onClick={() => setShowCreate(!showCreate)} data-testid="button-create-ad">
            <Plus className="h-4 w-4 mr-2" />
            Nuevo anuncio
          </Button>
        </div>

        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
            <Card>
              <CardContent className="p-4 text-center">
                <BarChart3 className="h-5 w-5 mx-auto mb-1 text-blue-500" />
                <p className="text-2xl font-bold" data-testid="text-total-ads">{stats.totalAds}</p>
                <p className="text-xs text-muted-foreground">Total anuncios</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <Target className="h-5 w-5 mx-auto mb-1 text-green-500" />
                <p className="text-2xl font-bold" data-testid="text-active-ads">{stats.activeAds}</p>
                <p className="text-xs text-muted-foreground">Activos</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <Eye className="h-5 w-5 mx-auto mb-1 text-purple-500" />
                <p className="text-2xl font-bold" data-testid="text-total-impressions">{stats.totalImpressions.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Impresiones</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <MousePointer className="h-5 w-5 mx-auto mb-1 text-orange-500" />
                <p className="text-2xl font-bold" data-testid="text-total-clicks">{stats.totalClicks.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Clics</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <DollarSign className="h-5 w-5 mx-auto mb-1 text-yellow-500" />
                <p className="text-2xl font-bold" data-testid="text-ctr">{stats.ctr}%</p>
                <p className="text-xs text-muted-foreground">CTR</p>
              </CardContent>
            </Card>
          </div>
        )}

        {showCreate && (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Megaphone className="h-5 w-5" />
                Crear anuncio
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">Titulo</label>
                  <Input
                    placeholder="Nombre del anuncio"
                    value={form.title}
                    onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))}
                    maxLength={120}
                    data-testid="input-ad-title"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Anunciante</label>
                  <Input
                    placeholder="Nombre del negocio"
                    value={form.advertiser}
                    onChange={(e) => setForm(f => ({ ...f, advertiser: e.target.value }))}
                    data-testid="input-ad-advertiser"
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Descripcion</label>
                <Textarea
                  placeholder="Breve descripcion del anuncio..."
                  value={form.description}
                  onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                  rows={2}
                  data-testid="input-ad-description"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">URL de destino</label>
                  <Input
                    placeholder="https://..."
                    value={form.targetUrl}
                    onChange={(e) => setForm(f => ({ ...f, targetUrl: e.target.value }))}
                    data-testid="input-ad-url"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">URL de imagen (opcional)</label>
                  <Input
                    placeholder="https://..."
                    value={form.imageUrl}
                    onChange={(e) => setForm(f => ({ ...f, imageUrl: e.target.value }))}
                    data-testid="input-ad-image"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">Keywords (separadas por coma)</label>
                  <Input
                    placeholder="tecnologia, programacion, ia"
                    value={form.keywords}
                    onChange={(e) => setForm(f => ({ ...f, keywords: e.target.value }))}
                    data-testid="input-ad-keywords"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Categoria</label>
                  <Input
                    placeholder="general"
                    value={form.category}
                    onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))}
                    data-testid="input-ad-category"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Presupuesto diario (centimos)</label>
                  <Input
                    type="number"
                    value={form.dailyBudget}
                    onChange={(e) => setForm(f => ({ ...f, dailyBudget: parseInt(e.target.value) || 350 }))}
                    data-testid="input-ad-budget"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-1 block flex items-center gap-1">
                    <Globe className="h-3.5 w-3.5" /> Pais
                  </label>
                  <Input
                    value={form.targetCountry}
                    onChange={(e) => setForm(f => ({ ...f, targetCountry: e.target.value }))}
                    data-testid="input-ad-country"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Edad minima</label>
                  <Input
                    type="number"
                    value={form.minAge}
                    onChange={(e) => setForm(f => ({ ...f, minAge: parseInt(e.target.value) || 18 }))}
                    data-testid="input-ad-age"
                  />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <Button onClick={handleCreate} data-testid="button-submit-ad">
                  Crear anuncio
                </Button>
                <Button variant="outline" onClick={() => setShowCreate(false)}>
                  Cancelar
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Cada impresion se cobra a 0.1 centimos. Los anuncios se muestran contextualmente
                debajo de las respuestas de la IA segun las consultas de los usuarios.
              </p>
            </CardContent>
          </Card>
        )}

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Cargando anuncios...</div>
        ) : ads.length === 0 ? (
          <div className="text-center py-16">
            <Megaphone className="h-12 w-12 mx-auto mb-4 text-muted-foreground/30" />
            <p className="text-muted-foreground mb-2">No hay anuncios aun</p>
            <p className="text-sm text-muted-foreground/60 mb-4">
              Crea tu primer anuncio para empezar a promocionar tu negocio
              entre los millones de usuarios de IliaGPT.
            </p>
            <Button onClick={() => setShowCreate(true)} data-testid="button-first-ad">
              <Plus className="h-4 w-4 mr-2" />
              Crear primer anuncio
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {ads.map((ad) => (
              <Card key={ad.id} className={!ad.active ? "opacity-60" : ""} data-testid={`card-ad-${ad.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    {ad.imageUrl && (
                      <img src={ad.imageUrl} alt={ad.title} className="w-16 h-16 rounded-lg object-cover flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium truncate">{ad.title}</h3>
                        <Badge variant={ad.active ? "default" : "secondary"} className="flex-shrink-0">
                          {ad.active ? "Activo" : "Pausado"}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-1">{ad.description}</p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Eye className="h-3 w-3" /> {(ad.impressions || 0).toLocaleString()}
                        </span>
                        <span className="flex items-center gap-1">
                          <MousePointer className="h-3 w-3" /> {(ad.clicks || 0).toLocaleString()}
                        </span>
                        <span>{ad.advertiser}</span>
                        <span className="flex items-center gap-1">
                          <Globe className="h-3 w-3" /> {ad.targetCountry}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => toggleAd(ad.id, ad.active)}
                        data-testid={`button-toggle-ad-${ad.id}`}
                      >
                        {ad.active ? <ToggleRight className="h-4 w-4 text-green-500" /> : <ToggleLeft className="h-4 w-4" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-red-500 hover:text-red-600"
                        onClick={() => deleteAd(ad.id)}
                        data-testid={`button-delete-ad-${ad.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
