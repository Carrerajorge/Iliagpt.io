import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, ChevronRight, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

interface App {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  category: "featured" | "productivity" | "lifestyle";
  verified?: boolean;
}

const apps: App[] = [
  {
    id: "adobe-acrobat",
    name: "Adobe Acrobat",
    description: "Edit and organize PDFs easily",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#EC1C24] flex items-center justify-center">
        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "adobe-express",
    name: "Adobe Express",
    description: "Design posts, flyers, and more",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#FF61F6] via-[#FF2BC2] to-[#FF0000] flex items-center justify-center">
        <span className="text-white font-bold text-lg">Ae</span>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "photoshop",
    name: "Adobe Photoshop",
    description: "Edit, stylize, refine images",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#001E36] flex items-center justify-center">
        <span className="text-[#31A8FF] font-bold text-lg">Ps</span>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "agentforce-sales",
    name: "Agentforce Sales",
    description: "Sales insights to close deals",
    icon: (
      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#00A1E0] to-[#16325C] flex items-center justify-center">
        <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "aha",
    name: "Aha!",
    description: "Connect to sync Aha! product roadmaps an...",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-white border border-gray-200 flex items-center justify-center">
        <span className="text-[#F26B2A] font-bold text-2xl">!</span>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "airtable",
    name: "Airtable",
    description: "Add structured data to ChatGPT",
    icon: (
      <div className="w-10 h-10 rounded-lg flex items-center justify-center">
        <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
          <path d="M11.5 3L2 7.5V17L11.5 21.5L21 17V7.5L11.5 3Z" fill="#FCB400" />
          <path d="M11.5 3L2 7.5L11.5 12L21 7.5L11.5 3Z" fill="#18BFFF" />
          <path d="M11.5 12V21.5L2 17V7.5L11.5 12Z" fill="#F82B60" />
          <path d="M11.5 12L21 7.5V17L11.5 21.5V12Z" fill="#7C3AED" />
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "asana",
    name: "Asana",
    description: "Convierte las tareas de Asana en actualizac...",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#F06A6A] flex items-center justify-center">
        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="6" r="4" />
          <circle cx="6" cy="16" r="4" />
          <circle cx="18" cy="16" r="4" />
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "atlassian-rovo",
    name: "Atlassian Rovo",
    description: "Manage Jira and Confluence fast",
    icon: (
      <div className="w-10 h-10 rounded-lg flex items-center justify-center">
        <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
          <path d="M4 12L12 4L20 12L12 20L4 12Z" fill="#0052CC" />
          <path d="M12 4L20 12L12 12L4 12L12 4Z" fill="#2684FF" />
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "azure-boards",
    name: "Azure Boards",
    description: "Connect to sync Azure DevOps work items ...",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#0078D4] flex items-center justify-center">
        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M3 3h18v18H3V3zm2 2v14h14V5H5z" />
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "basecamp",
    name: "Basecamp",
    description: "Connect to sync Basecamp projects and to...",
    icon: (
      <div className="w-10 h-10 rounded-full bg-[#1D2D35] flex items-center justify-center">
        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
          <path d="M12 4L4 12L12 20L20 12L12 4Z" fill="#5ECC62" />
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "box",
    name: "Box",
    description: "Busca y consulta tus documentos",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#0061D5] flex items-center justify-center">
        <span className="text-white font-bold text-sm">box</span>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "outlook-calendar",
    name: "Calendario de Outlook",
    description: "Consulta eventos y disponibilidad",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#0078D4] flex items-center justify-center">
        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
          <rect x="3" y="4" width="18" height="18" rx="2" fill="#0078D4" />
          <path d="M3 8h18" stroke="white" strokeWidth="2" />
          <text x="12" y="17" textAnchor="middle" fill="white" fontSize="8" fontWeight="bold">31</text>
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "canva",
    name: "Canva",
    description: "Search, create, edit designs",
    icon: (
      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#00C4CC] via-[#7D2AE8] to-[#FF7EB3] flex items-center justify-center">
        <span className="text-white font-bold text-lg">C</span>
      </div>
    ),
    category: "productivity",
    verified: true,
  },
  {
    id: "clay",
    name: "Clay",
    description: "Find and engage prospects",
    icon: (
      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="12" r="8" />
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "cloudinary",
    name: "Cloudinary",
    description: "Manage, modify, and host your images & vi...",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#3448C5] flex items-center justify-center">
        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 4C8.5 4 5.5 6.5 5 10c-2.5.5-4 2.5-4 5 0 3 2.5 5 5 5h12c2.5 0 4.5-2 4.5-4.5 0-2-1.5-4-3.5-4.5-.5-3.5-3.5-6-7-6z" />
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "conductor",
    name: "Conductor",
    description: "Track brand sentiment in AI",
    icon: (
      <div className="w-10 h-10 rounded-full bg-[#5B4FFF] flex items-center justify-center">
        <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="12" r="10" />
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "google-contacts",
    name: "Contactos de Google",
    description: "Consulta detalles de contacto guardados",
    icon: (
      <div className="w-10 h-10 rounded-lg flex items-center justify-center">
        <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="8" r="4" fill="#4285F4" />
          <path d="M4 20c0-4 4-6 8-6s8 2 8 6" fill="#4285F4" />
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "outlook-mail",
    name: "Correo electrónico de Outlook",
    description: "Busca y consulta tus correos electrónicos d...",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#0078D4] flex items-center justify-center">
        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" />
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "coursera",
    name: "Coursera",
    description: "Skill-building course videos",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#0056D2] flex items-center justify-center">
        <span className="text-white font-bold text-lg">C</span>
      </div>
    ),
    category: "lifestyle",
  },
  {
    id: "daloopa",
    name: "Daloopa",
    description: "Financial KPIs with links",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#FF6B35] flex items-center justify-center">
        <span className="text-white font-bold text-lg">δ</span>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "dropbox",
    name: "Dropbox",
    description: "Encuentra y accede a tus archivos almacen...",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#0061FF] flex items-center justify-center">
        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M6 2l6 4-6 4 6 4-6 4-6-4 6-4-6-4 6-4zm12 0l6 4-6 4 6 4-6 4-6-4 6-4-6-4 6-4z" />
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "egnyte",
    name: "Egnyte",
    description: "Explore and analyze your content",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#00A1E0] flex items-center justify-center">
        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L2 7v10l10 5 10-5V7L12 2z" />
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "figma",
    name: "Figma",
    description: "Make diagrams, slides, assets",
    icon: (
      <div className="w-10 h-10 flex items-center justify-center">
        <svg className="w-8 h-8" viewBox="0 0 38 57" fill="none">
          <path d="M19 28.5C19 23.2533 23.2533 19 28.5 19C33.7467 19 38 23.2533 38 28.5C38 33.7467 33.7467 38 28.5 38C23.2533 38 19 33.7467 19 28.5Z" fill="#1ABCFE" />
          <path d="M0 47.5C0 42.2533 4.25329 38 9.5 38H19V47.5C19 52.7467 14.7467 57 9.5 57C4.25329 57 0 52.7467 0 47.5Z" fill="#0ACF83" />
          <path d="M19 0V19H28.5C33.7467 19 38 14.7467 38 9.5C38 4.25329 33.7467 0 28.5 0H19Z" fill="#FF7262" />
          <path d="M0 9.5C0 14.7467 4.25329 19 9.5 19H19V0H9.5C4.25329 0 0 4.25329 0 9.5Z" fill="#F24E1E" />
          <path d="M0 28.5C0 33.7467 4.25329 38 9.5 38H19V19H9.5C4.25329 19 0 23.2533 0 28.5Z" fill="#A259FF" />
        </svg>
      </div>
    ),
    category: "productivity",
    verified: true,
  },
  {
    id: "github",
    name: "GitHub",
    description: "Accede a repositorios, problemas y solicitu...",
    icon: (
      <div className="w-10 h-10 rounded-full bg-[#24292F] flex items-center justify-center">
        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.341-3.369-1.341-.454-1.155-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.161 22 16.416 22 12c0-5.523-4.477-10-10-10z" />
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "gitlab-issues",
    name: "GitLab Issues",
    description: "Connect to sync GitLab Issues and merge r...",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#FC6D26] flex items-center justify-center">
        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L2 22h20L12 2z" />
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Busca y consulta correos electrónicos en tu...",
    icon: (
      <div className="w-10 h-10 flex items-center justify-center">
        <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
          <path d="M2 6l10 7 10-7v12H2V6z" fill="#EA4335" />
          <path d="M22 6l-10 7L2 6" stroke="#FBBC05" strokeWidth="2" />
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    description: "Consulta eventos y disponibilidad",
    icon: (
      <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-white border border-gray-200">
        <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="4" width="18" height="18" rx="2" fill="#4285F4" />
          <rect x="3" y="4" width="18" height="5" fill="#1967D2" />
          <text x="12" y="17" textAnchor="middle" fill="white" fontSize="8" fontWeight="bold">31</text>
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "google-drive",
    name: "Google Drive",
    description: "Busca y consulta archivos de tu Drive",
    icon: (
      <div className="w-10 h-10 flex items-center justify-center">
        <svg className="w-8 h-8" viewBox="0 0 87.3 78" fill="none">
          <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5l5.4 9.35z" fill="#0066DA" />
          <path d="M43.65 25L29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3L1.2 52.35c-.8 1.4-1.2 2.95-1.2 4.5h27.5l16.15-31.85z" fill="#00AC47" />
          <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.85L73.55 76.8z" fill="#EA4335" />
          <path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2L43.65 25z" fill="#00832D" />
          <path d="M59.85 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h41.8c1.6 0 3.15-.45 4.5-1.2L59.85 53z" fill="#2684FC" />
          <path d="M73.4 26.5l-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.85 53h27.45c0-1.55-.4-3.1-1.2-4.5l-12.7-22z" fill="#FFBA00" />
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "google-forms",
    name: "Google Forms",
    description: "Create and manage forms",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#673AB7] flex items-center justify-center">
        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
          <circle cx="9" cy="9" r="1.5" fill="white" />
          <rect x="12" y="8" width="5" height="2" rx="1" fill="white" />
          <circle cx="9" cy="13" r="1.5" fill="white" />
          <rect x="12" y="12" width="5" height="2" rx="1" fill="white" />
          <circle cx="9" cy="17" r="1.5" fill="white" />
          <rect x="12" y="16" width="5" height="2" rx="1" fill="white" />
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "help-scout",
    name: "Help Scout",
    description: "Connect to Help Scout mailboxes and ...",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#1292EE] flex items-center justify-center">
        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="12" r="10" />
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "hex",
    name: "Hex",
    description: "Ask questions, run analyses",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#1A1A2E] flex items-center justify-center">
        <span className="text-[#00D4AA] font-bold text-sm">HEX</span>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "highlevel",
    name: "HighLevel",
    description: "Interact with your CRM business data",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#00BFA5] flex items-center justify-center">
        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L2 7v10l10 5 10-5V7L12 2z" />
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "hubspot",
    name: "HubSpot",
    description: "Analiza datos de CRM y extrae información ...",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#FF7A59] flex items-center justify-center">
        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="12" r="8" />
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "hugging-face",
    name: "Hugging Face",
    description: "Inspect models, datasets, Spaces, and rese...",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#FFD21E] flex items-center justify-center">
        <span className="text-2xl">🤗</span>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "jotform",
    name: "Jotform",
    description: "Build forms, analyze responses",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#FF6100] flex items-center justify-center">
        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L2 7v10l10 5 10-5V7L12 2z" />
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "klaviyo",
    name: "Klaviyo",
    description: "Marketing performance insights",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#000000] flex items-center justify-center">
        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
          <rect x="4" y="4" width="16" height="16" />
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "linear",
    name: "Linear",
    description: "Busca y consulta incidencias y proyectos",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#5E6AD2] flex items-center justify-center">
        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M3 12a9 9 0 1118 0 9 9 0 01-18 0z" />
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "lovable",
    name: "Lovable",
    description: "Build apps and websites",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#FF6B6B] flex items-center justify-center">
        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "lseg",
    name: "LSEG",
    description: "LSEG financial data access",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#001F5C] flex items-center justify-center">
        <span className="text-white font-bold text-xs">LSEG</span>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "monday",
    name: "Monday.com",
    description: "Manage work in monday.com",
    icon: (
      <div className="w-10 h-10 rounded-lg flex items-center justify-center">
        <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
          <circle cx="6" cy="12" r="4" fill="#FF3D57" />
          <circle cx="12" cy="12" r="4" fill="#FFCB00" />
          <circle cx="18" cy="12" r="4" fill="#00D647" />
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "netlify",
    name: "Netlify",
    description: "Build and deploy on Netlify",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#00C7B7] flex items-center justify-center">
        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L2 7v10l10 5 10-5V7L12 2z" />
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "notion",
    name: "Notion",
    description: "Busca y consulta tus páginas de Notion",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-white border border-gray-200 flex items-center justify-center">
        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
          <path d="M4 4h16v16H4V4z" fill="white" stroke="black" strokeWidth="1.5" />
          <path d="M7 8h10M7 12h6" stroke="black" strokeWidth="1.5" />
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "pipedrive",
    name: "Pipedrive",
    description: "Connect to sync Pipedrive deals and conta...",
    icon: (
      <div className="w-10 h-10 rounded-full bg-[#25292C] flex items-center justify-center">
        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="8" fill="#25D366" />
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "pitchbook",
    name: "PitchBook",
    description: "Faster workflows with market intelligence",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#003366] flex items-center justify-center">
        <svg className="w-6 h-6 text-[#00AEEF]" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L2 7v10l10 5 10-5V7L12 2z" />
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "replit",
    name: "Replit",
    description: "Turn your ideas into real apps",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#F26207] flex items-center justify-center">
        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M2 6a2 2 0 012-2h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6zm4 2v8h2V8H6zm4 0v8h4a2 2 0 002-2v-4a2 2 0 00-2-2h-4zm2 2h2v4h-2v-4z" />
        </svg>
      </div>
    ),
    category: "productivity",
    verified: true,
  },
  {
    id: "sharepoint",
    name: "SharePoint",
    description: "Busca y extrae datos de sitios compartidos ...",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#038387] flex items-center justify-center">
        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="8" r="6" />
          <circle cx="17" cy="14" r="5" />
          <circle cx="8" cy="16" r="4" />
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "slack",
    name: "Slack",
    description: "Consulta chats y mensajes",
    icon: (
      <div className="w-10 h-10 rounded-lg flex items-center justify-center">
        <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
          <path d="M5.5 10a2 2 0 110-4 2 2 0 010 4zm0 0h5v5a2 2 0 11-4 0v-5h-1z" fill="#E01E5A" />
          <path d="M10.5 5.5a2 2 0 114 0 2 2 0 01-4 0zm0 0v5h5a2 2 0 110-4h-5v-1z" fill="#36C5F0" />
          <path d="M18.5 10a2 2 0 110 4 2 2 0 010-4zm0 0h-5v5a2 2 0 104 0v-5h1z" fill="#2EB67D" />
          <path d="M13.5 18.5a2 2 0 11-4 0 2 2 0 014 0zm0 0v-5h-5a2 2 0 100 4h5v1z" fill="#ECB22E" />
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "Payments and business tools",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#635BFF] flex items-center justify-center">
        <span className="text-white font-bold text-lg">S</span>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "teams",
    name: "Teams",
    description: "Consulta chats y mensajes",
    icon: (
      <div className="w-10 h-10 rounded-lg flex items-center justify-center">
        <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
          <path d="M20.625 4.5H3.375C2.96016 4.5 2.625 4.83516 2.625 5.25V18.75C2.625 19.1648 2.96016 19.5 3.375 19.5H20.625C21.0398 19.5 21.375 19.1648 21.375 18.75V5.25C21.375 4.83516 21.0398 4.5 20.625 4.5Z" fill="#5059C9" />
          <path d="M12 10.5H21.375V17.625C21.375 18.6605 20.5355 19.5 19.5 19.5H12V10.5Z" fill="#7B83EB" />
          <circle cx="16.5" cy="7.5" r="2.25" fill="#7B83EB" />
          <circle cx="9" cy="9" r="3" fill="#5059C9" />
          <path d="M13.5 12H4.5V18C4.5 18.8284 5.17157 19.5 6 19.5H12C12.8284 19.5 13.5 18.8284 13.5 18V12Z" fill="#7B83EB" />
        </svg>
      </div>
    ),
    category: "productivity",
    verified: true,
  },
  {
    id: "teamwork",
    name: "Teamwork.com",
    description: "Connect to sync Teamwork projects and tas...",
    icon: (
      <div className="w-10 h-10 rounded-full bg-[#6B5CE7] flex items-center justify-center">
        <span className="text-white font-bold text-lg">t.</span>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "vercel",
    name: "Vercel",
    description: "Search docs and deploy apps",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-black flex items-center justify-center">
        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L2 22h20L12 2z" />
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "zoho",
    name: "Zoho",
    description: "Connect to sync Zoho CRM records and act...",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#C8202B] flex items-center justify-center">
        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="12" r="8" />
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "zoho-desk",
    name: "Zoho Desk",
    description: "Connect to sync Zoho Desk tickets and cus...",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#2AB344] flex items-center justify-center">
        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="12" r="8" />
        </svg>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "zoom",
    name: "Zoom",
    description: "Smart meeting insights from Zoom",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#2D8CFF] flex items-center justify-center">
        <span className="text-white font-bold text-sm">zm</span>
      </div>
    ),
    category: "productivity",
  },
  {
    id: "apple-music",
    name: "Apple Music",
    description: "Build playlists and find music",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-gradient-to-b from-[#FA233B] to-[#FB5C74] flex items-center justify-center">
        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
        </svg>
      </div>
    ),
    category: "lifestyle",
  },
  {
    id: "booking",
    name: "Booking.com",
    description: "Find hotels, homes and more",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-[#003580] flex items-center justify-center">
        <span className="text-white font-bold text-lg">B.</span>
      </div>
    ),
    category: "lifestyle",
  },
  {
    id: "opentable",
    name: "OpenTable",
    description: "Find restaurant reservations",
    icon: (
      <div className="w-10 h-10 rounded-full bg-[#DA3743] flex items-center justify-center">
        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="12" r="8" />
        </svg>
      </div>
    ),
    category: "lifestyle",
  },
  {
    id: "tripadvisor",
    name: "Tripadvisor",
    description: "Book top-rated hotels",
    icon: (
      <div className="w-10 h-10 rounded-full bg-[#34E0A1] flex items-center justify-center">
        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
          <circle cx="8" cy="12" r="2.5" fill="white" stroke="#34E0A1" />
          <circle cx="16" cy="12" r="2.5" fill="white" stroke="#34E0A1" />
          <circle cx="8" cy="12" r="1" fill="black" />
          <circle cx="16" cy="12" r="1" fill="black" />
        </svg>
      </div>
    ),
    category: "lifestyle",
  },
  {
    id: "codex",
    name: "Codex",
    description: "Agente de código para investigación, análisis y ejecución avanzada",
    icon: (
      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#0F172A] via-[#1E293B] to-[#0B1324] flex items-center justify-center">
        <span className="text-white font-semibold text-sm tracking-wide">CX</span>
      </div>
    ),
    category: "featured",
  },
];

interface AppsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenGoogleForms?: () => void;
}

export function AppsDialog({ open, onOpenChange, onOpenGoogleForms }: AppsDialogProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("featured");

  const filteredApps = apps.filter((app) => {
    const matchesSearch =
      app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.description.toLowerCase().includes(searchQuery.toLowerCase());

    if (activeTab === "featured") return matchesSearch;
    if (activeTab === "productivity") return matchesSearch && app.category === "productivity";
    if (activeTab === "lifestyle") return matchesSearch && app.category === "lifestyle";
    return matchesSearch;
  });

  const handleAppClick = (appId: string) => {
    if (appId === "google-forms" && onOpenGoogleForms) {
      onOpenChange(false);
      onOpenGoogleForms();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden p-0" data-testid="apps-dialog">
        <div className="flex flex-col h-full max-h-[85vh]">
          <DialogHeader className="px-6 pt-6 pb-4 border-b flex-shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <DialogTitle className="text-2xl font-semibold">Aplicaciones</DialogTitle>
                <VisuallyHidden>
                  <DialogDescription>Explora e integra aplicaciones con IliaGPT</DialogDescription>
                </VisuallyHidden>
                <Badge variant="secondary" className="text-xs font-medium">BETA</Badge>
              </div>
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar aplicaciones"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-9"
                  data-testid="input-search-apps"
                />
              </div>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Chatea con tus aplicaciones favoritas en IliaGPT
            </p>
          </DialogHeader>

          <ScrollArea className="flex-1">
            <div className="px-6 py-4">
              <div className="relative rounded-2xl overflow-hidden mb-6 bg-gradient-to-r from-sky-100 via-sky-50 to-white dark:from-sky-900/30 dark:via-sky-800/20 dark:to-background">
                <div className="flex items-center p-6">
                  <div className="flex-1">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center mb-4">
                      <svg className="w-7 h-7 text-white" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                      </svg>
                    </div>
                    <h3 className="text-xl font-semibold mb-2">Haz prospección con Clay</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Encuentra contactos y personaliza la comunicación
                    </p>
                    <Button size="sm" className="rounded-full px-6" data-testid="button-view-clay">
                      Ver
                    </Button>
                  </div>
                  <div className="hidden md:block w-80 h-40 bg-white dark:bg-gray-800 rounded-xl shadow-lg p-4 transform rotate-3">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-sm font-medium text-blue-600">@Clay</span>
                      <span className="text-xs text-muted-foreground">find GTM Leaders at Conclusive AI</span>
                    </div>
                    <div className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700 rounded-lg mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded bg-purple-100 flex items-center justify-center">
                          <span className="text-xs">🎯</span>
                        </div>
                        <span className="text-sm font-medium">Conclusive AI</span>
                      </div>
                      <Button size="sm" variant="default" className="h-6 text-xs px-2 bg-green-500 hover:bg-green-600">
                        Open <ExternalLink className="w-3 h-3 ml-1" />
                      </Button>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-blue-100" />
                        <div>
                          <p className="text-xs font-medium">Daniel Cheung</p>
                          <p className="text-[10px] text-muted-foreground">Head of GTM Engineering</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-4">
                <TabsList className="bg-transparent p-0 h-auto gap-2">
                  <TabsTrigger
                    value="featured"
                    className={cn(
                      "px-4 py-2 rounded-full data-[state=active]:bg-foreground data-[state=active]:text-background",
                      "data-[state=inactive]:bg-muted data-[state=inactive]:text-foreground"
                    )}
                    data-testid="tab-featured"
                  >
                    Destacado
                  </TabsTrigger>
                  <TabsTrigger
                    value="productivity"
                    className={cn(
                      "px-4 py-2 rounded-full data-[state=active]:bg-foreground data-[state=active]:text-background",
                      "data-[state=inactive]:bg-muted data-[state=inactive]:text-foreground"
                    )}
                    data-testid="tab-productivity"
                  >
                    Productividad
                  </TabsTrigger>
                  <TabsTrigger
                    value="lifestyle"
                    className={cn(
                      "px-4 py-2 rounded-full data-[state=active]:bg-foreground data-[state=active]:text-background",
                      "data-[state=inactive]:bg-muted data-[state=inactive]:text-foreground"
                    )}
                    data-testid="tab-lifestyle"
                  >
                    Estilo de vida
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {filteredApps.map((app) => (
                  <button
                    key={app.id}
                    className="flex items-center gap-4 p-4 rounded-2xl bg-card border border-border/50 shadow-sm hover:shadow-md hover:border-[#A5A0FF]/40 hover:bg-[#A5A0FF]/[0.02] transition-all duration-300 text-left group"
                    onClick={() => handleAppClick(app.id)}
                    data-testid={`app-item-${app.id}`}
                  >
                    <div className="flex-shrink-0">{app.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium">{app.name}</span>
                        {app.verified && (
                          <svg className="w-4 h-4 text-blue-500" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                          </svg>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground truncate">{app.description}</p>
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                  </button>
                ))}
              </div>

              {filteredApps.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground animate-in fade-in duration-500">
                  <div className="w-16 h-16 mb-4 rounded-2xl bg-[#A5A0FF]/10 flex items-center justify-center">
                    <Search className="w-8 h-8 text-[#A5A0FF]" />
                  </div>
                  <p className="text-lg font-medium text-foreground">No se encontraron aplicaciones</p>
                  <p className="text-sm mt-1">Intenta con otro término de búsqueda.</p>
                </div>
              )}

              <div className="mt-6 pt-6 border-t">
                <h3 className="text-sm font-medium text-muted-foreground mb-3">Tus aplicaciones conectadas</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <button
                    className="flex items-center gap-4 p-4 rounded-2xl bg-[#A5A0FF]/5 hover:bg-[#A5A0FF]/10 border border-[#A5A0FF]/20 hover:border-[#A5A0FF]/40 shadow-sm hover:shadow-md transition-all duration-300 text-left group"
                    onClick={() => {
                      onOpenChange(false);
                      onOpenGoogleForms?.();
                    }}
                    data-testid="app-item-google-forms-connected"
                  >
                    <div className="w-10 h-10 rounded-lg bg-[#673AB7] flex items-center justify-center flex-shrink-0">
                      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
                        <circle cx="9" cy="9" r="1.5" fill="white" />
                        <rect x="12" y="8" width="5" height="2" rx="1" fill="white" />
                        <circle cx="9" cy="13" r="1.5" fill="white" />
                        <rect x="12" y="12" width="5" height="2" rx="1" fill="white" />
                        <circle cx="9" cy="17" r="1.5" fill="white" />
                        <rect x="12" y="16" width="5" height="2" rx="1" fill="white" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-purple-700 dark:text-purple-300">Formularios de Google</span>
                        <span className="px-1.5 py-0.5 text-[10px] font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded">CONECTADO</span>
                      </div>
                      <p className="text-sm text-purple-600/70 dark:text-purple-400/70 truncate">Crea y gestiona formularios con IA</p>
                    </div>
                    <ChevronRight className="h-5 w-5 text-purple-400 group-hover:text-purple-600 transition-colors flex-shrink-0" />
                  </button>
                </div>
              </div>
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
