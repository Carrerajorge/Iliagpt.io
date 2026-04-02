import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import {
  ArrowLeft, Megaphone, Eye, MousePointer,
  Trash2, BarChart3, Target, Globe, DollarSign, ChevronRight, ChevronLeft,
  MessageCircle, Zap, Users, Calendar, CreditCard, MapPin,
  TrendingUp, CheckCircle2, Radio, Image as ImageIcon, Sparkles, Info,
  ArrowUpRight, Pause, Play, Upload, Link, Phone, X,
  LayoutList
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";

interface Ad {
  id: number;
  title: string;
  description: string;
  imageUrl?: string | null;
  targetUrl: string;
  advertiser: string;
  keywords: string[];
  category: string;
  objective: string;
  costPerImpression: number;
  dailyBudget: number;
  totalBudget?: number | null;
  costSpent: number;
  impressions: number;
  clicks: number;
  messagesReceived: number;
  active: boolean;
  status: string;
  targetCountry: string;
  minAge: number;
  maxAge: number;
  gender: string;
  advantagePlus: boolean;
  durationDays: number;
  placements: string[];
  createdAt: string;
  costSpentSoles?: string;
}

interface Stats {
  totalAds: number;
  activeAds: number;
  totalImpressions: number;
  totalClicks: number;
  totalMessages: number;
  totalSpentSoles: string;
  ctr: string;
  avgCostPerClick: string;
}

interface Estimate {
  daily: { min: number; max: number };
  total: { min: number; max: number };
  costPerImpression: number;
  costPerImpressionLabel: string;
  recommendation: { avgSpend: number; avgResponses: number; label: string };
  symbol: string;
}

const OBJECTIVES = [
  { id: "automatic", title: "Automatico", desc: "Recibir mas mensajes — seleccionado en funcion de tu actividad anterior", icon: Sparkles, recommended: true },
  { id: "messages", title: "Recibir mas mensajes", desc: "Obtener mas interacciones directas con usuarios", icon: MessageCircle },
  { id: "traffic", title: "Mas visitas al enlace", desc: "Dirigir trafico a tu sitio web o WhatsApp", icon: ArrowUpRight },
  { id: "awareness", title: "Reconocimiento", desc: "Mostrar tu marca a la mayor cantidad de personas", icon: Eye },
];

const COUNTRIES = [
  { code: "PE", name: "Peru", flag: "🇵🇪" },
  { code: "MX", name: "Mexico", flag: "🇲🇽" },
  { code: "CO", name: "Colombia", flag: "🇨🇴" },
  { code: "AR", name: "Argentina", flag: "🇦🇷" },
  { code: "CL", name: "Chile", flag: "🇨🇱" },
  { code: "ES", name: "Espana", flag: "🇪🇸" },
  { code: "US", name: "Estados Unidos", flag: "🇺🇸" },
  { code: "BR", name: "Brasil", flag: "🇧🇷" },
  { code: "EC", name: "Ecuador", flag: "🇪🇨" },
  { code: "BO", name: "Bolivia", flag: "🇧🇴" },
];

const CATEGORIES = [
  "general", "tecnologia", "educacion", "salud", "finanzas",
  "ecommerce", "entretenimiento", "gastronomia", "inmobiliaria",
  "automotriz", "moda", "deportes", "viajes",
];

function formatNumber(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + " M";
  if (n >= 1000) return (n / 1000).toFixed(1) + " mil";
  return n.toString();
}

export default function IliaAdsPage() {
  const [, setLocation] = useLocation();
  const [view, setView] = useState<"wizard" | "ads">("wizard");
  const [ads, setAds] = useState<Ad[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [wizardStep, setWizardStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const [form, setForm] = useState({
    title: "",
    description: "",
    imageUrl: "",
    targetUrl: "",
    whatsappNumber: "",
    advertiser: "",
    keywords: "",
    category: "general",
    objective: "automatic",
    dailyBudget: 3.5,
    durationDays: 7,
    targetCountry: "PE",
    minAge: 18,
    maxAge: 65,
    gender: "all",
    advantagePlus: true,
    placements: ["in_chat"],
    paymentMethod: "per_impression",
  });

  const fetchAds = useCallback(async () => {
    setLoading(true);
    try {
      const [adsRes, statsRes] = await Promise.all([
        fetch("/api/ads/list"),
        fetch("/api/ads/stats"),
      ]);
      if (adsRes.ok) setAds((await adsRes.json()).ads || []);
      if (statsRes.ok) setStats((await statsRes.json()).summary || null);
    } catch (e) {
      console.error("Error fetching ads:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const fetchEstimate = async () => {
      try {
        const res = await fetch(
          `/api/ads/estimate?budget=${form.dailyBudget}&category=${form.category}&days=${form.durationDays}`
        );
        if (res.ok) setEstimate(await res.json());
      } catch {}
    };
    fetchEstimate();
  }, [form.dailyBudget, form.category, form.durationDays]);

  const totalBudget = useMemo(() => form.dailyBudget * form.durationDays, [form.dailyBudget, form.durationDays]);

  const finalTargetUrl = useMemo(() => {
    if (form.whatsappNumber) {
      const num = form.whatsappNumber.replace(/\D/g, "");
      return `https://wa.me/${num}`;
    }
    return form.targetUrl;
  }, [form.whatsappNumber, form.targetUrl]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Solo se permiten imagenes", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "La imagen no puede superar 5MB", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setImagePreview(dataUrl);
      setForm(f => ({ ...f, imageUrl: dataUrl }));
    };
    reader.readAsDataURL(file);
  };

  const handleCreate = async () => {
    try {
      const res = await fetch("/api/ads/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          targetUrl: finalTargetUrl,
          dailyBudget: form.dailyBudget,
          keywords: form.keywords.split(",").map(k => k.trim()).filter(Boolean),
          imageUrl: form.imageUrl || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ? JSON.stringify(err.error) : "Error al crear anuncio");
      }
      toast({ title: "Anuncio publicado", description: "Tu anuncio esta activo y comenzara a mostrarse a millones de usuarios." });
      setWizardStep(0);
      resetForm();
      setView("ads");
      fetchAds();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const resetForm = () => {
    setForm({
      title: "", description: "", imageUrl: "", targetUrl: "", whatsappNumber: "",
      advertiser: "", keywords: "", category: "general", objective: "automatic",
      dailyBudget: 3.5, durationDays: 7, targetCountry: "PE", minAge: 18,
      maxAge: 65, gender: "all", advantagePlus: true, placements: ["in_chat"],
      paymentMethod: "per_impression",
    });
    setImagePreview(null);
  };

  const toggleAd = async (id: number, active: boolean) => {
    await fetch(`/api/ads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !active, status: !active ? "active" : "paused" }),
    });
    fetchAds();
  };

  const deleteAd = async (id: number) => {
    await fetch(`/api/ads/${id}`, { method: "DELETE" });
    fetchAds();
    toast({ title: "Anuncio eliminado" });
  };

  const canAdvance = useMemo(() => {
    switch (wizardStep) {
      case 0: return !!(form.title && form.description && (form.targetUrl || form.whatsappNumber) && form.advertiser && (form.imageUrl || imagePreview));
      case 1: return !!form.objective;
      case 2: return !!form.targetCountry;
      case 3: return form.dailyBudget >= 0.5;
      case 4: return true;
      default: return false;
    }
  }, [wizardStep, form, imagePreview]);

  const STEPS = [
    { id: "post", label: "Publicacion" },
    { id: "objective", label: "Objetivo" },
    { id: "audience", label: "Publico" },
    { id: "budget", label: "Presupuesto" },
    { id: "review", label: "Publicar" },
  ];

  return (
    <div className="min-h-screen bg-background" data-testid="ads-page">
      <div className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/")} data-testid="button-back-ads">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="p-1.5 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600">
            <Megaphone className="h-4 w-4 text-white" />
          </div>
          <span className="font-semibold text-lg">IliaADS</span>
          <Badge variant="outline" className="text-[10px]">Ads Manager</Badge>

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant={view === "wizard" ? "default" : "outline"}
              size="sm"
              onClick={() => { setView("wizard"); setWizardStep(0); resetForm(); }}
              data-testid="button-new-ad"
            >
              <Megaphone className="h-3.5 w-3.5 mr-1.5" />
              Promocionar publicacion
            </Button>
            <Button
              variant={view === "ads" ? "default" : "outline"}
              size="sm"
              onClick={() => { setView("ads"); fetchAds(); }}
              data-testid="button-my-ads"
            >
              <LayoutList className="h-3.5 w-3.5 mr-1.5" />
              Mis anuncios
            </Button>
          </div>
        </div>
      </div>

      {view === "wizard" && (
        <div className="max-w-5xl mx-auto px-4 py-6">
          <div className="flex items-center justify-center gap-1 mb-8">
            {STEPS.map((step, i) => (
              <div key={step.id} className="flex items-center gap-1">
                <button
                  onClick={() => { if (i < wizardStep) setWizardStep(i); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    i < wizardStep ? "bg-primary text-primary-foreground cursor-pointer" :
                    i === wizardStep ? "bg-primary text-primary-foreground ring-2 ring-primary/30" :
                    "bg-muted text-muted-foreground"
                  }`}
                  data-testid={`step-indicator-${step.id}`}
                >
                  {i < wizardStep ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span className="w-4 text-center">{i + 1}</span>}
                  <span className="hidden sm:inline">{step.label}</span>
                </button>
                {i < STEPS.length - 1 && (
                  <div className={`w-8 h-0.5 ${i < wizardStep ? "bg-primary" : "bg-muted"}`} />
                )}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2">

              {wizardStep === 0 && (
                <div className="space-y-6" data-testid="step-publication">
                  <div>
                    <h2 className="text-xl font-bold mb-1 flex items-center gap-2">
                      <Upload className="h-5 w-5 text-primary" />
                      Promocionar publicacion
                    </h2>
                    <p className="text-muted-foreground text-sm">Sube tu foto, agrega tu link y configura tu anuncio</p>
                  </div>

                  <Card>
                    <CardContent className="p-5 space-y-5">
                      <div>
                        <Label className="text-sm font-semibold flex items-center gap-1.5 mb-3">
                          <ImageIcon className="h-4 w-4 text-primary" />
                          Foto del post
                        </Label>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          onChange={handleImageUpload}
                          className="hidden"
                          data-testid="input-file-upload"
                        />

                        {imagePreview || form.imageUrl ? (
                          <div className="relative max-w-sm">
                            <img
                              src={imagePreview || form.imageUrl}
                              alt="Preview del post"
                              className="w-full h-48 rounded-xl object-cover border shadow-sm"
                              data-testid="img-preview"
                            />
                            <button
                              onClick={() => { setImagePreview(null); setForm(f => ({ ...f, imageUrl: "" })); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                              className="absolute top-2 right-2 p-1 rounded-full bg-black/50 text-white hover:bg-black/70 transition"
                              data-testid="button-remove-image"
                            >
                              <X className="h-4 w-4" />
                            </button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="absolute bottom-2 right-2"
                              onClick={() => fileInputRef.current?.click()}
                            >
                              Cambiar foto
                            </Button>
                          </div>
                        ) : (
                          <button
                            onClick={() => fileInputRef.current?.click()}
                            className="w-full max-w-sm h-48 rounded-xl border-2 border-dashed border-muted-foreground/20 hover:border-primary/40 hover:bg-primary/5 transition-all flex flex-col items-center justify-center gap-2 cursor-pointer"
                            data-testid="button-upload-image"
                          >
                            <div className="p-3 rounded-full bg-primary/10">
                              <Upload className="h-6 w-6 text-primary" />
                            </div>
                            <span className="text-sm font-medium">Subir foto del post</span>
                            <span className="text-xs text-muted-foreground">JPG, PNG o GIF (max 5MB)</span>
                          </button>
                        )}

                        <div className="mt-3">
                          <Label className="text-xs text-muted-foreground">O pega una URL de imagen</Label>
                          <Input
                            placeholder="https://ejemplo.com/mi-imagen.jpg"
                            value={imagePreview ? "" : form.imageUrl}
                            onChange={(e) => { setForm(f => ({ ...f, imageUrl: e.target.value })); setImagePreview(null); }}
                            className="mt-1 text-sm"
                            disabled={!!imagePreview}
                            data-testid="input-image-url"
                          />
                        </div>
                      </div>

                      <Separator />

                      <div>
                        <Label className="text-sm font-semibold">Nombre del negocio</Label>
                        <Input
                          placeholder="Mi Empresa S.A.C."
                          value={form.advertiser}
                          onChange={(e) => setForm(f => ({ ...f, advertiser: e.target.value }))}
                          className="mt-1.5"
                          data-testid="input-advertiser"
                        />
                      </div>

                      <div>
                        <Label className="text-sm font-semibold">Titulo del anuncio</Label>
                        <Input
                          placeholder="Titulo atractivo para tu anuncio"
                          value={form.title}
                          onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))}
                          maxLength={120}
                          className="mt-1.5"
                          data-testid="input-title"
                        />
                        <p className="text-xs text-muted-foreground mt-1">{form.title.length}/120</p>
                      </div>

                      <div>
                        <Label className="text-sm font-semibold">Descripcion breve</Label>
                        <Textarea
                          placeholder="Describe brevemente tu producto o servicio..."
                          value={form.description}
                          onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                          rows={2}
                          className="mt-1.5"
                          data-testid="input-description"
                        />
                      </div>

                      <Separator />

                      <div>
                        <Label className="text-sm font-semibold flex items-center gap-1.5">
                          <Link className="h-4 w-4 text-primary" />
                          Enlace de destino
                        </Label>
                        <p className="text-xs text-muted-foreground mb-2">A donde quieres que lleguen los usuarios al hacer clic</p>

                        <div className="space-y-3">
                          <div className="flex items-center gap-2 p-3 rounded-lg border bg-green-500/5 border-green-500/20">
                            <Phone className="h-5 w-5 text-green-500 flex-shrink-0" />
                            <div className="flex-1">
                              <p className="text-sm font-medium text-green-700 dark:text-green-400">WhatsApp</p>
                              <Input
                                placeholder="+51 999 999 999"
                                value={form.whatsappNumber}
                                onChange={(e) => setForm(f => ({ ...f, whatsappNumber: e.target.value, targetUrl: "" }))}
                                className="mt-1 bg-background"
                                data-testid="input-whatsapp"
                              />
                            </div>
                          </div>

                          <div className="text-center text-xs text-muted-foreground">o</div>

                          <div>
                            <Input
                              placeholder="https://www.tuempresa.com"
                              value={form.targetUrl}
                              onChange={(e) => setForm(f => ({ ...f, targetUrl: e.target.value, whatsappNumber: "" }))}
                              disabled={!!form.whatsappNumber}
                              data-testid="input-target-url"
                            />
                          </div>
                        </div>
                      </div>

                      <Separator />

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <Label className="text-sm font-semibold">Keywords</Label>
                          <Input
                            placeholder="tecnologia, programacion, ia"
                            value={form.keywords}
                            onChange={(e) => setForm(f => ({ ...f, keywords: e.target.value }))}
                            className="mt-1.5"
                            data-testid="input-keywords"
                          />
                          <p className="text-xs text-muted-foreground mt-1">El anuncio se muestra cuando consulten estos temas</p>
                        </div>
                        <div>
                          <Label className="text-sm font-semibold">Categoria</Label>
                          <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                            <SelectTrigger className="mt-1.5" data-testid="select-category">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CATEGORIES.map(c => (
                                <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {wizardStep === 1 && (
                <div className="space-y-6" data-testid="step-objective">
                  <div>
                    <h2 className="text-xl font-bold mb-1 flex items-center gap-2">
                      <Target className="h-5 w-5 text-primary" />
                      Objetivo
                    </h2>
                    <p className="text-muted-foreground text-sm">Que resultados te gustaria obtener con este anuncio?</p>
                  </div>

                  <div className="space-y-3">
                    {OBJECTIVES.map((obj) => {
                      const Icon = obj.icon;
                      const selected = form.objective === obj.id;
                      return (
                        <button
                          key={obj.id}
                          onClick={() => setForm(f => ({ ...f, objective: obj.id }))}
                          className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                            selected ? "border-primary bg-primary/5 shadow-sm" : "border-border hover:border-muted-foreground/30 hover:bg-muted/30"
                          }`}
                          data-testid={`objective-${obj.id}`}
                        >
                          <div className="flex items-start gap-3">
                            <div className={`p-2 rounded-lg ${selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                              <Icon className="h-5 w-5" />
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{obj.title}</span>
                                {obj.recommended && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Recomendado</Badge>}
                              </div>
                              <p className="text-sm text-muted-foreground mt-0.5">{obj.desc}</p>
                            </div>
                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${selected ? "border-primary" : "border-muted-foreground/30"}`}>
                              {selected && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {form.objective === "automatic" && (
                    <Card className="bg-blue-500/5 border-blue-500/20">
                      <CardContent className="p-4 flex gap-3 items-start">
                        <Info className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-blue-600 dark:text-blue-400">Automatico — Recibir mas mensajes</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Seleccionamos el objetivo <strong>Recibir mas mensajes</strong> en funcion de tu actividad anterior.
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}

              {wizardStep === 2 && (
                <div className="space-y-6" data-testid="step-audience">
                  <div>
                    <h2 className="text-xl font-bold mb-1 flex items-center gap-2">
                      <Users className="h-5 w-5 text-primary" />
                      Publico
                    </h2>
                    <p className="text-muted-foreground text-sm">Quien quieres que vea tu anuncio?</p>
                  </div>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Caracteristicas del publico</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-5">
                      <div>
                        <Label className="flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5" /> Lugar
                        </Label>
                        <Select value={form.targetCountry} onValueChange={v => setForm(f => ({ ...f, targetCountry: v }))}>
                          <SelectTrigger className="mt-1.5" data-testid="select-country">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {COUNTRIES.map(c => (
                              <SelectItem key={c.code} value={c.code}>{c.flag} {c.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <Separator />

                      <div>
                        <Label>Edad minima: {form.minAge}</Label>
                        <Slider
                          value={[form.minAge]}
                          onValueChange={([v]) => setForm(f => ({ ...f, minAge: v }))}
                          min={13} max={65} step={1}
                          className="mt-2"
                          data-testid="slider-min-age"
                        />
                      </div>

                      <div>
                        <Label>Edad maxima: {form.maxAge}+</Label>
                        <Slider
                          value={[form.maxAge]}
                          onValueChange={([v]) => setForm(f => ({ ...f, maxAge: v }))}
                          min={18} max={65} step={1}
                          className="mt-2"
                          data-testid="slider-max-age"
                        />
                      </div>

                      <Separator />

                      <div>
                        <Label>Genero</Label>
                        <div className="flex gap-2 mt-2">
                          {[
                            { value: "all", label: "Todos" },
                            { value: "male", label: "Masculino" },
                            { value: "female", label: "Femenino" },
                          ].map(g => (
                            <button
                              key={g.value}
                              onClick={() => setForm(f => ({ ...f, gender: g.value }))}
                              className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
                                form.gender === g.value ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-muted-foreground/30"
                              }`}
                              data-testid={`gender-${g.value}`}
                            >
                              {g.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <Separator />

                      <div className="flex items-center justify-between">
                        <div>
                          <Label className="flex items-center gap-1.5">
                            <Zap className="h-3.5 w-3.5 text-yellow-500" />
                            Publico Advantage+
                          </Label>
                          <p className="text-xs text-muted-foreground mt-0.5">Amplia tu publico automaticamente para mejorar rendimiento</p>
                        </div>
                        <Switch checked={form.advantagePlus} onCheckedChange={v => setForm(f => ({ ...f, advantagePlus: v }))} data-testid="switch-advantage-plus" />
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Radio className="h-4 w-4" /> Ubicaciones
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {[
                        { id: "in_chat", label: "Dentro del chat", desc: "Debajo de copiar/like/dislike en las respuestas de IA", locked: true },
                        { id: "sidebar", label: "Barra lateral", desc: "Panel de navegacion lateral" },
                        { id: "dashboard", label: "Dashboard", desc: "Pagina principal" },
                      ].map(p => (
                        <div key={p.id} className="flex items-center justify-between p-3 rounded-lg border">
                          <div>
                            <p className="text-sm font-medium">{p.label}</p>
                            <p className="text-xs text-muted-foreground">{p.desc}</p>
                          </div>
                          <Switch
                            checked={form.placements.includes(p.id)}
                            onCheckedChange={checked => setForm(f => ({
                              ...f, placements: checked ? [...f.placements, p.id] : f.placements.filter(x => x !== p.id),
                            }))}
                            disabled={p.locked}
                            data-testid={`placement-${p.id}`}
                          />
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                </div>
              )}

              {wizardStep === 3 && (
                <div className="space-y-6" data-testid="step-budget">
                  <div>
                    <h2 className="text-xl font-bold mb-1 flex items-center gap-2">
                      <DollarSign className="h-5 w-5 text-primary" />
                      Presupuesto y duracion
                    </h2>
                    <p className="text-muted-foreground text-sm">Define cuanto invertir y por cuanto tiempo</p>
                  </div>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Calendar className="h-4 w-4" /> Duracion
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex gap-2">
                        {[3, 5, 7, 14, 30].map(d => (
                          <button
                            key={d}
                            onClick={() => setForm(f => ({ ...f, durationDays: d }))}
                            className={`flex-1 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                              form.durationDays === d ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-muted-foreground/30"
                            }`}
                            data-testid={`duration-${d}`}
                          >
                            {d} dias
                          </button>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Presupuesto diario</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-5">
                      {estimate && (
                        <div className="text-center p-3 rounded-lg bg-primary/5">
                          <p className="text-sm font-medium text-primary">
                            Impresiones estimadas: {formatNumber(estimate.daily.min)} - {formatNumber(estimate.daily.max)} por dia
                          </p>
                        </div>
                      )}

                      <div className="text-center">
                        <div className="flex items-center justify-center gap-1 mb-4">
                          <span className="text-muted-foreground text-xl">S/</span>
                          <Input
                            type="number"
                            value={form.dailyBudget}
                            onChange={e => setForm(f => ({ ...f, dailyBudget: parseFloat(e.target.value) || 0 }))}
                            className="w-32 text-center text-3xl font-bold h-14 border-none shadow-none"
                            step={0.5} min={0.5} max={500}
                            data-testid="input-daily-budget"
                          />
                        </div>
                        <Slider
                          value={[form.dailyBudget]}
                          onValueChange={([v]) => setForm(f => ({ ...f, dailyBudget: Math.round(v * 10) / 10 }))}
                          min={0.5} max={500} step={0.5}
                          className="mb-2"
                          data-testid="slider-budget"
                        />
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>S/0,50</span>
                          <span>S/500,00</span>
                        </div>
                      </div>

                      {estimate && (
                        <p className="text-xs text-muted-foreground flex items-start gap-1.5 p-3 rounded-lg bg-muted/50">
                          <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-blue-500" />
                          {estimate.recommendation.label}
                        </p>
                      )}

                      <Separator />

                      <div className="flex items-center justify-between p-3 rounded-lg border">
                        <div className="flex items-center gap-2">
                          <CreditCard className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">Metodo de pago de consumo</p>
                            <p className="text-xs text-muted-foreground">Cada impresion: <strong>0.1 centimos</strong></p>
                          </div>
                        </div>
                        <Badge variant="outline">Por impresion</Badge>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {wizardStep === 4 && (
                <div className="space-y-6" data-testid="step-review">
                  <div>
                    <h2 className="text-xl font-bold mb-1 flex items-center gap-2">
                      <CheckCircle2 className="h-5 w-5 text-primary" />
                      Revision y publicacion
                    </h2>
                    <p className="text-muted-foreground text-sm">Revisa tu anuncio antes de publicarlo</p>
                  </div>

                  <Card className="overflow-hidden">
                    <div className="p-4 bg-muted/30 border-b">
                      <p className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                        <Megaphone className="h-3 w-3" /> Publicidad — Vista previa
                      </p>
                    </div>
                    <CardContent className="p-5">
                      <div className="flex gap-4 items-start">
                        {(imagePreview || form.imageUrl) && (
                          <img src={imagePreview || form.imageUrl} alt="Ad" className="w-24 h-24 rounded-xl object-cover flex-shrink-0 shadow-sm" />
                        )}
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-lg">{form.title || "Sin titulo"}</h3>
                          <p className="text-sm text-muted-foreground mt-1">{form.description || "Sin descripcion"}</p>
                          <p className="text-xs text-muted-foreground/60 mt-2">{form.advertiser}</p>
                          {form.whatsappNumber && (
                            <div className="flex items-center gap-1 mt-2 text-xs text-green-600">
                              <Phone className="h-3 w-3" />
                              <span>WhatsApp: {form.whatsappNumber}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Card>
                      <CardContent className="p-4 space-y-2">
                        <h4 className="font-medium text-sm flex items-center gap-2"><Target className="h-4 w-4" /> Objetivo</h4>
                        <p className="text-sm text-muted-foreground">{OBJECTIVES.find(o => o.id === form.objective)?.title}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-4 space-y-2">
                        <h4 className="font-medium text-sm flex items-center gap-2"><Users className="h-4 w-4" /> Publico</h4>
                        <div className="text-sm text-muted-foreground space-y-0.5">
                          <p>{COUNTRIES.find(c => c.code === form.targetCountry)?.flag} {COUNTRIES.find(c => c.code === form.targetCountry)?.name}</p>
                          <p>Edad: {form.minAge} - {form.maxAge}+</p>
                          {form.advantagePlus && <Badge variant="secondary" className="text-[10px]">Advantage+</Badge>}
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-4 space-y-2">
                        <h4 className="font-medium text-sm flex items-center gap-2"><DollarSign className="h-4 w-4" /> Presupuesto</h4>
                        <div className="text-sm text-muted-foreground space-y-0.5">
                          <p>S/{form.dailyBudget.toFixed(2)} / dia x {form.durationDays} dias</p>
                          <p className="font-semibold text-foreground">Total: S/{totalBudget.toFixed(2)}</p>
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-4 space-y-2">
                        <h4 className="font-medium text-sm flex items-center gap-2"><CreditCard className="h-4 w-4" /> Cobro</h4>
                        <div className="text-sm text-muted-foreground space-y-0.5">
                          <p>0.1 centimos por impresion</p>
                          {estimate && <p>~{formatNumber(estimate.total.min)} - {formatNumber(estimate.total.max)} impresiones totales</p>}
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  <Button size="lg" className="w-full h-14 text-base" onClick={handleCreate} data-testid="button-publish-ad">
                    <Megaphone className="h-5 w-5 mr-2" />
                    Publicar anuncio — S/{totalBudget.toFixed(2)}
                  </Button>
                  <p className="text-xs text-center text-muted-foreground">
                    Tu anuncio comenzara a mostrarse a millones de usuarios de IliaGPT inmediatamente
                  </p>
                </div>
              )}
            </div>

            <div className="hidden lg:block">
              <div className="sticky top-20 space-y-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-1.5">
                      <Eye className="h-3.5 w-3.5" /> Asi se vera tu anuncio
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="bg-muted/20 rounded-lg p-2 mb-2">
                      <div className="flex gap-2 mb-2">
                        <div className="h-2 w-2 rounded bg-muted-foreground/20" />
                        <div className="h-2 w-2 rounded bg-muted-foreground/20" />
                        <div className="h-2 w-2 rounded bg-muted-foreground/20" />
                      </div>
                      <p className="text-[9px] text-muted-foreground/40 mb-1">Copiar · Like · Dislike</p>
                    </div>

                    <div className="rounded-lg border bg-muted/30 p-3">
                      <div className="flex items-center gap-1 mb-1.5">
                        <Megaphone className="h-2.5 w-2.5 text-muted-foreground/60" />
                        <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-medium">Publicidad</span>
                      </div>
                      <div className="flex gap-2 items-start">
                        {(imagePreview || form.imageUrl) ? (
                          <img src={imagePreview || form.imageUrl} alt="Preview" className="w-12 h-12 rounded object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-12 h-12 rounded bg-muted flex items-center justify-center flex-shrink-0">
                            <ImageIcon className="h-5 w-5 text-muted-foreground/30" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">{form.title || "Titulo del anuncio"}</p>
                          <p className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5">{form.description || "Descripcion..."}</p>
                          <p className="text-[9px] text-muted-foreground/50 mt-1">{form.advertiser || "Tu negocio"}</p>
                        </div>
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground/40 mt-2 text-center">Debajo de cada respuesta de la IA</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-4 space-y-2">
                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Resumen</h4>
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between"><span className="text-muted-foreground">Diario</span><span className="font-medium">S/{form.dailyBudget.toFixed(2)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Duracion</span><span className="font-medium">{form.durationDays} dias</span></div>
                      <Separator />
                      <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="font-bold text-primary">S/{totalBudget.toFixed(2)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Costo/imp</span><span className="font-medium">0.1 cent.</span></div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>

          <div className="flex justify-between mt-8 pt-6 border-t">
            <Button variant="outline" onClick={() => setWizardStep(s => Math.max(0, s - 1))} disabled={wizardStep === 0} data-testid="button-wizard-prev">
              <ChevronLeft className="h-4 w-4 mr-1" /> Anterior
            </Button>
            {wizardStep < STEPS.length - 1 && (
              <Button onClick={() => setWizardStep(s => s + 1)} disabled={!canAdvance} data-testid="button-wizard-next">
                Siguiente <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
          </div>
        </div>
      )}

      {view === "ads" && (
        <div className="max-w-5xl mx-auto px-4 py-6">
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
              {[
                { icon: BarChart3, value: stats.totalAds, label: "Anuncios", color: "text-blue-500", id: "total-ads" },
                { icon: Target, value: stats.activeAds, label: "Activos", color: "text-green-500", id: "active-ads" },
                { icon: Eye, value: formatNumber(stats.totalImpressions), label: "Impresiones", color: "text-purple-500", id: "impressions" },
                { icon: MousePointer, value: formatNumber(stats.totalClicks), label: "Clics", color: "text-orange-500", id: "clicks" },
                { icon: MessageCircle, value: formatNumber(stats.totalMessages), label: "Mensajes", color: "text-cyan-500", id: "messages" },
                { icon: DollarSign, value: `S/${stats.totalSpentSoles}`, label: "Gastado", color: "text-yellow-500", id: "spent" },
                { icon: TrendingUp, value: `${stats.ctr}%`, label: "CTR", color: "text-rose-500", id: "ctr" },
                { icon: CreditCard, value: `S/${stats.avgCostPerClick}`, label: "CPC", color: "text-indigo-500", id: "cpc" },
              ].map(m => (
                <Card key={m.id}>
                  <CardContent className="p-3 text-center">
                    <m.icon className={`h-4 w-4 mx-auto mb-1 ${m.color}`} />
                    <p className="text-lg font-bold" data-testid={`text-${m.id}`}>{m.value}</p>
                    <p className="text-[10px] text-muted-foreground">{m.label}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {loading ? (
            <div className="space-y-3">
              {[1, 2].map(i => <div key={i} className="h-24 bg-muted rounded-lg animate-pulse" />)}
            </div>
          ) : ads.length === 0 ? (
            <div className="text-center py-16">
              <div className="p-4 rounded-full bg-gradient-to-br from-blue-500/10 to-purple-600/10 w-fit mx-auto mb-4">
                <Megaphone className="h-12 w-12 text-blue-500/40" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Aun no tienes anuncios</h3>
              <p className="text-sm text-muted-foreground mb-6">Crea tu primer anuncio para promocionar tu negocio</p>
              <Button size="lg" onClick={() => { setView("wizard"); setWizardStep(0); resetForm(); }} data-testid="button-first-ad">
                <Megaphone className="h-4 w-4 mr-2" /> Promocionar publicacion
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {ads.map((ad) => {
                const budgetUsed = ad.totalBudget ? Math.min(((ad.costSpent || 0) / ad.totalBudget) * 100, 100) : 0;
                return (
                  <Card key={ad.id} className={`transition-all ${!ad.active ? "opacity-60" : ""}`} data-testid={`card-ad-${ad.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start gap-4">
                        {ad.imageUrl ? (
                          <img src={ad.imageUrl} alt={ad.title} className="w-16 h-16 rounded-lg object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                            <ImageIcon className="h-6 w-6 text-muted-foreground/30" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-medium truncate">{ad.title}</h3>
                            <Badge variant={ad.active ? "default" : "secondary"} className="text-[10px]">{ad.active ? "Activo" : "Pausado"}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground line-clamp-1">{ad.description}</p>
                          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                            <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{formatNumber(ad.impressions || 0)}</span>
                            <span className="flex items-center gap-1"><MousePointer className="h-3 w-3" />{formatNumber(ad.clicks || 0)}</span>
                            <span className="flex items-center gap-1"><DollarSign className="h-3 w-3" />S/{(ad as any).costSpentSoles || "0.00"}</span>
                            <span className="flex items-center gap-1"><Globe className="h-3 w-3" />{COUNTRIES.find(c => c.code === ad.targetCountry)?.flag} {ad.targetCountry}</span>
                          </div>
                          {ad.totalBudget && ad.totalBudget > 0 && (
                            <div className="mt-2">
                              <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
                                <span>Presupuesto</span><span>{budgetUsed.toFixed(0)}%</span>
                              </div>
                              <Progress value={budgetUsed} className="h-1" />
                            </div>
                          )}
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => toggleAd(ad.id, ad.active)} data-testid={`button-toggle-ad-${ad.id}`}>
                            {ad.active ? <Pause className="h-4 w-4 text-yellow-500" /> : <Play className="h-4 w-4 text-green-500" />}
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-600" onClick={() => deleteAd(ad.id)} data-testid={`button-delete-ad-${ad.id}`}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          <div className="mt-8 p-4 rounded-lg border border-dashed border-muted-foreground/20 bg-muted/20">
            <div className="flex items-start gap-3">
              <Info className="h-4 w-4 text-muted-foreground/50 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-muted-foreground/60 space-y-1">
                <p><strong>IliaADS:</strong> Anuncios contextuales debajo de copiar/like/dislike en cada respuesta de IA.</p>
                <p>Algoritmo: muestra el anuncio mas relevante segun la consulta del usuario + keywords.</p>
                <p>Cobro: <strong>0.1 centimos por impresion</strong> | Target: Peru, 18+, Advantage+ activado.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
