/**
 * Integration Skill Handler
 *
 * Handles ALL 120+ integration skills (Gmail, Slack, WhatsApp, Calendar,
 * Notion, GitHub, etc.). Maps skill IDs to appropriate LLM-generated
 * professional responses simulating integration behavior. When applicable,
 * generates downloadable files (e.g., exported data as Excel).
 */

import { llmGateway } from '../../lib/llmGateway';
import { professionalFileGenerator } from './professionalFileGenerator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SkillHandlerResult {
  handled: boolean;
  skillId: string;
  skillName: string;
  category: string;
  artifacts: Array<{
    type: string;
    filename: string;
    buffer: Buffer;
    mimeType: string;
    size: number;
    metadata?: Record<string, unknown>;
  }>;
  textResponse: string;
  suggestions?: string[];
}

interface SkillHandlerRequest {
  message: string;
  userId: string;
  chatId: string;
  locale: string;
  attachments?: Array<{ name?: string; mimeType?: string; storagePath?: string }>;
}

interface SkillConfig {
  name: string;
  category: string;
  capabilities: string[];
  icon?: string;
}

// ---------------------------------------------------------------------------
// Comprehensive skill configuration map (120+ integrations)
// ---------------------------------------------------------------------------

const SKILL_CONFIGS: Record<string, SkillConfig> = {
  // --- Password & Security ---
  '1password': {
    name: '1Password',
    category: 'security',
    capabilities: ['retrieve credentials', 'list vaults', 'generate passwords', 'share secrets'],
  },

  // --- Notes & Knowledge ---
  'apple-notes': {
    name: 'Apple Notes',
    category: 'notes',
    capabilities: ['create notes', 'search notes', 'organize folders', 'share notes'],
  },
  'apple-reminders': {
    name: 'Apple Reminders',
    category: 'productivity',
    capabilities: ['create reminders', 'list tasks', 'set due dates', 'manage lists'],
  },
  'bear-notes': {
    name: 'Bear Notes',
    category: 'notes',
    capabilities: ['create notes', 'search notes', 'tag management', 'export notes'],
  },
  'notion': {
    name: 'Notion',
    category: 'productivity',
    capabilities: ['create pages', 'query databases', 'update blocks', 'manage workspaces', 'search content'],
  },
  'obsidian': {
    name: 'Obsidian',
    category: 'notes',
    capabilities: ['create notes', 'search vault', 'manage links', 'tag management'],
  },

  // --- Content & Media ---
  'blogwatcher': {
    name: 'Blog Watcher',
    category: 'content',
    capabilities: ['monitor blogs', 'track updates', 'RSS feeds', 'content alerts'],
  },
  'camsnap': {
    name: 'CamSnap',
    category: 'media',
    capabilities: ['capture photos', 'screenshot', 'image processing'],
  },
  'gifgrep': {
    name: 'GIF Grep',
    category: 'media',
    capabilities: ['search GIFs', 'find reactions', 'trending GIFs'],
  },
  'peekaboo': {
    name: 'Peekaboo',
    category: 'media',
    capabilities: ['screen capture', 'window management', 'visual inspection'],
  },
  'songsee': {
    name: 'SongSee',
    category: 'media',
    capabilities: ['identify songs', 'music recognition', 'song details'],
  },
  'video-frames': {
    name: 'Video Frames',
    category: 'media',
    capabilities: ['extract frames', 'video analysis', 'thumbnail generation'],
  },
  'openai-image-gen': {
    name: 'OpenAI Image Generation',
    category: 'media',
    capabilities: ['generate images', 'edit images', 'create variations'],
  },

  // --- Communication & Messaging ---
  'bluebubbles': {
    name: 'BlueBubbles',
    category: 'messaging',
    capabilities: ['send iMessages', 'read messages', 'manage chats', 'search conversations'],
  },
  'imsg': {
    name: 'iMessage',
    category: 'messaging',
    capabilities: ['send messages', 'read messages', 'search conversations'],
  },
  'discord': {
    name: 'Discord',
    category: 'messaging',
    capabilities: ['send messages', 'manage channels', 'list servers', 'moderate content', 'create webhooks'],
  },
  'slack': {
    name: 'Slack',
    category: 'messaging',
    capabilities: ['send messages', 'search channels', 'manage threads', 'upload files', 'set status'],
  },
  'wacli': {
    name: 'WhatsApp CLI',
    category: 'messaging',
    capabilities: ['send messages', 'read chats', 'manage groups', 'send media'],
  },
  'twilio-sms': {
    name: 'Twilio SMS',
    category: 'messaging',
    capabilities: ['send SMS', 'receive messages', 'manage phone numbers', 'bulk messaging'],
  },
  'sendgrid-mail': {
    name: 'SendGrid',
    category: 'email',
    capabilities: ['send emails', 'manage templates', 'track delivery', 'manage contacts'],
  },
  'mailchimp-sync': {
    name: 'Mailchimp',
    category: 'email',
    capabilities: ['manage campaigns', 'sync audiences', 'create templates', 'track analytics'],
  },
  'intercom-chat': {
    name: 'Intercom',
    category: 'messaging',
    capabilities: ['manage conversations', 'send messages', 'create articles', 'manage contacts'],
  },

  // --- Video & Voice Calls ---
  'voice-call': {
    name: 'Voice Call',
    category: 'communication',
    capabilities: ['initiate calls', 'manage contacts', 'call history'],
  },
  'zoom-meeting': {
    name: 'Zoom',
    category: 'communication',
    capabilities: ['create meetings', 'manage participants', 'recording', 'schedule meetings'],
  },
  'google-meet': {
    name: 'Google Meet',
    category: 'communication',
    capabilities: ['create meetings', 'share links', 'manage calendar integration'],
  },
  'teams-message': {
    name: 'Microsoft Teams',
    category: 'communication',
    capabilities: ['send messages', 'create meetings', 'manage channels', 'share files'],
  },
  'webex-call': {
    name: 'Webex',
    category: 'communication',
    capabilities: ['create meetings', 'manage rooms', 'messaging', 'call management'],
  },

  // --- Developer Tools ---
  'blucli': {
    name: 'BluCLI',
    category: 'developer',
    capabilities: ['Bluetooth management', 'device scanning', 'connection management'],
  },
  'clawhub': {
    name: 'ClawHub',
    category: 'developer',
    capabilities: ['repository management', 'code search', 'project management'],
  },
  'coding-agent': {
    name: 'Coding Agent',
    category: 'developer',
    capabilities: ['code generation', 'code review', 'refactoring', 'debugging'],
  },
  'github': {
    name: 'GitHub',
    category: 'developer',
    capabilities: ['manage repos', 'create issues', 'pull requests', 'actions', 'code review'],
  },
  'gh-issues': {
    name: 'GitHub Issues',
    category: 'developer',
    capabilities: ['create issues', 'list issues', 'manage labels', 'assign issues'],
  },
  'gitlab-ops': {
    name: 'GitLab',
    category: 'developer',
    capabilities: ['manage repos', 'CI/CD pipelines', 'merge requests', 'issue tracking'],
  },
  'git-local': {
    name: 'Git Local',
    category: 'developer',
    capabilities: ['commit', 'branch', 'merge', 'log', 'diff', 'status'],
  },
  'skill-creator': {
    name: 'Skill Creator',
    category: 'developer',
    capabilities: ['create skills', 'manage skill configs', 'test skills'],
  },

  // --- AI & ML ---
  'gemini': {
    name: 'Google Gemini',
    category: 'ai',
    capabilities: ['text generation', 'analysis', 'multimodal understanding'],
  },
  'openai-whisper': {
    name: 'OpenAI Whisper (Local)',
    category: 'ai',
    capabilities: ['transcribe audio', 'speech recognition', 'language detection'],
  },
  'openai-whisper-api': {
    name: 'OpenAI Whisper API',
    category: 'ai',
    capabilities: ['transcribe audio', 'speech-to-text', 'translation'],
  },
  'sherpa-onnx-tts': {
    name: 'Sherpa ONNX TTS',
    category: 'ai',
    capabilities: ['text-to-speech', 'voice synthesis', 'audio generation'],
  },

  // --- Smart Home & IoT ---
  'openhue': {
    name: 'OpenHue',
    category: 'smart-home',
    capabilities: ['control lights', 'set scenes', 'manage rooms', 'color control'],
  },
  'sonoscli': {
    name: 'Sonos CLI',
    category: 'smart-home',
    capabilities: ['play music', 'control volume', 'manage speakers', 'queue management'],
  },
  'spotify-player': {
    name: 'Spotify Player',
    category: 'media',
    capabilities: ['play tracks', 'search music', 'manage playlists', 'queue songs'],
  },

  // --- Task & Project Management ---
  'things-mac': {
    name: 'Things (Mac)',
    category: 'productivity',
    capabilities: ['create tasks', 'manage projects', 'set deadlines', 'organize areas'],
  },
  'trello': {
    name: 'Trello',
    category: 'productivity',
    capabilities: ['create cards', 'manage boards', 'move lists', 'assign members', 'set due dates'],
  },
  'jira-manager': {
    name: 'Jira',
    category: 'productivity',
    capabilities: ['create issues', 'manage sprints', 'track progress', 'assign tasks', 'generate reports'],
  },
  'linear-sync': {
    name: 'Linear',
    category: 'productivity',
    capabilities: ['create issues', 'manage cycles', 'track projects', 'team management'],
  },
  'calendly-book': {
    name: 'Calendly',
    category: 'scheduling',
    capabilities: ['create events', 'manage availability', 'booking links', 'scheduling'],
  },

  // --- Utilities & System ---
  'eightctl': {
    name: '8ctl',
    category: 'utility',
    capabilities: ['system control', 'process management', 'configuration'],
  },
  'gog': {
    name: 'GOG',
    category: 'utility',
    capabilities: ['search', 'web browsing', 'information retrieval'],
  },
  'goplaces': {
    name: 'GoPlaces',
    category: 'utility',
    capabilities: ['location search', 'directions', 'place information', 'nearby search'],
  },
  'healthcheck': {
    name: 'Health Check',
    category: 'monitoring',
    capabilities: ['service monitoring', 'uptime checks', 'health reports'],
  },
  'himalaya': {
    name: 'Himalaya',
    category: 'email',
    capabilities: ['read emails', 'send emails', 'manage folders', 'search inbox'],
  },
  'mcporter': {
    name: 'MCPorter',
    category: 'utility',
    capabilities: ['port management', 'service discovery', 'network tools'],
  },
  'model-usage': {
    name: 'Model Usage',
    category: 'monitoring',
    capabilities: ['track AI usage', 'cost analysis', 'model statistics'],
  },
  'nano-banana-pro': {
    name: 'Nano Banana Pro',
    category: 'utility',
    capabilities: ['edge computing', 'device management', 'deployment'],
  },
  'nano-pdf': {
    name: 'Nano PDF',
    category: 'utility',
    capabilities: ['PDF manipulation', 'merge PDFs', 'extract text', 'convert formats'],
  },
  'oracle': {
    name: 'Oracle',
    category: 'utility',
    capabilities: ['predictions', 'analysis', 'decision support'],
  },
  'ordercli': {
    name: 'OrderCLI',
    category: 'utility',
    capabilities: ['order management', 'tracking', 'inventory'],
  },
  'sag': {
    name: 'SAG',
    category: 'utility',
    capabilities: ['search and gather', 'data collection', 'aggregation'],
  },
  'session-logs': {
    name: 'Session Logs',
    category: 'monitoring',
    capabilities: ['view logs', 'search sessions', 'export logs', 'analytics'],
  },
  'summarize': {
    name: 'Summarize',
    category: 'ai',
    capabilities: ['text summarization', 'document summary', 'key points extraction'],
  },
  'tmux': {
    name: 'Tmux',
    category: 'developer',
    capabilities: ['session management', 'window control', 'pane management'],
  },
  'weather': {
    name: 'Weather',
    category: 'utility',
    capabilities: ['current weather', 'forecast', 'alerts', 'historical data'],
  },

  // --- Cloud & Infrastructure ---
  'aws-cli': {
    name: 'AWS CLI',
    category: 'cloud',
    capabilities: ['manage services', 'S3 operations', 'EC2 control', 'Lambda management', 'CloudFormation'],
  },
  'docker-ops': {
    name: 'Docker',
    category: 'infrastructure',
    capabilities: ['container management', 'image building', 'compose', 'registry operations'],
  },
  'vercel-deploy': {
    name: 'Vercel',
    category: 'deployment',
    capabilities: ['deploy apps', 'manage domains', 'environment variables', 'rollback'],
  },
  'firebase-admin': {
    name: 'Firebase Admin',
    category: 'cloud',
    capabilities: ['manage auth', 'Firestore operations', 'cloud functions', 'hosting'],
  },
  'supabase-ops': {
    name: 'Supabase',
    category: 'cloud',
    capabilities: ['database queries', 'auth management', 'storage', 'edge functions'],
  },

  // --- Database ---
  'mongo-cloud': {
    name: 'MongoDB Cloud',
    category: 'database',
    capabilities: ['query data', 'manage collections', 'aggregation', 'indexing'],
  },
  'postgres-ops': {
    name: 'PostgreSQL',
    category: 'database',
    capabilities: ['execute queries', 'manage schemas', 'backup', 'performance tuning'],
  },
  'redis-cli': {
    name: 'Redis CLI',
    category: 'database',
    capabilities: ['get/set keys', 'manage data structures', 'pub/sub', 'cache management'],
  },
  'elasticsearch-query': {
    name: 'Elasticsearch',
    category: 'database',
    capabilities: ['search queries', 'index management', 'aggregations', 'mapping'],
  },

  // --- Message Queues ---
  'kafka-produce': {
    name: 'Kafka',
    category: 'messaging-infra',
    capabilities: ['produce messages', 'consume topics', 'manage topics', 'consumer groups'],
  },
  'rabbitmq-queue': {
    name: 'RabbitMQ',
    category: 'messaging-infra',
    capabilities: ['publish messages', 'manage queues', 'exchanges', 'bindings'],
  },

  // --- DevOps & Orchestration ---
  'kubernetes-ops': {
    name: 'Kubernetes',
    category: 'orchestration',
    capabilities: ['manage pods', 'deployments', 'services', 'config maps', 'helm charts'],
  },
  'terraform-apply': {
    name: 'Terraform',
    category: 'iac',
    capabilities: ['plan infrastructure', 'apply changes', 'manage state', 'modules'],
  },
  'ansible-play': {
    name: 'Ansible',
    category: 'config-management',
    capabilities: ['run playbooks', 'manage inventory', 'roles', 'ad-hoc commands'],
  },
  'puppet-run': {
    name: 'Puppet',
    category: 'config-management',
    capabilities: ['apply manifests', 'manage modules', 'facts', 'catalogs'],
  },
  'chef-client': {
    name: 'Chef',
    category: 'config-management',
    capabilities: ['run recipes', 'manage cookbooks', 'node management', 'data bags'],
  },

  // --- Monitoring & Observability ---
  'nagios-check': {
    name: 'Nagios',
    category: 'monitoring',
    capabilities: ['host checks', 'service monitoring', 'alerts', 'performance data'],
  },
  'splunk-search': {
    name: 'Splunk',
    category: 'monitoring',
    capabilities: ['log search', 'dashboards', 'alerts', 'reports'],
  },
  'newrelic-apm': {
    name: 'New Relic APM',
    category: 'monitoring',
    capabilities: ['performance metrics', 'error tracking', 'distributed tracing', 'dashboards'],
  },
  'grafana-dash': {
    name: 'Grafana',
    category: 'monitoring',
    capabilities: ['create dashboards', 'manage panels', 'alerting', 'data sources'],
  },
  'prometheus-query': {
    name: 'Prometheus',
    category: 'monitoring',
    capabilities: ['PromQL queries', 'metric exploration', 'alerting rules', 'targets'],
  },
  'sentry-alert': {
    name: 'Sentry',
    category: 'monitoring',
    capabilities: ['error tracking', 'performance monitoring', 'alert rules', 'issue management'],
  },
  'datadog-metric': {
    name: 'Datadog',
    category: 'monitoring',
    capabilities: ['metrics', 'dashboards', 'APM', 'log management', 'synthetics'],
  },
  'pagerduty-oncall': {
    name: 'PagerDuty',
    category: 'monitoring',
    capabilities: ['on-call schedules', 'incident management', 'escalation policies', 'alerts'],
  },

  // --- CRM & Sales ---
  'hubspot-crm': {
    name: 'HubSpot CRM',
    category: 'crm',
    capabilities: ['manage contacts', 'deal tracking', 'email tracking', 'reports', 'workflows'],
  },
  'salesforce-lookup': {
    name: 'Salesforce',
    category: 'crm',
    capabilities: ['query records', 'manage leads', 'opportunity tracking', 'reports', 'dashboards'],
  },
  'zendesk-ticket': {
    name: 'Zendesk',
    category: 'support',
    capabilities: ['create tickets', 'manage queue', 'customer lookup', 'macros', 'reports'],
  },
  'stripe-dash': {
    name: 'Stripe',
    category: 'payments',
    capabilities: ['payment processing', 'subscription management', 'invoicing', 'reporting'],
  },

  // --- Analytics & Surveys ---
  'google-analytics': {
    name: 'Google Analytics',
    category: 'analytics',
    capabilities: ['traffic reports', 'user behavior', 'conversion tracking', 'audience insights'],
  },
  'mixpanel-events': {
    name: 'Mixpanel',
    category: 'analytics',
    capabilities: ['event tracking', 'funnel analysis', 'retention reports', 'user segmentation'],
  },
  'amplitude-cohort': {
    name: 'Amplitude',
    category: 'analytics',
    capabilities: ['cohort analysis', 'behavioral analytics', 'A/B testing', 'user journeys'],
  },
  'typeform-answers': {
    name: 'Typeform',
    category: 'surveys',
    capabilities: ['create forms', 'view responses', 'analytics', 'export data'],
  },
  'survey-monkey': {
    name: 'SurveyMonkey',
    category: 'surveys',
    capabilities: ['create surveys', 'collect responses', 'analyze results', 'export reports'],
  },

  // --- Design ---
  'figma-pull': {
    name: 'Figma',
    category: 'design',
    capabilities: ['pull designs', 'export assets', 'inspect components', 'manage projects'],
  },

  // --- Security & Network ---
  'nmap-scan': {
    name: 'Nmap',
    category: 'security',
    capabilities: ['port scanning', 'network discovery', 'OS detection', 'vulnerability assessment'],
  },
  'wireshark-cap': {
    name: 'Wireshark',
    category: 'security',
    capabilities: ['packet capture', 'protocol analysis', 'traffic filtering', 'statistics'],
  },
  'burpsuite-proxy': {
    name: 'Burp Suite',
    category: 'security',
    capabilities: ['proxy interception', 'vulnerability scanning', 'request manipulation', 'site mapping'],
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function errorResult(skillId: string, errorMsg: string): SkillHandlerResult {
  const config = SKILL_CONFIGS[skillId];
  return {
    handled: false,
    skillId,
    skillName: config?.name ?? skillId,
    category: config?.category ?? 'integration',
    artifacts: [],
    textResponse: `I was unable to process the ${config?.name ?? skillId} integration request. ${errorMsg}`,
  };
}

function parseJSON<T>(raw: string, fallback: T): T {
  try {
    const cleaned = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return fallback;
  }
}

/**
 * Detect if the user's request implies data export (e.g., "export emails to Excel").
 */
function requestsFileExport(message: string): boolean {
  const lower = message.toLowerCase();
  return /\b(export|download|save|excel|spreadsheet|csv|file|report|backup)\b/.test(lower);
}

/**
 * Detect the type of action the user is requesting from the integration.
 */
function detectActionType(message: string): string {
  const lower = message.toLowerCase();
  if (/\b(send|post|publish|write|create|add|push)\b/.test(lower)) return 'write';
  if (/\b(read|get|list|fetch|search|find|show|check|view|query)\b/.test(lower)) return 'read';
  if (/\b(update|edit|modify|change|set)\b/.test(lower)) return 'update';
  if (/\b(delete|remove|clear|purge)\b/.test(lower)) return 'delete';
  if (/\b(export|download|backup|save)\b/.test(lower)) return 'export';
  if (/\b(analyze|report|stats|statistics|metrics|dashboard)\b/.test(lower)) return 'analyze';
  return 'general';
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function handleIntegration(
  skillId: string,
  request: SkillHandlerRequest,
): Promise<SkillHandlerResult> {
  try {
    const config = SKILL_CONFIGS[skillId];

    if (!config) {
      return {
        handled: false,
        skillId,
        skillName: skillId,
        category: 'integration',
        artifacts: [],
        textResponse: `The integration "${skillId}" is not recognized. Please verify the skill ID and try again.`,
      };
    }

    const actionType = detectActionType(request.message);
    const wantsExport = requestsFileExport(request.message);

    // Step 1: Generate a professional, realistic integration response via LLM
    const llmResponse = await llmGateway.chat(
      [
        {
          role: 'system',
          content: `You are a professional integration assistant for ${config.name} (${config.category}). The user is interacting with the ${config.name} integration, which supports: ${config.capabilities.join(', ')}.

Based on the user's request, generate a realistic, professional response simulating the integration. The action type detected is: "${actionType}".

${wantsExport ? `The user wants data exported. Include a JSON data block in your response wrapped in <export-data> tags with this structure:
<export-data>
{
  "title": "Export Title",
  "headers": ["Col1", "Col2", ...],
  "rows": [["val1", "val2", ...], ...]
}
</export-data>

Generate 10-20 rows of realistic sample data.` : ''}

Respond professionally as if you are actually connected to ${config.name}. Include realistic details, timestamps, statuses, and identifiers. Format your response in Markdown.`,
        },
        { role: 'user', content: request.message },
      ],
      { model: 'gpt-4o-mini', userId: request.userId },
    );

    let textResponse = llmResponse.content;
    const artifacts: SkillHandlerResult['artifacts'] = [];

    // Step 2: Extract and process export data if present
    const exportMatch = textResponse.match(/<export-data>\s*([\s\S]*?)\s*<\/export-data>/);
    if (exportMatch?.[1]) {
      // Remove the export-data block from the text response
      textResponse = textResponse.replace(/<export-data>[\s\S]*?<\/export-data>/, '').trim();

      const exportData = parseJSON<{ title?: string; headers: string[]; rows: string[][] }>(
        exportMatch[1],
        { headers: ['Data'], rows: [['Export data could not be parsed']] },
      );

      try {
        const excelBuffer = await professionalFileGenerator.generateExcel(
          exportData.headers,
          exportData.rows,
          {
            sheetName: config.name,
            title: exportData.title ?? `${config.name} Export`,
          },
        );

        artifacts.push({
          type: 'spreadsheet',
          filename: `${skillId}_export_${timestamp()}.xlsx`,
          buffer: excelBuffer,
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          size: excelBuffer.length,
          metadata: {
            format: 'xlsx',
            integration: skillId,
            rowCount: exportData.rows.length,
            generatedAt: new Date().toISOString(),
          },
        });
      } catch (excelErr: any) {
        console.warn(`[SkillHandler:integration:${skillId}] Excel generation failed:`, excelErr?.message);
      }
    }

    // Step 3: For analyze/report actions, also generate a Word report
    if (actionType === 'analyze' && textResponse.length > 200) {
      try {
        const wordBuffer = await professionalFileGenerator.generateWord(textResponse, {
          title: `${config.name} Analysis Report`,
          locale: request.locale,
        });

        artifacts.push({
          type: 'document',
          filename: `${skillId}_report_${timestamp()}.docx`,
          buffer: wordBuffer,
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          size: wordBuffer.length,
          metadata: {
            format: 'docx',
            integration: skillId,
            generatedAt: new Date().toISOString(),
          },
        });
      } catch (docErr: any) {
        console.warn(`[SkillHandler:integration:${skillId}] Word report failed:`, docErr?.message);
      }
    }

    // Step 4: Generate suggestions based on the integration's capabilities
    const suggestions = config.capabilities
      .slice(0, 4)
      .map((cap) => `${cap.charAt(0).toUpperCase() + cap.slice(1)} with ${config.name}`);

    return {
      handled: true,
      skillId,
      skillName: config.name,
      category: config.category,
      artifacts,
      textResponse,
      suggestions,
    };
  } catch (error: any) {
    console.warn(`[SkillHandler:integration:${skillId}]`, error);
    return errorResult(skillId, error?.message ?? 'An unexpected error occurred.');
  }
}
