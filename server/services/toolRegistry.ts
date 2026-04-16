export type ToolCategory = 'users' | 'ai_models' | 'payments' | 'analytics' | 'database' | 'security' | 'reports' | 'settings' | 'integrations' | 'ai_advanced' | 'automation' | 'data' | 'communication';

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  capabilities: string[];
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  isEnabled: boolean;
  usageCount: number;
  successRate: number;
  healthStatus: 'healthy' | 'degraded' | 'disabled';
  failureCount: number;
  lastFailure?: Date;
}

export class ToolRegistryService {
  private tools: Map<string, ToolDefinition>;
  private capabilityIndex: Map<string, string[]> = new Map();

  private readonly FAILURE_THRESHOLD = 0.2;
  private readonly MIN_CALLS_FOR_DISABLE = 10;

  constructor() {
    this.tools = new Map();
    this.initializeTools();
    this.buildCapabilityIndex();
  }

  private buildCapabilityIndex(): void {
    this.capabilityIndex.clear();
    for (const tool of this.tools.values()) {
      for (const capability of tool.capabilities) {
        const keywords = capability.toLowerCase().split(/\s+/);
        for (const keyword of keywords) {
          const existing = this.capabilityIndex.get(keyword) || [];
          if (!existing.includes(tool.id)) {
            existing.push(tool.id);
          }
          this.capabilityIndex.set(keyword, existing);
        }
      }
    }
  }

  searchByCapability(keyword: string): ToolDefinition[] {
    const normalizedKeyword = keyword.toLowerCase().trim();
    const toolIds = this.capabilityIndex.get(normalizedKeyword) || [];
    return toolIds.map(id => this.tools.get(id)!).filter(Boolean);
  }

  private initializeTools(): void {
    const toolDefinitions: ToolDefinition[] = [
      // USERS TOOLS (8)
      {
        id: 'create_user',
        name: 'Create User',
        description: 'Create a new user account',
        category: 'users',
        capabilities: ['create user', 'add user', 'new user', 'crear usuario', 'agregar usuario'],
        endpoint: '/api/admin/users',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'update_user',
        name: 'Update User',
        description: 'Update user information',
        category: 'users',
        capabilities: ['update user', 'modify user', 'edit user', 'actualizar usuario', 'editar usuario'],
        endpoint: '/api/admin/users/:id',
        method: 'PATCH',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'delete_user',
        name: 'Delete User',
        description: 'Delete a user from the system',
        category: 'users',
        capabilities: ['delete user', 'remove user', 'eliminar usuario', 'borrar usuario'],
        endpoint: '/api/admin/users/:id',
        method: 'DELETE',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'list_users',
        name: 'List Users',
        description: 'Retrieve all users in the system with their details',
        category: 'users',
        capabilities: ['view users', 'list users', 'get all users', 'ver usuarios', 'listar usuarios'],
        endpoint: '/api/admin/users',
        method: 'GET',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'get_user',
        name: 'Get User',
        description: 'Get a specific user by ID',
        category: 'users',
        capabilities: ['get user', 'view user details', 'obtener usuario', 'ver usuario'],
        endpoint: '/api/admin/users/:id',
        method: 'GET',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'change_role',
        name: 'Change User Role',
        description: 'Change the role of a user (admin, user, moderator)',
        category: 'users',
        capabilities: ['change role', 'update role', 'set role', 'cambiar rol', 'asignar rol', 'role assignment'],
        endpoint: '/api/admin/users/:id/role',
        method: 'PATCH',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'change_plan',
        name: 'Change User Plan',
        description: 'Change the subscription plan for a user',
        category: 'users',
        capabilities: ['change plan', 'update plan', 'subscription', 'cambiar plan', 'actualizar suscripción', 'upgrade', 'downgrade'],
        endpoint: '/api/admin/users/:id/plan',
        method: 'PATCH',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'suspend_user',
        name: 'Suspend User',
        description: 'Suspend or reactivate a user account',
        category: 'users',
        capabilities: ['suspend user', 'ban user', 'deactivate user', 'suspender usuario', 'bloquear usuario', 'reactivate'],
        endpoint: '/api/admin/users/:id/suspend',
        method: 'PATCH',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      // AI_MODELS TOOLS (5)
      {
        id: 'list_models',
        name: 'List AI Models',
        description: 'List all available AI models',
        category: 'ai_models',
        capabilities: ['list models', 'view models', 'get models', 'listar modelos', 'ver modelos'],
        endpoint: '/api/admin/models',
        method: 'GET',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'enable_model',
        name: 'Enable Model',
        description: 'Enable an AI model for use',
        category: 'ai_models',
        capabilities: ['enable model', 'activate model', 'activar modelo', 'habilitar modelo'],
        endpoint: '/api/admin/models/:id/enable',
        method: 'PATCH',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'disable_model',
        name: 'Disable Model',
        description: 'Disable an AI model',
        category: 'ai_models',
        capabilities: ['disable model', 'deactivate model', 'desactivar modelo', 'deshabilitar modelo'],
        endpoint: '/api/admin/models/:id/disable',
        method: 'PATCH',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'get_model_stats',
        name: 'Get Model Stats',
        description: 'Get usage statistics and performance metrics for AI models',
        category: 'ai_models',
        capabilities: ['model stats', 'model metrics', 'model usage', 'estadísticas modelo', 'métricas modelo', 'performance'],
        endpoint: '/api/admin/models/:id/stats',
        method: 'GET',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'configure_model',
        name: 'Configure Model',
        description: 'Configure AI model parameters and settings',
        category: 'ai_models',
        capabilities: ['configure model', 'model settings', 'model config', 'configurar modelo', 'ajustes modelo', 'parameters'],
        endpoint: '/api/admin/models/:id/configure',
        method: 'PUT',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      // PAYMENTS TOOLS (6)
      {
        id: 'process_payment',
        name: 'Process Payment',
        description: 'Process a payment transaction',
        category: 'payments',
        capabilities: ['process payment', 'charge', 'pay', 'procesar pago', 'cobrar', 'transaction'],
        endpoint: '/api/admin/payments/process',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'refund_payment',
        name: 'Refund Payment',
        description: 'Refund a payment transaction',
        category: 'payments',
        capabilities: ['refund', 'refund payment', 'reembolso', 'devolver pago', 'reverse charge'],
        endpoint: '/api/admin/payments/:id/refund',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'list_payments',
        name: 'List Payments',
        description: 'List all payment transactions',
        category: 'payments',
        capabilities: ['list payments', 'view payments', 'payment history', 'listar pagos', 'historial pagos', 'transactions'],
        endpoint: '/api/admin/payments',
        method: 'GET',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'get_payment',
        name: 'Get Payment',
        description: 'Get details of a specific payment',
        category: 'payments',
        capabilities: ['get payment', 'payment details', 'view payment', 'obtener pago', 'ver pago', 'transaction details'],
        endpoint: '/api/admin/payments/:id',
        method: 'GET',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'create_invoice',
        name: 'Create Invoice',
        description: 'Create a new invoice for a customer',
        category: 'payments',
        capabilities: ['create invoice', 'new invoice', 'generate invoice', 'crear factura', 'generar factura', 'billing'],
        endpoint: '/api/admin/invoices',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'send_invoice',
        name: 'Send Invoice',
        description: 'Send an invoice to a customer via email',
        category: 'payments',
        capabilities: ['send invoice', 'email invoice', 'deliver invoice', 'enviar factura', 'facturar', 'invoice email'],
        endpoint: '/api/admin/invoices/:id/send',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      // ANALYTICS TOOLS (5)
      {
        id: 'get_metrics',
        name: 'Get Metrics',
        description: 'Retrieve platform metrics and KPIs',
        category: 'analytics',
        capabilities: ['get metrics', 'view metrics', 'kpi', 'obtener métricas', 'ver métricas', 'dashboard'],
        endpoint: '/api/admin/analytics/metrics',
        method: 'GET',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'get_chart_data',
        name: 'Get Chart Data',
        description: 'Get data formatted for chart visualizations',
        category: 'analytics',
        capabilities: ['chart data', 'graph data', 'visualization data', 'datos gráfico', 'datos visualización', 'trends'],
        endpoint: '/api/admin/analytics/charts',
        method: 'GET',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'get_realtime_stats',
        name: 'Get Realtime Stats',
        description: 'Get real-time statistics and live metrics',
        category: 'analytics',
        capabilities: ['realtime stats', 'live stats', 'real-time', 'estadísticas tiempo real', 'métricas en vivo', 'live data'],
        endpoint: '/api/admin/analytics/realtime',
        method: 'GET',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'compare_periods',
        name: 'Compare Periods',
        description: 'Compare metrics between different time periods',
        category: 'analytics',
        capabilities: ['compare periods', 'period comparison', 'time comparison', 'comparar períodos', 'comparación temporal', 'growth'],
        endpoint: '/api/admin/analytics/compare',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'track_event',
        name: 'Track Event',
        description: 'Track custom analytics events',
        category: 'analytics',
        capabilities: ['track event', 'log event', 'custom event', 'rastrear evento', 'registrar evento', 'analytics tracking'],
        endpoint: '/api/admin/analytics/track',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      // DATABASE TOOLS (4)
      {
        id: 'query_stats',
        name: 'Query Stats',
        description: 'Get database query statistics and performance metrics',
        category: 'database',
        capabilities: ['query stats', 'db stats', 'database metrics', 'estadísticas consultas', 'métricas base datos', 'performance'],
        endpoint: '/api/admin/database/stats',
        method: 'GET',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'list_tables',
        name: 'List Tables',
        description: 'List all database tables with statistics',
        category: 'database',
        capabilities: ['list tables', 'view tables', 'tablas', 'listar tablas', 'schema'],
        endpoint: '/api/admin/database/tables',
        method: 'GET',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'get_slow_queries',
        name: 'Get Slow Queries',
        description: 'Identify slow database queries for optimization',
        category: 'database',
        capabilities: ['slow queries', 'query optimization', 'performance issues', 'consultas lentas', 'optimización', 'bottleneck'],
        endpoint: '/api/admin/database/slow-queries',
        method: 'GET',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'backup_database',
        name: 'Backup Database',
        description: 'Create a backup of the database',
        category: 'database',
        capabilities: ['backup database', 'db backup', 'create backup', 'respaldar base datos', 'copia seguridad', 'snapshot'],
        endpoint: '/api/admin/database/backup',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      // SECURITY TOOLS (6)
      {
        id: 'get_audit_logs',
        name: 'Get Audit Logs',
        description: 'Retrieve security audit logs',
        category: 'security',
        capabilities: ['audit logs', 'security logs', 'logs de auditoría', 'registros de seguridad', 'activity log'],
        endpoint: '/api/admin/security/audit-logs',
        method: 'GET',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'create_policy',
        name: 'Create Security Policy',
        description: 'Create a new security policy',
        category: 'security',
        capabilities: ['create policy', 'add policy', 'crear política', 'agregar política', 'security rule'],
        endpoint: '/api/admin/security/policies',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'block_ip',
        name: 'Block IP Address',
        description: 'Block or unblock an IP address',
        category: 'security',
        capabilities: ['block ip', 'ban ip', 'ip blacklist', 'bloquear ip', 'prohibir ip', 'firewall'],
        endpoint: '/api/admin/security/block-ip',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'generate_api_key',
        name: 'Generate API Key',
        description: 'Generate a new API key for integrations',
        category: 'security',
        capabilities: ['generate api key', 'create api key', 'new api key', 'generar api key', 'crear clave api', 'token'],
        endpoint: '/api/admin/security/api-keys',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'revoke_api_key',
        name: 'Revoke API Key',
        description: 'Revoke an existing API key',
        category: 'security',
        capabilities: ['revoke api key', 'delete api key', 'disable api key', 'revocar api key', 'eliminar clave api', 'invalidate'],
        endpoint: '/api/admin/security/api-keys/:id',
        method: 'DELETE',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'security_scan',
        name: 'Security Scan',
        description: 'Run a security scan to detect vulnerabilities',
        category: 'security',
        capabilities: ['security scan', 'vulnerability scan', 'security check', 'escaneo seguridad', 'detectar vulnerabilidades', 'audit'],
        endpoint: '/api/admin/security/scan',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      // REPORTS TOOLS (4)
      {
        id: 'generate_report',
        name: 'Generate Report',
        description: 'Generate a new report from template',
        category: 'reports',
        capabilities: ['generate report', 'create report', 'generar reporte', 'crear reporte', 'new report'],
        endpoint: '/api/admin/reports/generate',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'schedule_report',
        name: 'Schedule Report',
        description: 'Schedule automatic report generation',
        category: 'reports',
        capabilities: ['schedule report', 'automatic report', 'programar reporte', 'reporte automático', 'recurring report'],
        endpoint: '/api/admin/reports/schedule',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'list_reports',
        name: 'List Reports',
        description: 'List all generated and scheduled reports',
        category: 'reports',
        capabilities: ['list reports', 'view reports', 'listar reportes', 'ver reportes', 'report history'],
        endpoint: '/api/admin/reports',
        method: 'GET',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'export_report',
        name: 'Export Report',
        description: 'Export a report in various formats (PDF, Excel, CSV)',
        category: 'reports',
        capabilities: ['export report', 'download report', 'exportar reporte', 'descargar reporte', 'pdf report', 'excel report'],
        endpoint: '/api/admin/reports/:id/export',
        method: 'GET',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      // SETTINGS TOOLS (4)
      {
        id: 'get_settings',
        name: 'Get Settings',
        description: 'Retrieve all platform settings',
        category: 'settings',
        capabilities: ['get settings', 'view settings', 'configuration', 'obtener configuración', 'ver ajustes'],
        endpoint: '/api/admin/settings',
        method: 'GET',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'update_settings',
        name: 'Update Settings',
        description: 'Update platform settings',
        category: 'settings',
        capabilities: ['update settings', 'change settings', 'actualizar configuración', 'cambiar ajustes', 'modify settings'],
        endpoint: '/api/admin/settings',
        method: 'PUT',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'reset_settings',
        name: 'Reset Settings',
        description: 'Reset settings to default values',
        category: 'settings',
        capabilities: ['reset settings', 'default settings', 'restablecer configuración', 'valores por defecto', 'factory reset'],
        endpoint: '/api/admin/settings/reset',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'export_settings',
        name: 'Export Settings',
        description: 'Export settings configuration for backup or migration',
        category: 'settings',
        capabilities: ['export settings', 'backup settings', 'exportar configuración', 'respaldar ajustes', 'settings backup'],
        endpoint: '/api/admin/settings/export',
        method: 'GET',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      // INTEGRATIONS TOOLS (7)
      {
        id: 'slack_send',
        name: 'Send to Slack',
        description: 'Send messages, files, and alerts to Slack channels',
        category: 'integrations',
        capabilities: ['send_message', 'send_file', 'send_alert', 'list_channels', 'slack message', 'enviar mensaje slack', 'notificar slack'],
        endpoint: '/api/integrations/slack',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'email_send',
        name: 'Send Email',
        description: 'Send emails, templates, and bulk email campaigns',
        category: 'integrations',
        capabilities: ['send_email', 'send_template', 'send_bulk', 'schedule_email', 'email', 'correo', 'enviar email', 'campaña email'],
        endpoint: '/api/integrations/email',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'webhook_trigger',
        name: 'Trigger Webhook',
        description: 'Trigger HTTP webhooks with various methods',
        category: 'integrations',
        capabilities: ['http_post', 'http_get', 'http_put', 'http_delete', 'webhook', 'trigger', 'disparar webhook', 'llamar api'],
        endpoint: '/api/integrations/webhook',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'calendar_event',
        name: 'Manage Calendar',
        description: 'Create, update, delete, and list calendar events',
        category: 'integrations',
        capabilities: ['create_event', 'update_event', 'delete_event', 'list_events', 'calendar', 'evento', 'calendario', 'cita', 'reunión'],
        endpoint: '/api/integrations/calendar',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'drive_upload',
        name: 'Upload to Drive',
        description: 'Upload files, create folders, and share files in cloud storage',
        category: 'integrations',
        capabilities: ['upload_file', 'create_folder', 'share_file', 'list_files', 'drive', 'storage', 'subir archivo', 'almacenamiento'],
        endpoint: '/api/integrations/drive',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'sms_send',
        name: 'Send SMS',
        description: 'Send SMS messages and check delivery status',
        category: 'integrations',
        capabilities: ['send_sms', 'send_bulk_sms', 'check_status', 'sms', 'texto', 'mensaje texto', 'enviar sms'],
        endpoint: '/api/integrations/sms',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'push_notification',
        name: 'Push Notification',
        description: 'Send push notifications to devices and topics',
        category: 'integrations',
        capabilities: ['send_push', 'send_topic', 'schedule_push', 'push', 'notificación', 'notificación push', 'alerta móvil'],
        endpoint: '/api/integrations/push',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      // AI_ADVANCED TOOLS (6)
      {
        id: 'image_generate',
        name: 'Generate Image',
        description: 'Generate, edit, upscale, and create image variations using AI',
        category: 'ai_advanced',
        capabilities: ['generate_image', 'edit_image', 'upscale', 'variations', 'imagen', 'generar imagen', 'crear imagen', 'dall-e'],
        endpoint: '/api/tools/image-generate',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'code_review',
        name: 'Review Code',
        description: 'Analyze code, suggest fixes, scan for security issues and performance',
        category: 'ai_advanced',
        capabilities: ['analyze_code', 'suggest_fixes', 'security_scan', 'performance_check', 'code review', 'revisar código', 'análisis código', 'seguridad código'],
        endpoint: '/api/tools/code-review',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'document_summarize',
        name: 'Summarize Document',
        description: 'Summarize documents, extract key points, and generate outlines',
        category: 'ai_advanced',
        capabilities: ['summarize', 'extract_key_points', 'generate_outline', 'resumen', 'resumir', 'puntos clave', 'esquema'],
        endpoint: '/api/tools/document-summarize',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'translate_text',
        name: 'Translate Text',
        description: 'Translate text, detect language, and batch translate content',
        category: 'ai_advanced',
        capabilities: ['translate', 'detect_language', 'batch_translate', 'traducir', 'traducción', 'idioma', 'detectar idioma'],
        endpoint: '/api/tools/translate',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'sentiment_analysis',
        name: 'Sentiment Analysis',
        description: 'Analyze sentiment, detect emotions, and check toxicity in text',
        category: 'ai_advanced',
        capabilities: ['analyze_sentiment', 'detect_emotions', 'toxicity_check', 'sentimiento', 'emociones', 'análisis sentimiento', 'toxicidad'],
        endpoint: '/api/tools/sentiment',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'entity_extraction',
        name: 'Extract Entities',
        description: 'Extract names, dates, locations, and other entities from text',
        category: 'ai_advanced',
        capabilities: ['extract_names', 'extract_dates', 'extract_locations', 'entidades', 'extraer nombres', 'extraer fechas', 'ner'],
        endpoint: '/api/tools/entity-extraction',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      // AUTOMATION TOOLS (5)
      {
        id: 'schedule_task',
        name: 'Schedule Task',
        description: 'Schedule one-time or recurring tasks',
        category: 'automation',
        capabilities: ['schedule_once', 'schedule_recurring', 'cancel_scheduled', 'programar', 'tarea programada', 'cron', 'scheduler'],
        endpoint: '/api/tools/schedule-task',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'batch_process',
        name: 'Batch Process',
        description: 'Process users, emails, or reports in batches',
        category: 'automation',
        capabilities: ['batch_users', 'batch_emails', 'batch_reports', 'lotes', 'procesamiento masivo', 'bulk process'],
        endpoint: '/api/tools/batch-process',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'workflow_manage',
        name: 'Manage Workflow',
        description: 'Create, update, and trigger automated workflows',
        category: 'automation',
        capabilities: ['create_workflow', 'update_workflow', 'trigger_workflow', 'flujo trabajo', 'automatización', 'workflow'],
        endpoint: '/api/tools/workflow',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'backup_manage',
        name: 'Manage Backups',
        description: 'Create, restore, and list system backups',
        category: 'automation',
        capabilities: ['create_backup', 'restore_backup', 'list_backups', 'respaldo', 'backup', 'copia seguridad', 'restaurar'],
        endpoint: '/api/tools/backup',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'cleanup_data',
        name: 'Data Cleanup',
        description: 'Clean old data, archive, purge deleted items, and optimize storage',
        category: 'automation',
        capabilities: ['cleanup_old', 'archive_data', 'purge_deleted', 'optimize_storage', 'limpieza', 'archivar', 'purgar', 'optimizar'],
        endpoint: '/api/tools/cleanup',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      // DATA TOOLS (6)
      {
        id: 'chart_generate',
        name: 'Generate Chart',
        description: 'Generate various types of charts and visualizations',
        category: 'data',
        capabilities: ['line_chart', 'bar_chart', 'pie_chart', 'area_chart', 'scatter_plot', 'gráfico', 'chart', 'visualización'],
        endpoint: '/api/tools/chart-generate',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'csv_export',
        name: 'Export CSV',
        description: 'Export data to CSV format',
        category: 'data',
        capabilities: ['export_users', 'export_payments', 'export_analytics', 'csv', 'exportar csv', 'descargar csv'],
        endpoint: '/api/tools/csv-export',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'pdf_generate',
        name: 'Generate PDF',
        description: 'Generate PDF reports, invoices, and certificates',
        category: 'data',
        capabilities: ['generate_report', 'generate_invoice', 'generate_certificate', 'pdf', 'generar pdf', 'factura pdf', 'reporte pdf'],
        endpoint: '/api/tools/pdf-generate',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'excel_export',
        name: 'Export Excel',
        description: 'Export data to Excel with multiple sheets and charts',
        category: 'data',
        capabilities: ['export_xlsx', 'multi_sheet', 'with_charts', 'excel', 'xlsx', 'exportar excel', 'hoja cálculo'],
        endpoint: '/api/tools/excel-export',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'data_transform',
        name: 'Transform Data',
        description: 'Filter, aggregate, pivot, join, map, and reduce data',
        category: 'data',
        capabilities: ['filter', 'aggregate', 'pivot', 'join', 'map', 'reduce', 'transformar', 'filtrar datos', 'agregar datos'],
        endpoint: '/api/tools/data-transform',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'data_import',
        name: 'Import Data',
        description: 'Import data from CSV, JSON, Excel and validate',
        category: 'data',
        capabilities: ['import_csv', 'import_json', 'import_excel', 'validate_data', 'importar', 'cargar datos', 'subir datos'],
        endpoint: '/api/tools/data-import',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      // COMMUNICATION TOOLS (4)
      {
        id: 'template_render',
        name: 'Render Template',
        description: 'Render email, SMS, and notification templates with variables',
        category: 'communication',
        capabilities: ['email_template', 'sms_template', 'notification_template', 'plantilla', 'renderizar', 'template', 'variables'],
        endpoint: '/api/tools/template-render',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'broadcast_send',
        name: 'Send Broadcast',
        description: 'Send broadcasts to segments or all users',
        category: 'communication',
        capabilities: ['send_to_segment', 'send_to_all', 'schedule_broadcast', 'difusión', 'broadcast', 'enviar masivo', 'segmento'],
        endpoint: '/api/tools/broadcast',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'notification_manage',
        name: 'Manage Notifications',
        description: 'Create and list system notifications',
        category: 'communication',
        capabilities: ['create_notification', 'list_notifications', 'notificaciones', 'gestionar notificaciones', 'alertas sistema'],
        endpoint: '/api/tools/notifications',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      {
        id: 'announcement_create',
        name: 'Create Announcement',
        description: 'Create, schedule, and target announcements to users',
        category: 'communication',
        capabilities: ['create', 'schedule', 'expire', 'target_users', 'anuncio', 'crear anuncio', 'avisos', 'comunicado'],
        endpoint: '/api/tools/announcements',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      },
      // SYSTEM/AUTOMATION TOOLS
      {
        id: 'macos_integration',
        name: 'macOS Native Integration',
        description: 'Execute native macOS actions via AppleScript/JXA (open apps, get/set volume, read/write clipboard)',
        category: 'automation',
        capabilities: ['macos', 'applescript', 'jxa', 'clipboard', 'volume', 'open app', 'pbcopy', 'screencapture'],
        endpoint: '/api/tools/macos',
        method: 'POST',
        isEnabled: true,
        usageCount: 0,
        successRate: 100,
        healthStatus: 'healthy',
        failureCount: 0
      }
    ];

    for (const tool of toolDefinitions) {
      this.tools.set(tool.id, tool);
    }
  }

  getTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  getToolById(id: string): ToolDefinition | undefined {
    return this.tools.get(id);
  }

  getToolsByCategory(category: string): ToolDefinition[] {
    return Array.from(this.tools.values()).filter(
      tool => tool.category === category
    );
  }

  incrementUsage(toolId: string, success: boolean): void {
    const tool = this.tools.get(toolId);
    if (!tool) return;

    tool.usageCount++;
    if (!success) {
      tool.failureCount = (tool.failureCount || 0) + 1;
      tool.lastFailure = new Date();
    }

    const failureRate = tool.failureCount / tool.usageCount;
    tool.successRate = Math.round((1 - failureRate) * 100);

    if (tool.usageCount >= this.MIN_CALLS_FOR_DISABLE && failureRate > this.FAILURE_THRESHOLD) {
      tool.healthStatus = 'disabled';
      tool.isEnabled = false;
      console.warn(`[ToolRegistry] Auto-disabled tool ${toolId} due to high failure rate: ${(failureRate * 100).toFixed(1)}%`);
    } else if (failureRate > 0.1) {
      tool.healthStatus = 'degraded';
    } else {
      tool.healthStatus = 'healthy';
    }
  }

  enableTool(toolId: string): boolean {
    const tool = this.tools.get(toolId);
    if (tool) {
      tool.isEnabled = true;
      tool.healthStatus = 'healthy';
      tool.failureCount = 0;
      return true;
    }
    return false;
  }

  searchTools(query: string): ToolDefinition[] {
    const normalizedQuery = query.toLowerCase().trim();
    return Array.from(this.tools.values()).filter(tool => {
      const matchesName = tool.name.toLowerCase().includes(normalizedQuery);
      const matchesDescription = tool.description.toLowerCase().includes(normalizedQuery);
      const matchesCapabilities = tool.capabilities.some(cap =>
        cap.toLowerCase().includes(normalizedQuery)
      );
      return matchesName || matchesDescription || matchesCapabilities;
    });
  }
}

export const toolRegistry = new ToolRegistryService();
