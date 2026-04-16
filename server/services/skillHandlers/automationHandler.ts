/**
 * Automation Skill Handler
 *
 * Handles automation and DevOps skill requests including Docker, Kubernetes,
 * Terraform, AWS, CI/CD pipelines, Ansible, and other infrastructure tooling.
 * Generates professional configuration files, scripts, and documentation.
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

interface GeneratedConfig {
  filename: string;
  content: string;
  description: string;
}

interface AutomationOutput {
  title: string;
  summary: string;
  configs: GeneratedConfig[];
  documentation?: string;
  warnings?: string[];
  nextSteps?: string[];
}

// ---------------------------------------------------------------------------
// Skill configuration
// ---------------------------------------------------------------------------

const AUTOMATION_SKILLS: Record<string, { name: string; fileExt: string; mimeType: string; category: string }> = {
  'docker-ops':        { name: 'Docker',            fileExt: 'dockerfile',  mimeType: 'text/x-dockerfile',   category: 'containers' },
  'kubernetes-ops':    { name: 'Kubernetes',         fileExt: 'yml',         mimeType: 'text/yaml',           category: 'orchestration' },
  'terraform-apply':   { name: 'Terraform',          fileExt: 'tf',          mimeType: 'text/plain',          category: 'iac' },
  'ansible-play':      { name: 'Ansible',            fileExt: 'yml',         mimeType: 'text/yaml',           category: 'config-management' },
  'puppet-run':        { name: 'Puppet',             fileExt: 'pp',          mimeType: 'text/plain',          category: 'config-management' },
  'chef-client':       { name: 'Chef',               fileExt: 'rb',          mimeType: 'text/x-ruby',         category: 'config-management' },
  'aws-cli':           { name: 'AWS CLI',            fileExt: 'sh',          mimeType: 'text/x-shellscript',  category: 'cloud' },
  'vercel-deploy':     { name: 'Vercel',             fileExt: 'json',        mimeType: 'application/json',    category: 'deployment' },
  'gitlab-ops':        { name: 'GitLab CI/CD',       fileExt: 'yml',         mimeType: 'text/yaml',           category: 'ci-cd' },
  'github':            { name: 'GitHub Actions',     fileExt: 'yml',         mimeType: 'text/yaml',           category: 'ci-cd' },
  'nagios-check':      { name: 'Nagios',             fileExt: 'cfg',         mimeType: 'text/plain',          category: 'monitoring' },
  'prometheus-query':  { name: 'Prometheus',          fileExt: 'yml',         mimeType: 'text/yaml',           category: 'monitoring' },
  'grafana-dash':      { name: 'Grafana',            fileExt: 'json',        mimeType: 'application/json',    category: 'monitoring' },
  'splunk-search':     { name: 'Splunk',             fileExt: 'spl',         mimeType: 'text/plain',          category: 'logging' },
  'kafka-produce':     { name: 'Kafka',              fileExt: 'properties',  mimeType: 'text/plain',          category: 'messaging' },
  'rabbitmq-queue':    { name: 'RabbitMQ',           fileExt: 'json',        mimeType: 'application/json',    category: 'messaging' },
  'redis-cli':         { name: 'Redis',              fileExt: 'conf',        mimeType: 'text/plain',          category: 'data' },
  'elasticsearch-query': { name: 'Elasticsearch',    fileExt: 'json',        mimeType: 'application/json',    category: 'search' },
  'postgres-ops':      { name: 'PostgreSQL',         fileExt: 'sql',         mimeType: 'text/x-sql',          category: 'database' },
  'mongo-cloud':       { name: 'MongoDB',            fileExt: 'js',          mimeType: 'application/javascript', category: 'database' },
  'firebase-admin':    { name: 'Firebase',           fileExt: 'json',        mimeType: 'application/json',    category: 'cloud' },
  'supabase-ops':      { name: 'Supabase',           fileExt: 'sql',         mimeType: 'text/x-sql',          category: 'cloud' },
  'nmap-scan':         { name: 'Nmap',               fileExt: 'sh',          mimeType: 'text/x-shellscript',  category: 'security' },
  'wireshark-cap':     { name: 'Wireshark',          fileExt: 'sh',          mimeType: 'text/x-shellscript',  category: 'security' },
  'burpsuite-proxy':   { name: 'Burp Suite',         fileExt: 'json',        mimeType: 'application/json',    category: 'security' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function errorResult(skillId: string, errorMsg: string): SkillHandlerResult {
  const skillConfig = AUTOMATION_SKILLS[skillId];
  return {
    handled: false,
    skillId,
    skillName: skillConfig?.name ?? 'Automation',
    category: 'automation',
    artifacts: [],
    textResponse: `I was unable to generate the automation configuration. ${errorMsg}`,
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

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function handleAutomation(
  request: SkillHandlerRequest,
  skillId: string,
): Promise<SkillHandlerResult> {
  try {
    const skillConfig = AUTOMATION_SKILLS[skillId] ?? {
      name: skillId,
      fileExt: 'txt',
      mimeType: 'text/plain',
      category: 'automation',
    };

    // Step 1: Use LLM to generate professional configs and documentation
    const rawOutput = await llmGateway.chat(
      [
        {
          role: 'system',
          content: `You are a senior DevOps/infrastructure engineer specializing in ${skillConfig.name}. Based on the user's request, generate production-ready configuration files and documentation.

Respond with a valid JSON object using this structure:
{
  "title": "Configuration Title",
  "summary": "Brief summary of what this configuration does (2-3 sentences)",
  "configs": [
    {
      "filename": "main-config.${skillConfig.fileExt}",
      "content": "...actual file content...",
      "description": "What this file does"
    }
  ],
  "documentation": "Detailed Markdown documentation explaining the configuration, prerequisites, and deployment steps",
  "warnings": ["Any security or operational warnings"],
  "nextSteps": ["Step 1: ...", "Step 2: ..."]
}

Generate realistic, production-quality configurations with appropriate comments, best practices, security considerations, and proper formatting. Include multiple config files if the setup requires it (e.g., main config + environment variables + README). Respond ONLY with JSON.`,
        },
        { role: 'user', content: request.message },
      ],
      { model: 'gpt-4o-mini', userId: request.userId },
    );

    const output = parseJSON<AutomationOutput>(rawOutput.content, {
      title: `${skillConfig.name} Configuration`,
      summary: 'Configuration could not be generated. Please try again with a more specific request.',
      configs: [
        {
          filename: `config.${skillConfig.fileExt}`,
          content: `# ${skillConfig.name} Configuration\n# Unable to generate config from request. Please provide more details.`,
          description: 'Placeholder configuration',
        },
      ],
    });

    // Step 2: Build artifacts from generated configs
    const artifacts: SkillHandlerResult['artifacts'] = [];

    for (const config of output.configs) {
      const buffer = Buffer.from(config.content, 'utf-8');
      artifacts.push({
        type: 'config',
        filename: config.filename || `config_${timestamp()}.${skillConfig.fileExt}`,
        buffer,
        mimeType: skillConfig.mimeType,
        size: buffer.length,
        metadata: {
          tool: skillConfig.name,
          category: skillConfig.category,
          description: config.description,
          generatedAt: new Date().toISOString(),
        },
      });
    }

    // Step 3: Generate Word documentation if substantial documentation was produced
    if (output.documentation && output.documentation.length > 100) {
      try {
        const docBuffer = await professionalFileGenerator.generateWord(output.documentation, {
          title: `${output.title} - Documentation`,
          locale: request.locale,
        });

        artifacts.push({
          type: 'document',
          filename: `documentation_${timestamp()}.docx`,
          buffer: docBuffer,
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          size: docBuffer.length,
          metadata: {
            format: 'docx',
            tool: skillConfig.name,
            generatedAt: new Date().toISOString(),
          },
        });
      } catch (docError: any) {
        // Documentation generation is non-critical; log and continue
        console.warn('[SkillHandler:automation] Documentation generation failed:', docError?.message);
      }
    }

    // Step 4: Build text response
    const configList = output.configs
      .map((c, i) => `${i + 1}. **${c.filename}** - ${c.description}`)
      .join('\n');

    const warningsText = output.warnings?.length
      ? '\n\n**Warnings:**\n' + output.warnings.map((w) => `- ${w}`).join('\n')
      : '';

    const nextStepsText = output.nextSteps?.length
      ? '\n\n**Next Steps:**\n' + output.nextSteps.map((s) => `- ${s}`).join('\n')
      : '';

    const textResponse = [
      `**${output.title}**`,
      '',
      output.summary,
      '',
      '**Generated Files:**',
      configList,
      warningsText,
      nextStepsText,
    ]
      .filter(Boolean)
      .join('\n');

    return {
      handled: true,
      skillId,
      skillName: skillConfig.name,
      category: 'automation',
      artifacts,
      textResponse,
      suggestions: [
        `Modify this ${skillConfig.name} configuration`,
        'Add monitoring/alerting to this setup',
        'Generate a CI/CD pipeline for deployment',
        'Review security best practices',
        'Create a staging environment variant',
      ],
    };
  } catch (error: any) {
    console.warn('[SkillHandler:automation]', error);
    return errorResult(skillId, error?.message ?? 'An unexpected error occurred.');
  }
}
