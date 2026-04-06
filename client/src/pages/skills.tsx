import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Activity,
  AlertTriangle,
  Anchor,
  ArrowLeft,
  ArrowRightCircle,
  BarChart2,
  BarChart3,
  Blocks,
  BookOpen,
  Bot,
  Box,
  Briefcase,
  Bug,
  Calendar,
  CalendarDays,
  Calculator,
  Camera,
  Check,
  CheckCircle2,
  CheckSquare,
  Cloud,
  Code,
  Compass,
  Copy,
  Cpu,
  CreditCard,
  Database,
  Download,
  Eye,
  FastForward,
  FileEdit,
  FileSpreadsheet,
  FileText,
  FileType,
  Flame,
  Frame,
  GitBranch,
  Globe,
  Image as ImageIcon,
  KeyRound,
  LayoutTemplate,
  Layers,
  LineChart,
  ListTodo,
  Loader2,
  Mail,
  MessageCircle,
  MessageSquare,
  Mic,
  MoreVertical,
  Music,
  Package,
  Paintbrush,
  Pause,
  Pencil,
  Phone,
  PieChart,
  Play,
  PlayCircle,
  Plus,
  Presentation,
  RefreshCcw,
  Rss,
  Search,
  Server,
  Settings2,
  ShieldAlert,
  ShoppingBag,
  Snowflake,
  Sparkles,
  Speaker,
  StickyNote,
  Terminal,
  Ticket,
  Trash2,
  UploadCloud,
  Users,
  Video,
  Wifi,
  XCircle,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/apiClient";
import { toast } from "sonner";
import { useUserSkills, UserSkill } from "@/hooks/use-user-skills";
import { SkillBuilder } from "@/components/skill-builder";
import { BUNDLED_SKILLS } from "@/data/bundledSkills";
import {
  createCatalogOnlyRuntimeSkill,
  SKILL_CERTIFICATION_LABELS,
  SKILL_RUNTIME_STATUS_LABELS,
  type OpenClawSkillsRuntimeSnapshot,
  type RuntimeSkillDescriptor,
  type SkillCertificationStatus,
  type SkillRuntimeStatus,
} from "@shared/skillsRuntime";
interface BuiltInSkill {
  id: string;
  name: string;
  description: string;
  category: "documents" | "data" | "integrations" | "custom";
  icon: React.ReactNode;
  enabled: boolean;
  builtIn: true;
  features: string[];
  triggers: string[];
}

type Skill = BuiltInSkill | (UserSkill & { triggers?: string[] });

const BASE_BUILT_IN_SKILLS: BuiltInSkill[] = [
  {
    id: "xlsx",
    name: "Excel",
    description: "Crear hojas de cálculo, analizar datos, generar reportes con gráficos y fórmulas avanzadas.",
    category: "documents",
    icon: <FileSpreadsheet className="h-6 w-6 text-green-600" />,
    enabled: true,
    builtIn: true,
    features: ["Crear workbooks", "Fórmulas avanzadas", "Gráficos", "Formato condicional"],
    triggers: ["excel", "hoja de cálculo", "spreadsheet", "xlsx"]
  },
  {
    id: "docx",
    name: "Word",
    description: "Crear documentos profesionales, CVs, reportes, cartas y más con formato rico.",
    category: "documents",
    icon: <FileText className="h-6 w-6 text-blue-600" />,
    enabled: true,
    builtIn: true,
    features: ["Documentos profesionales", "CVs y cartas", "Tablas y listas", "Estilos"],
    triggers: ["word", "documento", "docx", "cv", "carta"]
  },
  {
    id: "pptx",
    name: "PowerPoint",
    description: "Crear presentaciones con diapositivas, gráficos y contenido visual.",
    category: "documents",
    icon: <Presentation className="h-6 w-6 text-orange-600" />,
    enabled: true,
    builtIn: true,
    features: ["Diapositivas", "Gráficos", "Imágenes", "Transiciones"],
    triggers: ["powerpoint", "presentación", "pptx", "slides"]
  },
  {
    id: "pdf",
    name: "PDF",
    description: "Extraer texto y tablas de PDFs, llenar formularios, analizar documentos.",
    category: "documents",
    icon: <FileType className="h-6 w-6 text-red-600" />,
    enabled: true,
    builtIn: true,
    features: ["Extraer texto", "Leer tablas", "Formularios", "OCR"],
    triggers: ["pdf", "extraer", "formulario"]
  },
  {
    id: "data-analysis",
    name: "Análisis de Datos",
    description: "Procesar grandes conjuntos de datos, estadísticas y visualizaciones.",
    category: "data",
    icon: <BarChart3 className="h-6 w-6 text-purple-600" />,
    enabled: true,
    builtIn: true,
    features: ["Estadísticas", "Visualizaciones", "Tendencias", "Reportes"],
    triggers: ["análisis", "datos", "estadísticas", "dashboard"]
  },
  {
    id: "formulas",
    name: "Motor de Fórmulas",
    description: "Evaluar fórmulas matemáticas, cálculos financieros y científicos.",
    category: "data",
    icon: <Calculator className="h-6 w-6 text-indigo-600" />,
    enabled: true,
    builtIn: true,
    features: ["Matemáticas", "Financieras", "Trigonometría", "Conversiones"],
    triggers: ["fórmula", "calcular", "sum", "average"]
  },
  {
    id: "web-search",
    name: "Búsqueda Web",
    description: "Buscar información actualizada en internet y fuentes académicas.",
    category: "integrations",
    icon: <Globe className="h-6 w-6 text-cyan-600" />,
    enabled: true,
    builtIn: true,
    features: ["Búsqueda web", "Noticias", "Verificación", "Citas"],
    triggers: ["buscar", "search", "internet", "web"]
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Leer y analizar correos electrónicos, buscar mensajes, resumir hilos.",
    category: "integrations",
    icon: <Mail className="h-6 w-6 text-red-500" />,
    enabled: true,
    builtIn: true,
    features: ["Leer emails", "Buscar", "Resumir", "Filtrar"],
    triggers: ["gmail", "correo", "email", "mensajes"]
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    description: "Leer y enviar mensajes de WhatsApp, buscar conversaciones y automatizar respuestas.",
    category: "integrations",
    icon: <MessageCircle className="h-6 w-6 text-green-600" />,
    enabled: true,
    builtIn: true,
    features: ["Leer chats", "Enviar mensajes", "Buscar conversaciones", "Auto-respuestas"],
    triggers: ["whatsapp", "chat", "mensaje", "wa"]
  },
  {
    id: "calendar-tasks",
    name: "Calendario y Tareas",
    description: "Crear eventos, recordatorios y tareas para organizar seguimiento y productividad.",
    category: "integrations",
    icon: <CalendarDays className="h-6 w-6 text-sky-600" />,
    enabled: true,
    builtIn: true,
    features: ["Eventos", "Recordatorios", "Tareas", "Agenda semanal"],
    triggers: ["calendario", "agenda", "evento", "recordatorio", "tarea"]
  },
  {
    id: "automation",
    name: "Automatizaciones",
    description: "Construir flujos automáticos programados para reportes, alertas y procesos repetitivos.",
    category: "integrations",
    icon: <Zap className="h-6 w-6 text-amber-600" />,
    enabled: true,
    builtIn: true,
    features: ["Workflows", "Ejecución programada", "Reintentos", "Monitoreo"],
    triggers: ["automatizar", "workflow", "flujo", "cron", "programar"]
  },
  {
    id: "code-execution",
    name: "Ejecución de Código",
    description: "Ejecutar código Python, JavaScript para análisis y automatización.",
    category: "data",
    icon: <Code className="h-6 w-6 text-yellow-600" />,
    enabled: true,
    builtIn: true,
    features: ["Python", "JavaScript", "Visualizaciones", "Automatización"],
    triggers: ["código", "python", "javascript", "ejecutar"]
  },
  {
    id: "database",
    name: "Base de Datos",
    description: "Consultar y analizar datos de bases de datos SQL.",
    category: "data",
    icon: <Database className="h-6 w-6 text-gray-600" />,
    enabled: true,
    builtIn: true,
    features: ["SQL", "Joins", "Agregaciones", "Exportar"],
    triggers: ["database", "sql", "consulta", "base de datos"]
  },
];


const getExtraSkillIcon = (id: string) => {
  const props = { className: "h-6 w-6 text-purple-500" };
  switch (id) {
    case "1password": return <KeyRound {...props} className="h-6 w-6 text-blue-500" />;
    case "apple-notes": return <StickyNote {...props} className="h-6 w-6 text-yellow-500" />;
    case "apple-reminders": return <ListTodo {...props} className="h-6 w-6 text-red-500" />;
    case "bear-notes": return <FileEdit {...props} className="h-6 w-6 text-red-700" />;
    case "blogwatcher": return <Rss {...props} className="h-6 w-6 text-orange-500" />;
    case "blucli": return <Speaker {...props} className="h-6 w-6 text-blue-400" />;
    case "bluebubbles": return <MessageSquare {...props} className="h-6 w-6 text-blue-500" />;
    case "camsnap": return <Camera {...props} className="h-6 w-6 text-gray-500" />;
    case "clawhub": return <Layers {...props} className="h-6 w-6 text-indigo-500" />;
    case "coding-agent": return <Terminal {...props} className="h-6 w-6 text-green-500" />;
    case "discord": return <MessageSquare {...props} className="h-6 w-6 text-indigo-400" />;
    case "eightctl": return <Snowflake {...props} className="h-6 w-6 text-blue-300" />;
    case "gemini": return <Bot {...props} className="h-6 w-6 text-blue-600" />;
    case "gh-issues": return <Code {...props} className="h-6 w-6 text-gray-800" />;
    case "gifgrep": return <ImageIcon {...props} className="h-6 w-6 text-pink-500" />;
    case "github": return <Code {...props} className="h-6 w-6 text-black" />;
    case "gog": return <LayoutTemplate {...props} className="h-6 w-6 text-blue-500" />;
    case "goplaces": return <Globe {...props} className="h-6 w-6 text-green-500" />;
    case "healthcheck": return <Activity {...props} className="h-6 w-6 text-red-500" />;
    case "himalaya": return <Mail {...props} className="h-6 w-6 text-gray-500" />;
    case "imsg": return <MessageSquare {...props} className="h-6 w-6 text-green-500" />;
    case "mcporter": return <Layers {...props} className="h-6 w-6 text-orange-600" />;
    case "model-usage": return <BarChart2 {...props} className="h-6 w-6 text-indigo-500" />;
    case "nano-banana-pro": return <ImageIcon {...props} className="h-6 w-6 text-yellow-500" />;
    case "nano-pdf": return <FileType {...props} className="h-6 w-6 text-red-500" />;
    case "notion": return <FileText {...props} className="h-6 w-6 text-gray-900" />;
    case "obsidian": return <FileEdit {...props} className="h-6 w-6 text-purple-600" />;
    case "openai-image-gen": return <ImageIcon {...props} className="h-6 w-6 text-emerald-500" />;
    case "openai-whisper": return <Mic {...props} className="h-6 w-6 text-gray-600" />;
    case "openai-whisper-api": return <Mic {...props} className="h-6 w-6 text-gray-700" />;
    case "openhue": return <Flame {...props} className="h-6 w-6 text-yellow-400" />;
    case "oracle": return <Search {...props} className="h-6 w-6 text-cyan-600" />;
    case "ordercli": return <ShoppingBag {...props} className="h-6 w-6 text-pink-600" />;
    case "peekaboo": return <Eye {...props} className="h-6 w-6 text-blue-400" />;
    case "sag": return <Speaker {...props} className="h-6 w-6 text-indigo-500" />;
    case "session-logs": return <Search {...props} className="h-6 w-6 text-gray-400" />;
    case "sherpa-onnx-tts": return <Speaker {...props} className="h-6 w-6 text-indigo-600" />;
    case "skill-creator": return <LayoutTemplate {...props} className="h-6 w-6 text-blue-500" />;
    case "slack": return <MessageSquare {...props} className="h-6 w-6 text-purple-700" />;
    case "songsee": return <Music {...props} className="h-6 w-6 text-pink-500" />;
    case "wacli": return <Phone {...props} className="h-6 w-6 text-green-500" />;
    case "weather": return <Snowflake {...props} className="h-6 w-6 text-cyan-500" />;

    case "sonoscli": return <Speaker {...props} className="h-6 w-6 text-gray-800" />;
    case "spotify-player": return <Music {...props} className="h-6 w-6 text-green-600" />;
    case "summarize": return <FileText {...props} className="h-6 w-6 text-blue-500" />;
    case "things-mac": return <CheckSquare {...props} className="h-6 w-6 text-gray-700" />;
    case "tmux": return <Terminal {...props} className="h-6 w-6 text-green-400" />;
    case "trello": return <LayoutTemplate {...props} className="h-6 w-6 text-blue-600" />;
    case "video-frames": return <Frame {...props} className="h-6 w-6 text-red-500" />;
    case "voice-call": return <Phone {...props} className="h-6 w-6 text-green-500" />;
    case "aws-cli": return <Cloud {...props} className="h-6 w-6 text-orange-500" />;
    case "docker-ops": return <Box {...props} className="h-6 w-6 text-blue-500" />;
    case "jira-manager": return <LayoutTemplate {...props} className="h-6 w-6 text-blue-600" />;
    case "linear-sync": return <RefreshCcw {...props} className="h-6 w-6 text-purple-500" />;
    case "vercel-deploy": return <UploadCloud {...props} className="h-6 w-6 text-black" />;
    case "figma-pull": return <Paintbrush {...props} className="h-6 w-6 text-pink-500" />;
    case "gitlab-ops": return <GitBranch {...props} className="h-6 w-6 text-orange-600" />;
    case "sentry-alert": return <AlertTriangle {...props} className="h-6 w-6 text-red-500" />;
    case "datadog-metric": return <Activity {...props} className="h-6 w-6 text-purple-600" />;
    case "pagerduty-oncall": return <ShieldAlert {...props} className="h-6 w-6 text-green-600" />;
    case "stripe-dash": return <CreditCard {...props} className="h-6 w-6 text-indigo-500" />;
    case "twilio-sms": return <MessageSquare {...props} className="h-6 w-6 text-red-600" />;
    case "sendgrid-mail": return <Mail {...props} className="h-6 w-6 text-blue-400" />;
    case "mailchimp-sync": return <Users {...props} className="h-6 w-6 text-yellow-600" />;
    case "hubspot-crm": return <Briefcase {...props} className="h-6 w-6 text-orange-500" />;
    case "salesforce-lookup": return <Cloud {...props} className="h-6 w-6 text-blue-500" />;
    case "zendesk-ticket": return <Ticket {...props} className="h-6 w-6 text-green-600" />;
    case "intercom-chat": return <MessageSquare {...props} className="h-6 w-6 text-blue-500" />;
    case "zoom-meeting": return <Video {...props} className="h-6 w-6 text-blue-500" />;
    case "google-meet": return <Video {...props} className="h-6 w-6 text-yellow-500" />;
    case "teams-message": return <MessageSquare {...props} className="h-6 w-6 text-indigo-600" />;
    case "webex-call": return <Phone {...props} className="h-6 w-6 text-green-600" />;
    case "calendly-book": return <Calendar {...props} className="h-6 w-6 text-blue-500" />;
    case "typeform-answers": return <FileText {...props} className="h-6 w-6 text-gray-800" />;
    case "survey-monkey": return <FileText {...props} className="h-6 w-6 text-green-500" />;
    case "google-analytics": return <LineChart {...props} className="h-6 w-6 text-orange-500" />;
    case "mixpanel-events": return <PieChart {...props} className="h-6 w-6 text-purple-500" />;
    case "amplitude-cohort": return <BarChart2 {...props} className="h-6 w-6 text-blue-600" />;
    case "firebase-admin": return <Flame {...props} className="h-6 w-6 text-orange-500" />;
    case "supabase-ops": return <Database {...props} className="h-6 w-6 text-green-500" />;
    case "mongo-cloud": return <Database {...props} className="h-6 w-6 text-green-600" />;
    case "postgres-ops": return <Database {...props} className="h-6 w-6 text-blue-500" />;
    case "redis-cli": return <Database {...props} className="h-6 w-6 text-red-500" />;
    case "elasticsearch-query": return <Search {...props} className="h-6 w-6 text-blue-400" />;
    case "kafka-produce": return <FastForward {...props} className="h-6 w-6 text-black" />;
    case "rabbitmq-queue": return <ArrowRightCircle {...props} className="h-6 w-6 text-orange-500" />;
    case "kubernetes-ops": return <Anchor {...props} className="h-6 w-6 text-blue-600" />;
    case "terraform-apply": return <Layers {...props} className="h-6 w-6 text-purple-600" />;
    case "ansible-play": return <PlayCircle {...props} className="h-6 w-6 text-gray-800" />;
    case "puppet-run": return <Cpu {...props} className="h-6 w-6 text-orange-400" />;
    case "chef-client": return <Compass {...props} className="h-6 w-6 text-orange-600" />;
    case "nagios-check": return <Activity {...props} className="h-6 w-6 text-black" />;
    case "splunk-search": return <Search {...props} className="h-6 w-6 text-pink-600" />;
    case "newrelic-apm": return <Activity {...props} className="h-6 w-6 text-teal-500" />;
    case "grafana-dash": return <LineChart {...props} className="h-6 w-6 text-orange-500" />;
    case "prometheus-query": return <Flame {...props} className="h-6 w-6 text-orange-600" />;
    case "git-local": return <GitBranch {...props} className="h-6 w-6 text-gray-900" />;
    case "nmap-scan": return <Wifi {...props} className="h-6 w-6 text-black" />;
    case "wireshark-cap": return <Eye {...props} className="h-6 w-6 text-blue-600" />;
    case "burpsuite-proxy": return <Bug {...props} className="h-6 w-6 text-orange-600" />;

    default: return <Sparkles {...props} />;
  }
};

const EXTRA_SKILLS: BuiltInSkill[] = BUNDLED_SKILLS.map(skill => ({
  id: skill.id,
  name: skill.name,
  description: skill.description,
  category: skill.category === "automation" ? "integrations" : skill.category as "documents" | "data" | "integrations" | "custom",
  icon: getExtraSkillIcon(skill.id),
  enabled: true,
  builtIn: true,
  features: skill.features || [],
  triggers: []
}));

const BUILT_IN_SKILLS: BuiltInSkill[] = [...BASE_BUILT_IN_SKILLS, ...EXTRA_SKILLS];
const BUILT_IN_SKILL_IDS = new Set(BUILT_IN_SKILLS.map((skill) => skill.id));
const BUILT_IN_SKILL_NAMES = new Set(BUILT_IN_SKILLS.map((skill) => skill.name.toLowerCase()));
const EXTRA_SKILL_IDS = new Set(BUNDLED_SKILLS.map((skill) => skill.id));

async function fetchOpenClawRuntimeSnapshot(): Promise<OpenClawSkillsRuntimeSnapshot> {
  const res = await apiFetch("/api/skills/openclaw/runtime", { method: "GET" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || `Error ${res.status}`);
  }
  return await res.json() as OpenClawSkillsRuntimeSnapshot;
}

function runtimeStatusBadgeClass(status: SkillRuntimeStatus): string {
  switch (status) {
    case "ready":
      return "border-green-200 text-green-700 bg-green-50";
    case "needs_setup":
      return "border-amber-200 text-amber-700 bg-amber-50";
    case "disabled":
      return "border-slate-200 text-slate-600 bg-slate-50";
    case "catalog_only":
      return "border-blue-200 text-blue-700 bg-blue-50";
    case "error":
      return "border-red-200 text-red-700 bg-red-50";
    default:
      return "";
  }
}

function certificationBadgeClass(status: SkillCertificationStatus): string {
  switch (status) {
    case "verified":
      return "border-emerald-200 text-emerald-700 bg-emerald-50";
    case "runtime":
      return "border-violet-200 text-violet-700 bg-violet-50";
    case "uncertified":
      return "border-zinc-200 text-zinc-600 bg-zinc-50";
    default:
      return "";
  }
}

function vendorBadgeClass(vendor?: string): string {
  if (vendor === "anthropic") {
    return "border-orange-200 text-orange-700 bg-orange-50";
  }
  return "border-zinc-200 text-zinc-600 bg-zinc-50";
}

function vendorLabel(vendor?: string): string | null {
  if (vendor === "anthropic") {
    return "Anthropic OSS";
  }
  return vendor?.trim() || null;
}

function getRuntimeDiscoveredSkillIcon(runtimeSkill: RuntimeSkillDescriptor): React.ReactNode {
  const bundledMatch =
    BUNDLED_SKILLS.find((item) => item.id === runtimeSkill.id) ||
    BUNDLED_SKILLS.find((item) => item.name.toLowerCase() === runtimeSkill.name.toLowerCase());
  if (bundledMatch) {
    return getExtraSkillIcon(bundledMatch.id);
  }
  if (runtimeSkill.vendor === "anthropic") {
    return <Blocks className="h-6 w-6 text-orange-600" />;
  }
  return <Sparkles className="h-6 w-6 text-emerald-600" />;
}

function toRuntimeBuiltInSkill(runtimeSkill: RuntimeSkillDescriptor): BuiltInSkill {
  const bundledMatch =
    BUNDLED_SKILLS.find((item) => item.id === runtimeSkill.id) ||
    BUNDLED_SKILLS.find((item) => item.name.toLowerCase() === runtimeSkill.name.toLowerCase());
  const fallbackFeatures =
    runtimeSkill.tools?.length
      ? runtimeSkill.tools.map((tool) => `Tool disponible: ${tool}`)
      : runtimeSkill.vendor === "anthropic"
        ? ["Catálogo detectado desde anthropics/skills"]
        : [];

  return {
    id: runtimeSkill.id,
    name: runtimeSkill.name,
    description:
      runtimeSkill.description ||
      bundledMatch?.description ||
      `Skill detectada dinámicamente desde ${runtimeSkill.source}.`,
    category:
      bundledMatch?.category === "automation"
        ? "integrations"
        : ((bundledMatch?.category as BuiltInSkill["category"] | undefined) ?? "custom"),
    icon: getRuntimeDiscoveredSkillIcon(runtimeSkill),
    enabled: runtimeSkill.enabled ?? runtimeSkill.status === "ready",
    builtIn: true,
    features: bundledMatch?.features?.length ? bundledMatch.features : fallbackFeatures,
    triggers: [],
  };
}

export default function SkillsPage() {
  const [, setLocation] = useLocation();
  const { skills: userSkills, createSkill, updateSkill, deleteSkill, toggleSkill: toggleUserSkill, duplicateSkill } = useUserSkills();
  const runtimeQuery = useQuery({
    queryKey: ["skills", "openclaw-runtime"],
    queryFn: fetchOpenClawRuntimeSnapshot,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const [builtInStates, setBuiltInStates] = useState<Record<string, boolean>>(
    Object.fromEntries(BUILT_IN_SKILLS.map(s => [s.id, s.enabled]))
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<UserSkill | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // --- Fluid Pack Install State ---
  const [fluidInstallOpen, setFluidInstallOpen] = useState(false);
  const [fluidInstalling, setFluidInstalling] = useState(false);
  const [fluidResult, setFluidResult] = useState<{
    importedCount: number;
    skippedCount: number;
    catalogTotal: number;
  } | null>(null);
  const [fluidError, setFluidError] = useState<string | null>(null);
  const runtimeSkillMap = useMemo(
    () => new Map((runtimeQuery.data?.skills || []).map((skill) => [skill.id, skill])),
    [runtimeQuery.data],
  );
  const runtimeSkillNameMap = useMemo(
    () => new Map((runtimeQuery.data?.skills || []).map((skill) => [skill.name.toLowerCase(), skill])),
    [runtimeQuery.data],
  );
  const runtimeDiscoveredSkills = useMemo(() => {
    const userSkillIds = new Set(userSkills.map((skill) => skill.id));
    const userSkillNames = new Set(userSkills.map((skill) => skill.name.toLowerCase()));

    return (runtimeQuery.data?.skills || [])
      .filter((skill) => !BUILT_IN_SKILL_IDS.has(skill.id))
      .filter((skill) => !BUILT_IN_SKILL_NAMES.has(skill.name.toLowerCase()))
      .filter((skill) => !userSkillIds.has(skill.id))
      .filter((skill) => !userSkillNames.has(skill.name.toLowerCase()))
      .map(toRuntimeBuiltInSkill);
  }, [runtimeQuery.data, userSkills]);
  const builtInSkills = useMemo(
    () => [...BUILT_IN_SKILLS, ...runtimeDiscoveredSkills],
    [runtimeDiscoveredSkills],
  );
  const builtInSkillMap = useMemo(
    () => new Map(builtInSkills.map((skill) => [skill.id, skill])),
    [builtInSkills],
  );

  const handleInstallFluidPack = useCallback(async () => {
    setFluidInstalling(true);
    setFluidResult(null);
    setFluidError(null);
    try {
      const res = await fetch("/api/skills/bootstrap/fluid", { method: "POST" });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setFluidResult({
        importedCount: data.importedCount ?? 0,
        skippedCount: data.skippedCount ?? 0,
        catalogTotal: data.catalogTotal ?? 20,
      });
      if (data.importedCount > 0) {
        toast.success(`${data.importedCount} skills importadas exitosamente`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error al instalar el pack";
      setFluidError(message);
      toast.error("Error al instalar el pack Fluid 20");
    } finally {
      setFluidInstalling(false);
    }
  }, []);

  const allSkills = useMemo(() => {
    const builtIn: Skill[] = builtInSkills.map(s => ({
      ...s,
      enabled: builtInStates[s.id] ?? s.enabled
    }));
    return [...builtIn, ...userSkills.map(s => ({ ...s, triggers: [] }))];
  }, [builtInSkills, userSkills, builtInStates]);

  const toggleBuiltInSkill = (skillId: string) => {
    setBuiltInStates(prev => {
      const skill = builtInSkillMap.get(skillId);
      const currentValue = prev[skillId] ?? skill?.enabled ?? false;
      const newState = { ...prev, [skillId]: !currentValue };
      toast.success(newState[skillId] ? `${skill?.name} activado` : `${skill?.name} desactivado`);
      return newState;
    });
  };

  const handleToggleSkill = (skill: Skill) => {
    if (skill.builtIn) {
      toggleBuiltInSkill(skill.id);
    } else {
      toggleUserSkill(skill.id);
      toast.success(!skill.enabled ? `${skill.name} activado` : `${skill.name} desactivado`);
    }
  };

  const filteredSkills = allSkills.filter(skill => {
    const matchesSearch = skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      skill.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === "all" || skill.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const enabledCount = allSkills.filter(s => s.enabled).length;
  const customCount = userSkills.length;
  const runtimeReadyCount = (runtimeQuery.data?.skills || []).filter((skill) => skill.status === "ready").length;

  const categoryLabels: Record<string, string> = {
    all: "Todos",
    documents: "Documentos",
    data: "Datos",
    integrations: "Integraciones",
    custom: "Personalizados"
  };

  const handleCreateSkill = () => {
    setEditingSkill(null);
    setIsBuilderOpen(true);
  };

  const handleEditSkill = (skill: UserSkill) => {
    setEditingSkill(skill);
    setIsBuilderOpen(true);
  };

  const handleSaveSkill = (skillData: Omit<UserSkill, "id" | "createdAt" | "updatedAt" | "builtIn">) => {
    if (editingSkill) {
      updateSkill(editingSkill.id, skillData);
    } else {
      createSkill(skillData);
    }
  };

  const handleDeleteSkill = (id: string) => {
    deleteSkill(id);
    setDeleteConfirmId(null);
    if (selectedSkill && !selectedSkill.builtIn && selectedSkill.id === id) {
      setSelectedSkill(null);
    }
    toast.success("Skill eliminado");
  };

  const getSkillIcon = (skill: Skill): React.ReactNode => {
    if (skill.builtIn) {
      return (skill as BuiltInSkill).icon;
    }
    // Try to match imported bundled skills by name
    const bundledMatch = BUNDLED_SKILLS.find(s => s.name.toLowerCase() === skill.name.toLowerCase());
    if (bundledMatch) {
      return getExtraSkillIcon(bundledMatch.id);
    }
    return <Sparkles className="h-6 w-6 text-purple-500" />;
  };

  const getRuntimeInfo = useCallback((skill: Skill): RuntimeSkillDescriptor | null => {
    if (!skill.builtIn) {
      return null;
    }
    const runtimeInfo = runtimeSkillMap.get(skill.id) || runtimeSkillNameMap.get(skill.name.toLowerCase());
    if (runtimeInfo) {
      return runtimeInfo;
    }
    if (!EXTRA_SKILL_IDS.has(skill.id)) {
      return null;
    }
    const bundledSkill =
      BUNDLED_SKILLS.find((item) => item.id === skill.id) ||
      BUNDLED_SKILLS.find((item) => item.name.toLowerCase() === skill.name.toLowerCase());
    return bundledSkill ? createCatalogOnlyRuntimeSkill(bundledSkill) : null;
  }, [runtimeSkillMap, runtimeSkillNameMap]);

  const selectedRuntimeInfo = selectedSkill ? getRuntimeInfo(selectedSkill) : null;

  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="sticky top-0 z-20 backdrop-blur-xl bg-background/80 border-b">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full"
              onClick={() => setLocation("/")}
              data-testid="button-back-skills"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                <Zap className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <h1 className="text-lg font-semibold">Skills</h1>
                <p className="text-xs text-muted-foreground">Capacidades modulares de iliagpt</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="gap-1">
              <Play className="h-3 w-3" />
              {enabledCount} activos
            </Badge>
            {customCount > 0 && (
              <Badge variant="outline" className="gap-1 text-purple-600 border-purple-200">
                <Sparkles className="h-3 w-3" />
                {customCount} personalizados
              </Badge>
            )}
            {runtimeQuery.data && (
              <Badge
                variant="outline"
                className={cn(
                  "gap-1",
                  runtimeQuery.data.runtimeAvailable
                    ? "border-green-200 text-green-700"
                    : "border-amber-200 text-amber-700",
                )}
              >
                <Server className="h-3 w-3" />
                {runtimeQuery.data.runtimeAvailable
                  ? `${runtimeReadyCount} listos en runtime`
                  : "Runtime no disponible"}
              </Badge>
            )}
            <Button
              onClick={() => { setFluidResult(null); setFluidError(null); setFluidInstallOpen(true); }}
              variant="outline"
              className="gap-2 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-900/20"
              data-testid="button-install-fluid-pack"
            >
              <Package className="h-4 w-4" />
              Instalar Pack Fluid 20
            </Button>
            <Button onClick={handleCreateSkill} className="gap-2" data-testid="button-create-skill">
              <Plus className="h-4 w-4" />
              Crear Skill
            </Button>
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col">
          <div className="px-6 py-4 border-b bg-muted/20">
            <div className="max-w-7xl mx-auto space-y-3">
              <div className="flex items-center gap-4">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar skills..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 bg-background"
                    data-testid="skills-search-input"
                  />
                </div>
                <Tabs value={selectedCategory} onValueChange={setSelectedCategory}>
                  <TabsList className="bg-background">
                    {Object.entries(categoryLabels).map(([key, label]) => (
                      <TabsTrigger key={key} value={key} data-testid={`tab-${key}`}>
                        {label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>
              {runtimeQuery.data && !runtimeQuery.data.runtimeAvailable && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <div>
                    <p className="font-medium">Mostrando catálogo sin runtime activo</p>
                    <p className="text-xs text-amber-700">
                      {runtimeQuery.data.message || "Las skills extra aparecen listadas, pero no hay un runtime ejecutable conectado en este momento."}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="max-w-7xl mx-auto p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredSkills.map((skill) => {
                  const runtimeInfo = getRuntimeInfo(skill);
                  return (
                    <Card
                      key={skill.id}
                      className={cn(
                        "group cursor-pointer transition-all duration-200 hover:shadow-md",
                        skill.enabled
                          ? "border-primary/20 bg-card"
                          : "bg-muted/30 border-transparent",
                        selectedSkill?.id === skill.id && "ring-2 ring-primary"
                      )}
                      onClick={() => setSelectedSkill(skill)}
                      data-testid={`skill-card-${skill.id}`}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start gap-4">
                          <div className={cn(
                            "p-3 rounded-xl transition-colors",
                            skill.enabled ? "bg-muted" : "bg-muted/50"
                          )}>
                            {getSkillIcon(skill)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <h3 className="font-semibold truncate">{skill.name}</h3>
                              <div className="flex items-center gap-1">
                                {!skill.builtIn && (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 opacity-0 group-hover:opacity-100"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <MoreVertical className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleEditSkill(skill as UserSkill); }}>
                                        <Pencil className="h-4 w-4 mr-2" />
                                        Editar
                                      </DropdownMenuItem>
                                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); duplicateSkill(skill.id); toast.success("Skill duplicado"); }}>
                                        <Copy className="h-4 w-4 mr-2" />
                                        Duplicar
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        className="text-red-600"
                                        onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(skill.id); }}
                                      >
                                        <Trash2 className="h-4 w-4 mr-2" />
                                        Eliminar
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                )}
                                <Switch
                                  checked={skill.enabled}
                                  onCheckedChange={() => handleToggleSkill(skill)}
                                  onClick={(e) => e.stopPropagation()}
                                  data-testid={`skill-toggle-${skill.id}`}
                                />
                              </div>
                            </div>
                            <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                              {skill.description}
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                              {skill.builtIn ? (
                                <Badge variant="outline" className="text-xs">Integrado</Badge>
                              ) : (
                                <Badge variant="outline" className="text-xs text-purple-600 border-purple-200">Personalizado</Badge>
                              )}
                              {runtimeInfo && (
                                <Badge variant="outline" className={cn("text-xs", runtimeStatusBadgeClass(runtimeInfo.status))}>
                                  {SKILL_RUNTIME_STATUS_LABELS[runtimeInfo.status]}
                                </Badge>
                              )}
                              {runtimeInfo && (
                                <Badge variant="outline" className={cn("text-xs", certificationBadgeClass(runtimeInfo.certification))}>
                                  {SKILL_CERTIFICATION_LABELS[runtimeInfo.certification]}
                                </Badge>
                              )}
                              {runtimeInfo && vendorLabel(runtimeInfo.vendor) && (
                                <Badge variant="outline" className={cn("text-xs", vendorBadgeClass(runtimeInfo.vendor))}>
                                  {vendorLabel(runtimeInfo.vendor)}
                                </Badge>
                              )}
                              {skill.enabled && (
                                <span className="flex items-center gap-1 text-xs text-green-600">
                                  <CheckCircle2 className="h-3 w-3 text-green-500" />
                                  Activo
                                </span>
                              )}
                              {!skill.enabled && skill.builtIn && (
                                <span className="flex items-center gap-1 text-xs text-amber-600">
                                  <AlertTriangle className="h-3 w-3" />
                                  Pendiente
                                </span>
                              )}
                              {!skill.enabled && !skill.builtIn && (
                                <span className="flex items-center gap-1 text-xs text-gray-500">
                                  <XCircle className="h-3 w-3" />
                                  Inactivo
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
              {filteredSkills.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Zap className="h-16 w-16 text-muted-foreground/20 mb-4" />
                  <h3 className="text-lg font-medium mb-2">No se encontraron skills</h3>
                  <p className="text-muted-foreground mb-4">Intenta con otra búsqueda o crea uno nuevo</p>
                  <Button onClick={handleCreateSkill} className="gap-2">
                    <Plus className="h-4 w-4" />
                    Crear Skill
                  </Button>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {selectedSkill && (
          <div className="w-96 border-l bg-muted/10 flex flex-col">
            <div className="p-6 border-b bg-background">
              <div className="flex items-start gap-4">
                <div className="p-4 bg-muted rounded-xl">
                  {getSkillIcon(selectedSkill)}
                </div>
                <div className="flex-1">
                  <h2 className="text-xl font-bold">{selectedSkill.name}</h2>
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant={selectedSkill.enabled ? "default" : "secondary"}>
                      {selectedSkill.enabled ? "Activo" : "Inactivo"}
                    </Badge>
                    {selectedSkill.builtIn ? (
                      <Badge variant="outline">Integrado</Badge>
                    ) : (
                      <Badge variant="outline" className="text-purple-600">Personalizado</Badge>
                    )}
                    {selectedRuntimeInfo && (
                      <Badge variant="outline" className={cn("text-xs", runtimeStatusBadgeClass(selectedRuntimeInfo.status))}>
                        {SKILL_RUNTIME_STATUS_LABELS[selectedRuntimeInfo.status]}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <ScrollArea className="flex-1 p-6">
              <div className="space-y-6">
                <div>
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                    <BookOpen className="h-4 w-4" />
                    Descripción
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    {selectedSkill.description}
                  </p>
                </div>

                {selectedRuntimeInfo && (
                  <div>
                    <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                      <Server className="h-4 w-4" />
                      Runtime
                    </h4>
                    <div className="flex flex-wrap gap-2 mb-2">
                      <Badge variant="outline" className={cn("text-xs", runtimeStatusBadgeClass(selectedRuntimeInfo.status))}>
                        {SKILL_RUNTIME_STATUS_LABELS[selectedRuntimeInfo.status]}
                      </Badge>
                      <Badge variant="outline" className={cn("text-xs", certificationBadgeClass(selectedRuntimeInfo.certification))}>
                        {SKILL_CERTIFICATION_LABELS[selectedRuntimeInfo.certification]}
                      </Badge>
                      {vendorLabel(selectedRuntimeInfo.vendor) && (
                        <Badge variant="outline" className={cn("text-xs", vendorBadgeClass(selectedRuntimeInfo.vendor))}>
                          {vendorLabel(selectedRuntimeInfo.vendor)}
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-xs">
                        {selectedRuntimeInfo.source}
                      </Badge>
                    </div>
                    {selectedRuntimeInfo.reason && (
                      <p className="text-sm text-muted-foreground">
                        {selectedRuntimeInfo.reason}
                      </p>
                    )}
                    {selectedRuntimeInfo.homepage && (
                      <a
                        href={selectedRuntimeInfo.homepage}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-flex text-xs font-medium text-orange-700 underline underline-offset-2"
                      >
                        Ver repositorio fuente
                      </a>
                    )}
                  </div>
                )}

                {selectedSkill.builtIn && (selectedSkill as BuiltInSkill).triggers && (
                  <div>
                    <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                      <Zap className="h-4 w-4" />
                      Triggers
                    </h4>
                    <div className="flex flex-wrap gap-1">
                      {(selectedSkill as BuiltInSkill).triggers.map((trigger, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">{trigger}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                    <Settings2 className="h-4 w-4" />
                    Capacidades
                  </h4>
                  <div className="space-y-2">
                    {selectedSkill.features.map((feature, index) => (
                      <div key={index} className="flex items-center gap-2 text-sm">
                        <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
                        <span>{feature}</span>
                      </div>
                    ))}
                    {selectedSkill.features.length === 0 && (
                      <p className="text-sm text-muted-foreground">Sin capacidades definidas</p>
                    )}
                  </div>
                </div>

                {!selectedSkill.builtIn && 'instructions' in selectedSkill && (selectedSkill as UserSkill).instructions && (
                  <div>
                    <h4 className="text-sm font-medium mb-2">Instrucciones</h4>
                    <div className="p-3 bg-muted rounded-lg text-sm font-mono max-h-48 overflow-auto whitespace-pre-wrap">
                      {(selectedSkill as UserSkill).instructions.slice(0, 500)}
                      {(selectedSkill as UserSkill).instructions.length > 500 && "..."}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>

            <div className="p-4 border-t bg-background space-y-2">
              <Button
                className="w-full"
                variant={selectedSkill.enabled ? "outline" : "default"}
                onClick={() => handleToggleSkill(selectedSkill)}
              >
                {selectedSkill.enabled ? (
                  <>
                    <Pause className="h-4 w-4 mr-2" />
                    Desactivar
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Activar
                  </>
                )}
              </Button>
              {!selectedSkill.builtIn && (
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => handleEditSkill(selectedSkill as UserSkill)}
                >
                  <Pencil className="h-4 w-4 mr-2" />
                  Editar Skill
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      <SkillBuilder
        open={isBuilderOpen}
        onOpenChange={setIsBuilderOpen}
        onSave={handleSaveSkill}
        editingSkill={editingSkill}
      />

      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este Skill?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El Skill será eliminado permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteConfirmId && handleDeleteSkill(deleteConfirmId)}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Fluid Pack 20 Installation Dialog */}
      <Dialog open={fluidInstallOpen} onOpenChange={setFluidInstallOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-amber-600" />
              Instalar Pack Fluid 20
            </DialogTitle>
            <DialogDescription>
              Importa 20 capacidades funcionales avanzadas (AWS, Docker, Jira, Vercel, etc.) directamente a tu cuenta.
              Las skills duplicadas se omiten automáticamente.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            {!fluidInstalling && !fluidResult && !fluidError && (
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-full">
                  <Download className="h-8 w-8 text-amber-600" />
                </div>
                <p className="text-sm text-muted-foreground text-center">
                  Se importarán 20 skills funcionales. Las que ya existan en tu cuenta se omitirán.
                </p>
              </div>
            )}

            {fluidInstalling && (
              <div className="flex flex-col items-center gap-4 py-4">
                <Loader2 className="h-8 w-8 text-amber-600 animate-spin" />
                <p className="text-sm text-muted-foreground">Instalando skills...</p>
                <Progress value={65} className="w-full" />
              </div>
            )}

            {fluidResult && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <CheckCircle2 className="h-6 w-6 text-green-600 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-green-800 dark:text-green-300">
                      ¡Instalación completada!
                    </p>
                    <p className="text-sm text-green-700 dark:text-green-400">
                      {fluidResult.importedCount} importadas · {fluidResult.skippedCount} omitidas (duplicadas)
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-2xl font-bold text-amber-600">{fluidResult.catalogTotal}</p>
                    <p className="text-xs text-muted-foreground">Total Pack</p>
                  </div>
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-2xl font-bold text-green-600">{fluidResult.importedCount}</p>
                    <p className="text-xs text-muted-foreground">Importadas</p>
                  </div>
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-2xl font-bold text-gray-500">{fluidResult.skippedCount}</p>
                    <p className="text-xs text-muted-foreground">Omitidas</p>
                  </div>
                </div>
              </div>
            )}

            {fluidError && (
              <div className="flex items-center gap-3 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
                <XCircle className="h-6 w-6 text-red-600 flex-shrink-0" />
                <div>
                  <p className="font-medium text-red-800 dark:text-red-300">Error al instalar</p>
                  <p className="text-sm text-red-700 dark:text-red-400">{fluidError}</p>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            {!fluidResult && !fluidInstalling && (
              <Button
                onClick={handleInstallFluidPack}
                className="gap-2 w-full bg-amber-600 hover:bg-amber-700"
                data-testid="confirm-install-fluid"
              >
                <Download className="h-4 w-4" />
                Instalar 20 Skills
              </Button>
            )}
            {fluidResult && (
              <Button
                onClick={() => { setFluidInstallOpen(false); window.location.reload(); }}
                className="w-full"
              >
                <Check className="h-4 w-4 mr-2" />
                Cerrar y actualizar
              </Button>
            )}
            {fluidError && (
              <Button
                onClick={handleInstallFluidPack}
                variant="outline"
                className="w-full gap-2"
              >
                Reintentar
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
