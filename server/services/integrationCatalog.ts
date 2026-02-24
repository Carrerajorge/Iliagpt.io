import { db } from "../db";
import { integrationProviders, integrationTools } from "@shared/schema";

type SeedResult = {
  insertedProviders: number;
  insertedTools: number;
  providersTotal: number;
  toolsTotal: number;
};

// Intentionally minimal "starter catalog" so the Integrations UI is never empty.
// OAuth flows can be implemented incrementally per provider; the catalog itself is harmless metadata.
export const DEFAULT_INTEGRATION_PROVIDERS: Array<{
  id: string;
  name: string;
  description: string;
  iconUrl: string;
  authType: string;
  authConfig: Record<string, unknown>;
  category: string;
  isActive: string;
}> = [
  {
    id: "github",
    name: "GitHub",
    description: "Control de versiones y colaboración de código",
    iconUrl: "https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png",
    authType: "oauth2",
    authConfig: {
      authUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      scopes: ["repo", "user", "read:org"],
    },
    category: "development",
    isActive: "true",
  },
  {
    id: "figma",
    name: "Figma",
    description: "Diseño colaborativo y prototipado",
    iconUrl: "https://static.figma.com/app/icon/1/favicon.svg",
    authType: "oauth2",
    authConfig: {
      authUrl: "https://www.figma.com/oauth",
      tokenUrl: "https://www.figma.com/api/oauth/token",
      scopes: ["file_read", "file_write"],
    },
    category: "design",
    isActive: "true",
  },
  {
    id: "canva",
    name: "Canva",
    description: "Diseño gráfico y contenido visual",
    iconUrl: "https://static.canva.com/static/images/canva-logo.svg",
    authType: "oauth2",
    authConfig: {
      authUrl: "https://www.canva.com/api/oauth/authorize",
      tokenUrl: "https://www.canva.com/api/oauth/token",
      scopes: ["design:content:read", "design:content:write"],
    },
    category: "design",
    isActive: "true",
  },
  {
    id: "slack",
    name: "Slack",
    description: "Comunicación y mensajería de equipo",
    iconUrl: "https://a.slack-edge.com/80588/marketing/img/icons/icon_slack_hash_colored.png",
    authType: "oauth2",
    authConfig: {
      authUrl: "https://slack.com/oauth/v2/authorize",
      tokenUrl: "https://slack.com/api/oauth.v2.access",
      scopes: ["channels:read", "chat:write", "users:read"],
    },
    category: "communication",
    isActive: "true",
  },
  {
    id: "notion",
    name: "Notion",
    description: "Notas, documentación y gestión de proyectos",
    iconUrl: "https://www.notion.so/images/logo-ios.png",
    authType: "oauth2",
    authConfig: {
      authUrl: "https://api.notion.com/v1/oauth/authorize",
      tokenUrl: "https://api.notion.com/v1/oauth/token",
      scopes: [],
    },
    category: "productivity",
    isActive: "true",
  },
  {
    id: "google_drive",
    name: "Google Drive",
    description: "Almacenamiento y documentos en la nube",
    iconUrl: "https://ssl.gstatic.com/docs/doclist/images/drive_2022q3_32dp.png",
    authType: "oauth2",
    authConfig: {
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    },
    category: "productivity",
    isActive: "true",
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Enviar, leer y gestionar correos electrónicos",
    iconUrl: "https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico",
    authType: "oauth2",
    authConfig: {
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/gmail.modify",
      ],
    },
    category: "communication",
    isActive: "true",
  },
  {
    id: "google_calendar",
    name: "Google Calendar",
    description: "Sincroniza eventos, crea reuniones y gestiona tu agenda",
    iconUrl: "https://ssl.gstatic.com/calendar/images/dynamiclogo_2020q4/calendar_31_2x.png",
    authType: "oauth2",
    authConfig: {
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: [
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/calendar.events",
      ],
    },
    category: "productivity",
    isActive: "true",
  },
  {
    id: "outlook",
    name: "Outlook Mail",
    description: "Conecta tu correo de Microsoft para leer y enviar emails",
    iconUrl: "https://res.cdn.office.net/assets/mail/pwa/v1/pngs/outlook_48x48.png",
    authType: "oauth2",
    authConfig: {
      authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      scopes: [
        "https://graph.microsoft.com/Mail.Read",
        "https://graph.microsoft.com/Mail.Send",
      ],
    },
    category: "communication",
    isActive: "true",
  },
  {
    id: "outlook_calendar",
    name: "Outlook Calendar",
    description: "Sincroniza tu calendario de Microsoft y gestiona tus eventos",
    iconUrl: "https://res.cdn.office.net/assets/mail/pwa/v1/pngs/outlook_48x48.png",
    authType: "oauth2",
    authConfig: {
      authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      scopes: [
        "https://graph.microsoft.com/Calendars.ReadWrite",
        "https://graph.microsoft.com/Calendars.Read",
      ],
    },
    category: "productivity",
    isActive: "true",
  },
  {
    id: "google_forms",
    name: "Google Forms",
    description: "Crea y gestiona formularios, ve respuestas en tiempo real",
    iconUrl: "https://ssl.gstatic.com/docs/spreadsheets/forms/favicon3.ico",
    authType: "oauth2",
    authConfig: {
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: ["https://www.googleapis.com/auth/forms.body.readonly"],
    },
    category: "productivity",
    isActive: "true",
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    description: "Envía y recibe mensajes de WhatsApp",
    iconUrl: "https://static.whatsapp.net/rsrc.php/v3/y7/r/DSxOAUB0raA.png",
    authType: "custom",
    authConfig: {
      connectionType: "qr_code",
    },
    category: "communication",
    isActive: "true",
  },
  {
    id: "whatsapp_cloud",
    name: "WhatsApp Cloud API",
    description: "WhatsApp Business via Meta Cloud API (webhooks + envío de mensajes)",
    iconUrl: "https://static.whatsapp.net/rsrc.php/v3/y7/r/DSxOAUB0raA.png",
    authType: "custom",
    authConfig: {
      connectionType: "cloud_api",
    },
    category: "communication",
    isActive: "true",
  },
  {
    id: "telegram",
    name: "Telegram",
    description: "Bot de Telegram (webhook + envío de mensajes y archivos)",
    iconUrl: "https://telegram.org/img/t_logo.png",
    authType: "custom",
    authConfig: {
      connectionType: "bot_token",
    },
    category: "communication",
    isActive: "true",
  },
  {
    id: "messenger",
    name: "Facebook Messenger",
    description: "Messenger via Meta Page API (webhooks + envío de mensajes)",
    iconUrl: "https://upload.wikimedia.org/wikipedia/commons/b/be/Facebook_Messenger_logo_2020.svg",
    authType: "custom",
    authConfig: {
      connectionType: "page_token",
    },
    category: "communication",
    isActive: "true",
  },
  {
    id: "wechat",
    name: "WeChat Official Account",
    description: "Cuenta oficial de WeChat (customer service API)",
    iconUrl: "https://upload.wikimedia.org/wikipedia/commons/e/e0/WeChat.svg",
    authType: "custom",
    authConfig: {
      connectionType: "app_credentials",
    },
    category: "communication",
    isActive: "true",
  },
];

export const DEFAULT_INTEGRATION_TOOLS: Array<{
  id: string;
  providerId: string;
  name: string;
  description: string;
  requiredScopes: string[];
  dataAccessLevel: string;
  confirmationRequired: string;
  isActive: string;
}> = [
  {
    id: "github:list_repos",
    providerId: "github",
    name: "Listar repositorios",
    description: "Lista los repositorios del usuario",
    requiredScopes: ["repo"],
    dataAccessLevel: "read",
    confirmationRequired: "false",
    isActive: "true",
  },
  {
    id: "github:create_issue",
    providerId: "github",
    name: "Crear issue",
    description: "Crea un nuevo issue en un repositorio",
    requiredScopes: ["repo"],
    dataAccessLevel: "write",
    confirmationRequired: "true",
    isActive: "true",
  },
  {
    id: "github:get_file",
    providerId: "github",
    name: "Obtener archivo",
    description: "Lee el contenido de un archivo",
    requiredScopes: ["repo"],
    dataAccessLevel: "read",
    confirmationRequired: "false",
    isActive: "true",
  },
  {
    id: "figma:get_file",
    providerId: "figma",
    name: "Obtener archivo",
    description: "Obtiene información de un archivo Figma",
    requiredScopes: ["file_read"],
    dataAccessLevel: "read",
    confirmationRequired: "false",
    isActive: "true",
  },
  {
    id: "figma:export_frame",
    providerId: "figma",
    name: "Exportar frame",
    description: "Exporta un frame como imagen",
    requiredScopes: ["file_read"],
    dataAccessLevel: "read",
    confirmationRequired: "false",
    isActive: "true",
  },
  {
    id: "canva:list_designs",
    providerId: "canva",
    name: "Listar diseños",
    description: "Lista los diseños del usuario",
    requiredScopes: ["design:content:read"],
    dataAccessLevel: "read",
    confirmationRequired: "false",
    isActive: "true",
  },
  {
    id: "canva:export_design",
    providerId: "canva",
    name: "Exportar diseño",
    description: "Exporta un diseño como imagen",
    requiredScopes: ["design:content:read"],
    dataAccessLevel: "read",
    confirmationRequired: "false",
    isActive: "true",
  },
  {
    id: "slack:send_message",
    providerId: "slack",
    name: "Enviar mensaje",
    description: "Envía un mensaje a un canal",
    requiredScopes: ["chat:write"],
    dataAccessLevel: "write",
    confirmationRequired: "true",
    isActive: "true",
  },
  {
    id: "slack:list_channels",
    providerId: "slack",
    name: "Listar canales",
    description: "Lista los canales disponibles",
    requiredScopes: ["channels:read"],
    dataAccessLevel: "read",
    confirmationRequired: "false",
    isActive: "true",
  },
  {
    id: "notion:search",
    providerId: "notion",
    name: "Buscar páginas",
    description: "Busca páginas en el workspace",
    requiredScopes: [],
    dataAccessLevel: "read",
    confirmationRequired: "false",
    isActive: "true",
  },
  {
    id: "notion:get_page",
    providerId: "notion",
    name: "Obtener página",
    description: "Obtiene el contenido de una página",
    requiredScopes: [],
    dataAccessLevel: "read",
    confirmationRequired: "false",
    isActive: "true",
  },
  {
    id: "google_drive:list_files",
    providerId: "google_drive",
    name: "Listar archivos",
    description: "Lista archivos en Drive",
    requiredScopes: ["https://www.googleapis.com/auth/drive.readonly"],
    dataAccessLevel: "read",
    confirmationRequired: "false",
    isActive: "true",
  },
  {
    id: "google_drive:get_file",
    providerId: "google_drive",
    name: "Obtener archivo",
    description: "Obtiene contenido de un archivo",
    requiredScopes: ["https://www.googleapis.com/auth/drive.readonly"],
    dataAccessLevel: "read",
    confirmationRequired: "false",
    isActive: "true",
  },
  // Gmail tools
  {
    id: "gmail:read_emails",
    providerId: "gmail",
    name: "Leer correos",
    description: "Lee los correos electrónicos del usuario",
    requiredScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    dataAccessLevel: "read",
    confirmationRequired: "false",
    isActive: "true",
  },
  {
    id: "gmail:send_email",
    providerId: "gmail",
    name: "Enviar correo",
    description: "Envía un correo electrónico",
    requiredScopes: ["https://www.googleapis.com/auth/gmail.send"],
    dataAccessLevel: "write",
    confirmationRequired: "true",
    isActive: "true",
  },
  {
    id: "gmail:search_emails",
    providerId: "gmail",
    name: "Buscar correos",
    description: "Busca correos por criterios",
    requiredScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    dataAccessLevel: "read",
    confirmationRequired: "false",
    isActive: "true",
  },
  // Google Calendar tools
  {
    id: "google_calendar:list_events",
    providerId: "google_calendar",
    name: "Listar eventos",
    description: "Lista los eventos del calendario",
    requiredScopes: ["https://www.googleapis.com/auth/calendar.readonly"],
    dataAccessLevel: "read",
    confirmationRequired: "false",
    isActive: "true",
  },
  {
    id: "google_calendar:create_event",
    providerId: "google_calendar",
    name: "Crear evento",
    description: "Crea un nuevo evento en el calendario",
    requiredScopes: ["https://www.googleapis.com/auth/calendar.events"],
    dataAccessLevel: "write",
    confirmationRequired: "true",
    isActive: "true",
  },
  {
    id: "google_calendar:find_free_slots",
    providerId: "google_calendar",
    name: "Buscar horarios libres",
    description: "Encuentra horarios disponibles para reuniones",
    requiredScopes: ["https://www.googleapis.com/auth/calendar.readonly"],
    dataAccessLevel: "read",
    confirmationRequired: "false",
    isActive: "true",
  },
  // Outlook Mail tools
  {
    id: "outlook:read_emails",
    providerId: "outlook",
    name: "Leer correos",
    description: "Lee los correos de Outlook",
    requiredScopes: ["https://graph.microsoft.com/Mail.Read"],
    dataAccessLevel: "read",
    confirmationRequired: "false",
    isActive: "true",
  },
  {
    id: "outlook:send_email",
    providerId: "outlook",
    name: "Enviar correo",
    description: "Envía un correo desde Outlook",
    requiredScopes: ["https://graph.microsoft.com/Mail.Send"],
    dataAccessLevel: "write",
    confirmationRequired: "true",
    isActive: "true",
  },
  // Outlook Calendar tools
  {
    id: "outlook_calendar:list_events",
    providerId: "outlook_calendar",
    name: "Listar eventos",
    description: "Lista los eventos del calendario de Outlook",
    requiredScopes: ["https://graph.microsoft.com/Calendars.Read"],
    dataAccessLevel: "read",
    confirmationRequired: "false",
    isActive: "true",
  },
  {
    id: "outlook_calendar:create_event",
    providerId: "outlook_calendar",
    name: "Crear evento",
    description: "Crea un nuevo evento en el calendario de Outlook",
    requiredScopes: ["https://graph.microsoft.com/Calendars.ReadWrite"],
    dataAccessLevel: "write",
    confirmationRequired: "true",
    isActive: "true",
  },
  // Google Forms tools
  {
    id: "google_forms:list_forms",
    providerId: "google_forms",
    name: "Listar formularios",
    description: "Lista los formularios del usuario",
    requiredScopes: ["https://www.googleapis.com/auth/forms.body.readonly"],
    dataAccessLevel: "read",
    confirmationRequired: "false",
    isActive: "true",
  },
  {
    id: "google_forms:get_responses",
    providerId: "google_forms",
    name: "Ver respuestas",
    description: "Obtiene las respuestas de un formulario",
    requiredScopes: ["https://www.googleapis.com/auth/forms.body.readonly"],
    dataAccessLevel: "read",
    confirmationRequired: "false",
    isActive: "true",
  },
  // WhatsApp tools
  {
    id: "whatsapp:send_message",
    providerId: "whatsapp",
    name: "Enviar mensaje",
    description: "Envía un mensaje de WhatsApp",
    requiredScopes: [],
    dataAccessLevel: "write",
    confirmationRequired: "true",
    isActive: "true",
  },
  {
    id: "whatsapp:read_messages",
    providerId: "whatsapp",
    name: "Leer mensajes",
    description: "Lee los mensajes recientes de WhatsApp",
    requiredScopes: [],
    dataAccessLevel: "read",
    confirmationRequired: "false",
    isActive: "true",
  },
  {
    id: "whatsapp_cloud:send_message",
    providerId: "whatsapp_cloud",
    name: "Enviar mensaje (Cloud)",
    description: "Envía un mensaje de WhatsApp vía Cloud API",
    requiredScopes: [],
    dataAccessLevel: "write",
    confirmationRequired: "true",
    isActive: "true",
  },
  {
    id: "telegram:send_message",
    providerId: "telegram",
    name: "Enviar mensaje",
    description: "Envía un mensaje por Telegram",
    requiredScopes: [],
    dataAccessLevel: "write",
    confirmationRequired: "false",
    isActive: "true",
  },
  {
    id: "messenger:send_message",
    providerId: "messenger",
    name: "Enviar mensaje por Messenger",
    description: "Envía un mensaje de texto a un usuario de Messenger",
    requiredScopes: ["pages_messaging"],
    dataAccessLevel: "write",
    confirmationRequired: "false",
    isActive: "true",
  },
  {
    id: "wechat:send_message",
    providerId: "wechat",
    name: "Enviar mensaje por WeChat",
    description: "Envía un mensaje de texto a un usuario de WeChat",
    requiredScopes: [],
    dataAccessLevel: "write",
    confirmationRequired: "false",
    isActive: "true",
  },
];

export async function seedIntegrationCatalog(): Promise<SeedResult> {
  const insertedProviders = await db
    .insert(integrationProviders)
    .values(DEFAULT_INTEGRATION_PROVIDERS as any)
    .onConflictDoNothing()
    .returning({ id: integrationProviders.id });

  const insertedTools = await db
    .insert(integrationTools)
    .values(DEFAULT_INTEGRATION_TOOLS as any)
    .onConflictDoNothing()
    .returning({ id: integrationTools.id });

  const providersTotal = (await db.select({ id: integrationProviders.id }).from(integrationProviders)).length;
  const toolsTotal = (await db.select({ id: integrationTools.id }).from(integrationTools)).length;

  return {
    insertedProviders: insertedProviders.length,
    insertedTools: insertedTools.length,
    providersTotal,
    toolsTotal,
  };
}

export async function ensureIntegrationCatalogSeeded(): Promise<SeedResult> {
  // Always upsert to ensure new providers/tools are added when the catalog grows
  return seedIntegrationCatalog();
}
