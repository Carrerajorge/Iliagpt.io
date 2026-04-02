import { useState, useEffect, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import {
  ArrowLeft, Plus, Megaphone, Eye, MousePointer, ToggleLeft, ToggleRight,
  Trash2, BarChart3, Target, Globe, DollarSign, ChevronRight, ChevronLeft,
  MessageCircle, Zap, Users, Calendar, CreditCard, MapPin, Clock,
  TrendingUp, CheckCircle2, Radio, Image, Sparkles, Info, Settings,
  ArrowUpRight, Pause, Play, AlertCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  startDate?: string | null;
  endDate?: string | null;
  placements: string[];
  paymentMethod: string;
  currency: string;
  createdAt: string;
  costSpentSoles?: string;
  estimatedDaily?: { min: number; max: number };
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
  currency: string;
  symbol: string;
}

const OBJECTIVES = [
  {
    id: "automatic",
    title: "Automatico",
    desc: "IliaADS elige el mejor resultado en base a tu actividad anterior",
    icon: Sparkles,
    recommended: true,
  },
  {
    id: "messages",
    title: "Recibir mas mensajes",
    desc: "Obtener mas interacciones directas con usuarios",
    icon: MessageCircle,
    recommended: false,
  },
  {
    id: "traffic",
    title: "Mas visitas al enlace",
    desc: "Dirigir trafico a tu sitio web o landing page",
    icon: ArrowUpRight,
    recommended: false,
  },
  {
    id: "awareness",
    title: "Reconocimiento",
    desc: "Mostrar tu marca a la mayor cantidad de personas",
    icon: Eye,
    recommended: false,
  },
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

const WIZARD_STEPS = [
  { id: "publication", label: "Publicacion", icon: Image },
  { id: "objective", label: "Objetivo", icon: Target },
  { id: "audience", label: "Publico", icon: Users },
  { id: "budget", label: "Presupuesto", icon: DollarSign },
  { id: "review", label: "Revision", icon: CheckCircle2 },
];

function formatNumber(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + " M";
  if (n >= 1000) return (n / 1000).toFixed(1) + " mil";
  return n.toString();
}

export default function IliaAdsPage() {
  const [, setLocation] = useLocation();
  const [ads, setAds] = useState<Ad[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [activeTab, setActiveTab] = useState("dashboard");
  const { toast } = useToast();

  const [form, setForm] = useState({
    title: "",
    description: "",
    imageUrl: "",
    targetUrl: "",
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
    try {
      const [adsRes, statsRes] = await Promise.all([
        fetch("/api/ads/list"),
        fetch("/api/ads/stats"),
      ]);
      if (adsRes.ok) {
        const adsData = await adsRes.json();
        setAds(adsData.ads || []);
      }
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData.summary || null);
      }
    } catch (e) {
      console.error("Error fetching ads:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAds();
  }, [fetchAds]);

  useEffect(() => {
    if (!showWizard) return;
    const fetchEstimate = async () => {
      try {
        const res = await fetch(
          `/api/ads/estimate?budget=${form.dailyBudget}&category=${form.category}&days=${form.durationDays}`
        );
        if (res.ok) setEstimate(await res.json());
      } catch {}
    };
    fetchEstimate();
  }, [form.dailyBudget, form.category, form.durationDays, showWizard]);

  const totalBudget = useMemo(() => form.dailyBudget * form.durationDays, [form.dailyBudget, form.durationDays]);

  const handleCreate = async () => {
    try {
      const res = await fetch("/api/ads/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          dailyBudget: form.dailyBudget,
          keywords: form.keywords.split(",").map(k => k.trim()).filter(Boolean),
          imageUrl: form.imageUrl || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ? JSON.stringify(err.error) : "Error creating ad");
      }
      toast({ title: "Anuncio creado exitosamente", description: "Tu anuncio esta activo y comenzara a mostrarse." });
      setShowWizard(false);
      setWizardStep(0);
      resetForm();
      fetchAds();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const resetForm = () => {
    setForm({
      title: "", description: "", imageUrl: "", targetUrl: "", advertiser: "",
      keywords: "", category: "general", objective: "automatic", dailyBudget: 3.5,
      durationDays: 7, targetCountry: "PE", minAge: 18, maxAge: 65,
      gender: "all", advantagePlus: true, placements: ["in_chat"],
      paymentMethod: "per_impression",
    });
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
      case 0: return form.title && form.description && form.targetUrl && form.advertiser;
      case 1: return !!form.objective;
      case 2: return !!form.targetCountry;
      case 3: return form.dailyBudget >= 0.5;
      case 4: return true;
      default: return false;
    }
  }, [wizardStep, form]);

  if (showWizard) {
    return (
      <div className="min-h-screen bg-background" data-testid="wizard-container">
        <div className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
          <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => { setShowWizard(false); setWizardStep(0); }} data-testid="button-wizard-back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <Megaphone className="h-5 w-5 text-primary" />
            <span className="font-semibold">Promocionar publicacion</span>
            <div className="ml-auto flex items-center gap-2">
              {WIZARD_STEPS.map((step, i) => (
                <div key={step.id} className="flex items-center gap-1">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
                      i < wizardStep ? "bg-primary text-primary-foreground" :
                      i === wizardStep ? "bg-primary text-primary-foreground ring-2 ring-primary/30" :
                      "bg-muted text-muted-foreground"
                    }`}
                  >
                    {i < wizardStep ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                  </div>
                  {i < WIZARD_STEPS.length - 1 && (
                    <div className={`w-6 h-0.5 ${i < wizardStep ? "bg-primary" : "bg-muted"}`} />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2">
              {wizardStep === 0 && (
                <div className="space-y-6" data-testid="step-publication">
                  <div>
                    <h2 className="text-xl font-bold mb-1">Crear publicacion</h2>
                    <p className="text-muted-foreground text-sm">Configura el contenido de tu anuncio</p>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <Label>Nombre del negocio</Label>
                      <Input
                        placeholder="Mi Empresa S.A.C."
                        value={form.advertiser}
                        onChange={(e) => setForm(f => ({ ...f, advertiser: e.target.value }))}
                        className="mt-1.5"
                        data-testid="input-advertiser"
                      />
                    </div>

                    <div>
                      <Label>Titulo del anuncio</Label>
                      <Input
                        placeholder="Titulo atractivo para tu anuncio"
                        value={form.title}
                        onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))}
                        maxLength={120}
                        className="mt-1.5"
                        data-testid="input-title"
                      />
                      <p className="text-xs text-muted-foreground mt-1">{form.title.length}/120 caracteres</p>
                    </div>

                    <div>
                      <Label>Descripcion</Label>
                      <Textarea
                        placeholder="Breve descripcion de lo que promocionas..."
                        value={form.description}
                        onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                        rows={3}
                        className="mt-1.5"
                        data-testid="input-description"
                      />
                      <p className="text-xs text-muted-foreground mt-1">Se mostrara debajo de la imagen del anuncio</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label>URL de destino</Label>
                        <Input
                          placeholder="https://www.tuempresa.com"
                          value={form.targetUrl}
                          onChange={(e) => setForm(f => ({ ...f, targetUrl: e.target.value }))}
                          className="mt-1.5"
                          data-testid="input-target-url"
                        />
                      </div>
                      <div>
                        <Label>Imagen del anuncio (URL)</Label>
                        <Input
                          placeholder="https://... (opcional)"
                          value={form.imageUrl}
                          onChange={(e) => setForm(f => ({ ...f, imageUrl: e.target.value }))}
                          className="mt-1.5"
                          data-testid="input-image-url"
                        />
                      </div>
                    </div>

                    {form.imageUrl && (
                      <div className="rounded-lg border overflow-hidden max-w-xs">
                        <img src={form.imageUrl} alt="Preview" className="w-full h-40 object-cover" />
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label>Keywords (separadas por coma)</Label>
                        <Input
                          placeholder="tecnologia, programacion, ia, software"
                          value={form.keywords}
                          onChange={(e) => setForm(f => ({ ...f, keywords: e.target.value }))}
                          className="mt-1.5"
                          data-testid="input-keywords"
                        />
                        <p className="text-xs text-muted-foreground mt-1">El algoritmo mostrara el anuncio cuando el usuario consulte sobre estos temas</p>
                      </div>
                      <div>
                        <Label>Categoria</Label>
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
                  </div>
                </div>
              )}

              {wizardStep === 1 && (
                <div className="space-y-6" data-testid="step-objective">
                  <div>
                    <h2 className="text-xl font-bold mb-1">Objetivo</h2>
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
                            selected
                              ? "border-primary bg-primary/5 shadow-sm"
                              : "border-border hover:border-muted-foreground/30 hover:bg-muted/30"
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
                                {obj.recommended && (
                                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Recomendado</Badge>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground mt-0.5">{obj.desc}</p>
                            </div>
                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                              selected ? "border-primary" : "border-muted-foreground/30"
                            }`}>
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
                          <p className="text-sm font-medium text-blue-600 dark:text-blue-400">Automatico - Recibir mas mensajes</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Seleccionamos el objetivo <strong>Recibir mas mensajes</strong> en funcion de tu actividad anterior.
                            El algoritmo optimizara la entrega para maximizar las interacciones.
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
                    <h2 className="text-xl font-bold mb-1">Publico</h2>
                    <p className="text-muted-foreground text-sm">Quien quieres que vea tu anuncio?</p>
                  </div>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Users className="h-4 w-4" />
                        Caracteristicas del publico
                      </CardTitle>
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
                              <SelectItem key={c.code} value={c.code}>
                                {c.flag} {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <Separator />

                      <div>
                        <Label>Edad</Label>
                        <div className="flex items-center gap-4 mt-2">
                          <div className="flex-1">
                            <p className="text-xs text-muted-foreground mb-1.5">Minima</p>
                            <div className="flex items-center gap-2">
                              <Slider
                                value={[form.minAge]}
                                onValueChange={([v]) => setForm(f => ({ ...f, minAge: v }))}
                                min={13}
                                max={65}
                                step={1}
                                data-testid="slider-min-age"
                              />
                              <span className="text-sm font-medium w-8 text-right">{form.minAge}</span>
                            </div>
                          </div>
                          <div className="flex-1">
                            <p className="text-xs text-muted-foreground mb-1.5">Maxima</p>
                            <div className="flex items-center gap-2">
                              <Slider
                                value={[form.maxAge]}
                                onValueChange={([v]) => setForm(f => ({ ...f, maxAge: v }))}
                                min={18}
                                max={65}
                                step={1}
                                data-testid="slider-max-age"
                              />
                              <span className="text-sm font-medium w-8 text-right">{form.maxAge}+</span>
                            </div>
                          </div>
                        </div>
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
                                form.gender === g.value
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border hover:border-muted-foreground/30"
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
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Permite que IliaADS amplíe tu publico automaticamente para mejorar el rendimiento
                          </p>
                        </div>
                        <Switch
                          checked={form.advantagePlus}
                          onCheckedChange={v => setForm(f => ({ ...f, advantagePlus: v }))}
                          data-testid="switch-advantage-plus"
                        />
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Radio className="h-4 w-4" />
                        Ubicaciones
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {[
                        { id: "in_chat", label: "Dentro del chat", desc: "Debajo de las respuestas de IA (copiar/like/dislike)", default: true },
                        { id: "sidebar", label: "Barra lateral", desc: "Panel lateral de navegacion" },
                        { id: "dashboard", label: "Dashboard", desc: "Pagina principal del dashboard" },
                      ].map(p => (
                        <div key={p.id} className="flex items-center justify-between p-3 rounded-lg border">
                          <div>
                            <p className="text-sm font-medium">{p.label}</p>
                            <p className="text-xs text-muted-foreground">{p.desc}</p>
                          </div>
                          <Switch
                            checked={form.placements.includes(p.id)}
                            onCheckedChange={checked => {
                              setForm(f => ({
                                ...f,
                                placements: checked
                                  ? [...f.placements, p.id]
                                  : f.placements.filter(x => x !== p.id),
                              }));
                            }}
                            disabled={p.id === "in_chat"}
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
                    <h2 className="text-xl font-bold mb-1">Presupuesto y duracion</h2>
                    <p className="text-muted-foreground text-sm">Define cuanto quieres invertir y por cuanto tiempo</p>
                  </div>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Calendar className="h-4 w-4" />
                        Duracion
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex gap-2">
                        {[3, 5, 7, 14, 30].map(d => (
                          <button
                            key={d}
                            onClick={() => setForm(f => ({ ...f, durationDays: d }))}
                            className={`flex-1 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                              form.durationDays === d
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border hover:border-muted-foreground/30"
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
                      <CardTitle className="text-base flex items-center gap-2">
                        <DollarSign className="h-4 w-4" />
                        Presupuesto diario
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-5">
                      <div className="text-center">
                        <div className="flex items-center justify-center gap-1 mb-3">
                          <span className="text-muted-foreground text-lg">S/</span>
                          <Input
                            type="number"
                            value={form.dailyBudget}
                            onChange={e => setForm(f => ({ ...f, dailyBudget: parseFloat(e.target.value) || 0 }))}
                            className="w-28 text-center text-2xl font-bold h-12 border-none shadow-none"
                            step={0.5}
                            min={0.5}
                            max={500}
                            data-testid="input-daily-budget"
                          />
                        </div>
                        <Slider
                          value={[form.dailyBudget]}
                          onValueChange={([v]) => setForm(f => ({ ...f, dailyBudget: Math.round(v * 10) / 10 }))}
                          min={0.5}
                          max={500}
                          step={0.5}
                          className="mb-2"
                          data-testid="slider-budget"
                        />
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>S/0,50</span>
                          <span>S/500,00</span>
                        </div>
                      </div>

                      {estimate && (
                        <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                          <div className="flex items-center gap-2 text-sm">
                            <Eye className="h-4 w-4 text-primary" />
                            <span className="font-medium">Impresiones estimadas:</span>
                            <span className="text-primary font-semibold">
                              {formatNumber(estimate.daily.min)} - {formatNumber(estimate.daily.max)} por dia
                            </span>
                          </div>
                          <Separator />
                          <div className="flex items-center gap-2 text-sm">
                            <TrendingUp className="h-4 w-4 text-green-500" />
                            <span className="font-medium">Total estimado ({form.durationDays} dias):</span>
                            <span className="text-green-600 dark:text-green-400 font-semibold">
                              {formatNumber(estimate.total.min)} - {formatNumber(estimate.total.max)}
                            </span>
                          </div>
                          <Separator />
                          <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                            <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-blue-500" />
                            {estimate.recommendation.label}
                          </p>
                        </div>
                      )}

                      <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                        <div className="flex items-center gap-2">
                          <CreditCard className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">Metodo de cobro</p>
                            <p className="text-xs text-muted-foreground">Cada impresion: 0.1 centimos</p>
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
                    <h2 className="text-xl font-bold mb-1">Revision del anuncio</h2>
                    <p className="text-muted-foreground text-sm">Revisa todos los detalles antes de publicar</p>
                  </div>

                  <Card>
                    <CardContent className="p-5 space-y-4">
                      <div className="flex items-start gap-4">
                        {form.imageUrl && (
                          <img src={form.imageUrl} alt="Preview" className="w-20 h-20 rounded-lg object-cover" />
                        )}
                        <div className="flex-1">
                          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
                            <Megaphone className="h-3 w-3" /> Publicidad
                          </p>
                          <h3 className="font-semibold text-lg">{form.title || "Sin titulo"}</h3>
                          <p className="text-sm text-muted-foreground mt-1">{form.description || "Sin descripcion"}</p>
                          <p className="text-xs text-muted-foreground/60 mt-2">{form.advertiser}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Card>
                      <CardContent className="p-4 space-y-3">
                        <h4 className="font-medium flex items-center gap-2 text-sm">
                          <Target className="h-4 w-4" /> Objetivo
                        </h4>
                        <p className="text-sm text-muted-foreground">
                          {OBJECTIVES.find(o => o.id === form.objective)?.title || form.objective}
                        </p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-4 space-y-3">
                        <h4 className="font-medium flex items-center gap-2 text-sm">
                          <Users className="h-4 w-4" /> Publico
                        </h4>
                        <div className="text-sm text-muted-foreground space-y-1">
                          <p>{COUNTRIES.find(c => c.code === form.targetCountry)?.flag} {COUNTRIES.find(c => c.code === form.targetCountry)?.name || form.targetCountry}</p>
                          <p>Edad: {form.minAge} - {form.maxAge}+</p>
                          <p>Genero: {form.gender === "all" ? "Todos" : form.gender === "male" ? "Masculino" : "Femenino"}</p>
                          {form.advantagePlus && <Badge variant="secondary" className="text-[10px]">Advantage+</Badge>}
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-4 space-y-3">
                        <h4 className="font-medium flex items-center gap-2 text-sm">
                          <DollarSign className="h-4 w-4" /> Presupuesto
                        </h4>
                        <div className="text-sm text-muted-foreground space-y-1">
                          <p>S/{form.dailyBudget.toFixed(2)} / dia</p>
                          <p>Total: S/{totalBudget.toFixed(2)} ({form.durationDays} dias)</p>
                          <p className="text-xs">Cobro: 0.1 centimos por impresion</p>
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-4 space-y-3">
                        <h4 className="font-medium flex items-center gap-2 text-sm">
                          <Radio className="h-4 w-4" /> Ubicaciones
                        </h4>
                        <div className="text-sm text-muted-foreground space-y-1">
                          {form.placements.map(p => (
                            <p key={p}>{p === "in_chat" ? "Dentro del chat" : p === "sidebar" ? "Barra lateral" : "Dashboard"}</p>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {estimate && (
                    <Card className="bg-green-500/5 border-green-500/20">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                          <TrendingUp className="h-5 w-5 text-green-500" />
                          <div>
                            <p className="text-sm font-medium text-green-600 dark:text-green-400">
                              Impresiones estimadas: {formatNumber(estimate.daily.min)} - {formatNumber(estimate.daily.max)} por dia
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Total: {formatNumber(estimate.total.min)} - {formatNumber(estimate.total.max)} en {form.durationDays} dias
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  <Button
                    size="lg"
                    className="w-full"
                    onClick={handleCreate}
                    data-testid="button-publish-ad"
                  >
                    <Megaphone className="h-4 w-4 mr-2" />
                    Publicar anuncio - S/{totalBudget.toFixed(2)} total
                  </Button>
                </div>
              )}
            </div>

            <div className="hidden lg:block">
              <div className="sticky top-20 space-y-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Vista previa</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="rounded-lg border bg-muted/30 p-3 max-w-[260px]">
                      <div className="flex items-center gap-1 mb-1.5">
                        <Megaphone className="h-2.5 w-2.5 text-muted-foreground/60" />
                        <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-medium">
                          Publicidad
                        </span>
                      </div>
                      <div className="flex gap-2 items-start">
                        {form.imageUrl ? (
                          <img src={form.imageUrl} alt="Preview" className="w-12 h-12 rounded object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-12 h-12 rounded bg-muted flex items-center justify-center flex-shrink-0">
                            <Image className="h-5 w-5 text-muted-foreground/30" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">{form.title || "Titulo del anuncio"}</p>
                          <p className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5">
                            {form.description || "Descripcion del anuncio..."}
                          </p>
                          <p className="text-[9px] text-muted-foreground/50 mt-1">{form.advertiser || "Anunciante"}</p>
                        </div>
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground/50 mt-2 text-center">
                      Asi se vera debajo de las respuestas de la IA
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-4 space-y-2">
                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Resumen</h4>
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Presupuesto diario</span>
                        <span className="font-medium">S/{form.dailyBudget.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Duracion</span>
                        <span className="font-medium">{form.durationDays} dias</span>
                      </div>
                      <Separator />
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Presupuesto total</span>
                        <span className="font-bold text-primary">S/{totalBudget.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Costo/impresion</span>
                        <span className="font-medium">0.1 centimos</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>

          <div className="flex justify-between mt-8 pt-6 border-t">
            <Button
              variant="outline"
              onClick={() => setWizardStep(s => Math.max(0, s - 1))}
              disabled={wizardStep === 0}
              data-testid="button-wizard-prev"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Anterior
            </Button>
            {wizardStep < WIZARD_STEPS.length - 1 ? (
              <Button
                onClick={() => setWizardStep(s => s + 1)}
                disabled={!canAdvance}
                data-testid="button-wizard-next"
              >
                Siguiente
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background" data-testid="ads-page">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/")} data-testid="button-back-ads">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600">
              <Megaphone className="h-5 w-5 text-white" />
            </div>
            <h1 className="text-2xl font-bold" data-testid="text-ads-title">IliaADS</h1>
          </div>
          <Badge variant="outline" className="ml-1">Ads Manager</Badge>
          <Button className="ml-auto" onClick={() => { setShowWizard(true); setWizardStep(0); resetForm(); }} data-testid="button-create-ad">
            <Plus className="h-4 w-4 mr-2" />
            Promocionar publicacion
          </Button>
        </div>

        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
            <Card>
              <CardContent className="p-3 text-center">
                <BarChart3 className="h-4 w-4 mx-auto mb-1 text-blue-500" />
                <p className="text-xl font-bold" data-testid="text-total-ads">{stats.totalAds}</p>
                <p className="text-[10px] text-muted-foreground">Anuncios</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <Target className="h-4 w-4 mx-auto mb-1 text-green-500" />
                <p className="text-xl font-bold" data-testid="text-active-ads">{stats.activeAds}</p>
                <p className="text-[10px] text-muted-foreground">Activos</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <Eye className="h-4 w-4 mx-auto mb-1 text-purple-500" />
                <p className="text-xl font-bold" data-testid="text-total-impressions">{formatNumber(stats.totalImpressions)}</p>
                <p className="text-[10px] text-muted-foreground">Impresiones</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <MousePointer className="h-4 w-4 mx-auto mb-1 text-orange-500" />
                <p className="text-xl font-bold" data-testid="text-total-clicks">{formatNumber(stats.totalClicks)}</p>
                <p className="text-[10px] text-muted-foreground">Clics</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <MessageCircle className="h-4 w-4 mx-auto mb-1 text-cyan-500" />
                <p className="text-xl font-bold" data-testid="text-total-messages">{formatNumber(stats.totalMessages)}</p>
                <p className="text-[10px] text-muted-foreground">Mensajes</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <DollarSign className="h-4 w-4 mx-auto mb-1 text-yellow-500" />
                <p className="text-xl font-bold" data-testid="text-spent">S/{stats.totalSpentSoles}</p>
                <p className="text-[10px] text-muted-foreground">Gastado</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <TrendingUp className="h-4 w-4 mx-auto mb-1 text-rose-500" />
                <p className="text-xl font-bold" data-testid="text-ctr">{stats.ctr}%</p>
                <p className="text-[10px] text-muted-foreground">CTR</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <CreditCard className="h-4 w-4 mx-auto mb-1 text-indigo-500" />
                <p className="text-xl font-bold" data-testid="text-cpc">S/{stats.avgCostPerClick}</p>
                <p className="text-[10px] text-muted-foreground">CPC</p>
              </CardContent>
            </Card>
          </div>
        )}

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">
            <div className="animate-pulse space-y-3">
              <div className="h-20 bg-muted rounded-lg max-w-2xl mx-auto" />
              <div className="h-20 bg-muted rounded-lg max-w-2xl mx-auto" />
            </div>
          </div>
        ) : ads.length === 0 ? (
          <div className="text-center py-16">
            <div className="p-4 rounded-full bg-gradient-to-br from-blue-500/10 to-purple-600/10 w-fit mx-auto mb-4">
              <Megaphone className="h-12 w-12 text-blue-500/40" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Promociona tu negocio</h3>
            <p className="text-sm text-muted-foreground mb-1 max-w-md mx-auto">
              Crea tu primer anuncio para empezar a promocionar tu negocio entre los millones de usuarios de IliaGPT.
            </p>
            <p className="text-xs text-muted-foreground/60 mb-6">
              Los anuncios se muestran debajo de las respuestas de IA, basados en las consultas de cada usuario.
            </p>
            <Button size="lg" onClick={() => { setShowWizard(true); setWizardStep(0); resetForm(); }} data-testid="button-first-ad">
              <Megaphone className="h-4 w-4 mr-2" />
              Promocionar publicacion
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {ads.map((ad) => {
              const budgetUsed = ad.totalBudget && ad.totalBudget > 0
                ? Math.min(((ad.costSpent || 0) / ad.totalBudget) * 100, 100)
                : 0;
              return (
                <Card key={ad.id} className={`transition-all ${!ad.active ? "opacity-60" : ""}`} data-testid={`card-ad-${ad.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      {ad.imageUrl ? (
                        <img src={ad.imageUrl} alt={ad.title} className="w-16 h-16 rounded-lg object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                          <Image className="h-6 w-6 text-muted-foreground/30" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-medium truncate">{ad.title}</h3>
                          <Badge variant={ad.active ? "default" : "secondary"} className="flex-shrink-0 text-[10px]">
                            {ad.active ? "Activo" : "Pausado"}
                          </Badge>
                          {ad.objective && ad.objective !== "general" && (
                            <Badge variant="outline" className="flex-shrink-0 text-[10px]">
                              {OBJECTIVES.find(o => o.id === ad.objective)?.title || ad.objective}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-1">{ad.description}</p>
                        <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
                          <span className="flex items-center gap-1">
                            <Eye className="h-3 w-3" /> {formatNumber(ad.impressions || 0)}
                          </span>
                          <span className="flex items-center gap-1">
                            <MousePointer className="h-3 w-3" /> {formatNumber(ad.clicks || 0)}
                          </span>
                          <span className="flex items-center gap-1">
                            <MessageCircle className="h-3 w-3" /> {ad.messagesReceived || 0}
                          </span>
                          <span className="flex items-center gap-1">
                            <DollarSign className="h-3 w-3" /> S/{(ad as any).costSpentSoles || "0.00"}
                          </span>
                          <span className="flex items-center gap-1">
                            <Globe className="h-3 w-3" /> {COUNTRIES.find(c => c.code === ad.targetCountry)?.flag || ""} {ad.targetCountry}
                          </span>
                          <span>{ad.advertiser}</span>
                        </div>
                        {ad.totalBudget && ad.totalBudget > 0 && (
                          <div className="mt-2">
                            <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-0.5">
                              <span>Presupuesto usado</span>
                              <span>{budgetUsed.toFixed(0)}%</span>
                            </div>
                            <Progress value={budgetUsed} className="h-1" />
                          </div>
                        )}
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => toggleAd(ad.id, ad.active)}
                          data-testid={`button-toggle-ad-${ad.id}`}
                        >
                          {ad.active ? <Pause className="h-4 w-4 text-yellow-500" /> : <Play className="h-4 w-4 text-green-500" />}
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
              );
            })}
          </div>
        )}

        <div className="mt-8 p-4 rounded-lg border border-dashed border-muted-foreground/20 bg-muted/20">
          <div className="flex items-start gap-3">
            <Info className="h-4 w-4 text-muted-foreground/50 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-muted-foreground/60 space-y-1">
              <p><strong>Como funciona IliaADS:</strong> Los anuncios se muestran contextualmente debajo de los botones de copiar/like/dislike en cada respuesta de la IA.</p>
              <p>El algoritmo analiza la consulta del usuario y muestra el anuncio mas relevante segun las keywords configuradas.</p>
              <p>Cobro: <strong>0.1 centimos por impresion</strong>. Target por defecto: Peru, edad 18+, Advantage+ activado.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
