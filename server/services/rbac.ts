/**
 * Role-Based Access Control (RBAC) Service (#65)
 * Granular permissions system for enterprise-grade access control
 */

import { Request, Response, NextFunction } from 'express';

// Define permission catalog (runtime + type-safe)
export const PERMISSIONS = [
    // Chat permissions
    'chat:read', 'chat:create', 'chat:edit', 'chat:delete', 'chat:share',
    // Message permissions
    'message:read', 'message:create', 'message:edit', 'message:delete',
    // Document permissions
    'document:read', 'document:create', 'document:export', 'document:delete',
    // Project permissions
    'project:read', 'project:create', 'project:edit', 'project:delete', 'project:share',
    // File permissions
    'file:upload', 'file:download', 'file:delete',
    // AI permissions
    'ai:chat', 'ai:research', 'ai:production', 'ai:custom_prompts',
    // Settings permissions
    'settings:read', 'settings:edit',
    // Admin permissions
    'admin:users', 'admin:billing', 'admin:analytics', 'admin:settings', 'admin:audit',
    // API permissions
    'api:read', 'api:write', 'api:admin',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_CATALOG: Array<{
    id: Permission;
    label: string;
    category: string;
    description?: string;
}> = [
    { id: 'chat:read', label: 'Ver chats', category: 'Chats' },
    { id: 'chat:create', label: 'Crear chats', category: 'Chats' },
    { id: 'chat:edit', label: 'Editar chats', category: 'Chats' },
    { id: 'chat:delete', label: 'Eliminar chats', category: 'Chats' },
    { id: 'chat:share', label: 'Compartir chats', category: 'Chats' },
    { id: 'message:read', label: 'Ver mensajes', category: 'Mensajes' },
    { id: 'message:create', label: 'Crear mensajes', category: 'Mensajes' },
    { id: 'message:edit', label: 'Editar mensajes', category: 'Mensajes' },
    { id: 'message:delete', label: 'Eliminar mensajes', category: 'Mensajes' },
    { id: 'document:read', label: 'Ver documentos', category: 'Documentos' },
    { id: 'document:create', label: 'Crear documentos', category: 'Documentos' },
    { id: 'document:export', label: 'Exportar documentos', category: 'Documentos' },
    { id: 'document:delete', label: 'Eliminar documentos', category: 'Documentos' },
    { id: 'project:read', label: 'Ver proyectos', category: 'Proyectos' },
    { id: 'project:create', label: 'Crear proyectos', category: 'Proyectos' },
    { id: 'project:edit', label: 'Editar proyectos', category: 'Proyectos' },
    { id: 'project:delete', label: 'Eliminar proyectos', category: 'Proyectos' },
    { id: 'project:share', label: 'Compartir proyectos', category: 'Proyectos' },
    { id: 'file:upload', label: 'Subir archivos', category: 'Archivos' },
    { id: 'file:download', label: 'Descargar archivos', category: 'Archivos' },
    { id: 'file:delete', label: 'Eliminar archivos', category: 'Archivos' },
    { id: 'ai:chat', label: 'Chat con IA', category: 'IA' },
    { id: 'ai:research', label: 'Investigación con IA', category: 'IA' },
    { id: 'ai:production', label: 'Producción con IA', category: 'IA' },
    { id: 'ai:custom_prompts', label: 'Prompts personalizados', category: 'IA' },
    { id: 'settings:read', label: 'Ver configuración', category: 'Configuración' },
    { id: 'settings:edit', label: 'Editar configuración', category: 'Configuración' },
    { id: 'admin:users', label: 'Administrar usuarios', category: 'Administración' },
    { id: 'admin:billing', label: 'Administrar facturación', category: 'Administración' },
    { id: 'admin:analytics', label: 'Ver analíticas', category: 'Administración' },
    { id: 'admin:settings', label: 'Administrar ajustes', category: 'Administración' },
    { id: 'admin:audit', label: 'Ver auditorías', category: 'Administración' },
    { id: 'api:read', label: 'Leer API', category: 'API' },
    { id: 'api:write', label: 'Escribir API', category: 'API' },
    { id: 'api:admin', label: 'Administrar API', category: 'API' },
];

// Define roles with their permissions
interface Role {
    name: string;
    description: string;
    permissions: Permission[];
    inherits?: string[];
}

export const BUILTIN_ROLES: Record<string, Role> = {
    guest: {
        name: 'Invitado',
        description: 'Usuario sin autenticación o con acceso limitado',
        permissions: ['chat:read'],
    },

    free: {
        name: 'Usuario gratuito',
        description: 'Usuario básico en plan gratuito',
        permissions: [
            'chat:read', 'chat:create', 'chat:edit', 'chat:delete',
            'message:read', 'message:create', 'message:edit', 'message:delete',
            'document:read',
            'file:upload', 'file:download',
            'ai:chat',
            'settings:read', 'settings:edit',
        ],
    },

    pro: {
        name: 'Usuario Pro',
        description: 'Usuario individual de pago',
        inherits: ['free'],
        permissions: [
            'chat:share',
            'document:create', 'document:export', 'document:delete',
            'project:read', 'project:create', 'project:edit', 'project:delete', 'project:share',
            'file:delete',
            'ai:research', 'ai:production', 'ai:custom_prompts',
            'api:read',
        ],
    },

    team_member: {
        name: 'Miembro',
        description: 'Miembro de un equipo u organizacion',
        inherits: ['pro'],
        permissions: [],
    },

    team_admin: {
        name: 'Administrador',
        description: 'Administrador de un equipo u organizacion',
        inherits: ['team_member'],
        permissions: [
            'admin:users',
            'admin:analytics',
            'admin:billing',
            'admin:settings',
            'api:write',
        ],
    },

    billing_manager: {
        name: 'Facturacion',
        description: 'Administrador de facturacion del equipo',
        inherits: ['team_member'],
        permissions: [
            'admin:billing',
        ],
    },

    admin: {
        name: 'Administrador del sistema',
        description: 'Administrador del sistema con acceso completo',
        inherits: ['team_admin'],
        permissions: [
            'admin:billing',
            'admin:settings',
            'admin:audit',
            'api:admin',
        ],
    },

    superadmin: {
        name: 'Superadministrador',
        description: 'Acceso sin restricciones',
        permissions: ['*'] as any, // All permissions
    },
};

// Cache for resolved permissions
const permissionCache = new Map<string, Set<Permission>>();

export const BUILTIN_ROLE_KEYS = Object.keys(BUILTIN_ROLES);
export const BUILTIN_ROLE_SET = new Set(BUILTIN_ROLE_KEYS);

export function isBuiltinRole(roleName: string): boolean {
    return BUILTIN_ROLE_SET.has(roleName);
}

/**
 * Resolve all permissions for a role (including inherited)
 */
function resolveRolePermissions(roleName: string): Set<Permission> {
    // Check cache
    if (permissionCache.has(roleName)) {
        return permissionCache.get(roleName)!;
    }

    const role = BUILTIN_ROLES[roleName];
    if (!role) {
        return new Set();
    }

    // Start with role's own permissions
    const permissions = new Set<Permission>(role.permissions as Permission[]);

    // Add inherited permissions
    if (role.inherits) {
        for (const parentRole of role.inherits) {
            const parentPermissions = resolveRolePermissions(parentRole);
            for (const perm of parentPermissions) {
                permissions.add(perm);
            }
        }
    }

    // Cache and return
    permissionCache.set(roleName, permissions);
    return permissions;
}

/**
 * Check if a role has a specific permission
 */
export function hasPermission(roleName: string, permission: Permission): boolean {
    const permissions = resolveRolePermissions(roleName);

    // Superadmin has all permissions
    if (permissions.has('*' as any)) {
        return true;
    }

    return permissions.has(permission);
}

/**
 * Check if a role has any of the specified permissions
 */
export function hasAnyPermission(roleName: string, requiredPermissions: Permission[]): boolean {
    return requiredPermissions.some(perm => hasPermission(roleName, perm));
}

/**
 * Check if a role has all of the specified permissions
 */
export function hasAllPermissions(roleName: string, requiredPermissions: Permission[]): boolean {
    return requiredPermissions.every(perm => hasPermission(roleName, perm));
}

/**
 * Get all permissions for a role
 */
export function getRolePermissions(roleName: string): Permission[] {
    return Array.from(resolveRolePermissions(roleName));
}

/**
 * Get all available roles
 */
export function getAllRoles(): { name: string; description: string }[] {
    return Object.entries(BUILTIN_ROLES).map(([key, role]) => ({
        name: key,
        description: role.description,
    }));
}

/**
 * Express middleware for permission checking
 */
export function requirePermission(...permissions: Permission[]) {
    return (req: Request, res: Response, next: NextFunction) => {
        const user = (req as any).user;

        if (!user) {
            return res.status(401).json({
                error: 'Authentication required',
                code: 'AUTH_REQUIRED',
            });
        }

        const roleName = user.role || 'guest';

        if (!hasAllPermissions(roleName, permissions)) {
            return res.status(403).json({
                error: 'Insufficient permissions',
                code: 'PERMISSION_DENIED',
                required: permissions,
                role: roleName,
            });
        }

        next();
    };
}

/**
 * Express middleware for requiring any of the permissions
 */
export function requireAnyPermission(...permissions: Permission[]) {
    return (req: Request, res: Response, next: NextFunction) => {
        const user = (req as any).user;

        if (!user) {
            return res.status(401).json({
                error: 'Authentication required',
                code: 'AUTH_REQUIRED',
            });
        }

        const roleName = user.role || 'guest';

        if (!hasAnyPermission(roleName, permissions)) {
            return res.status(403).json({
                error: 'Insufficient permissions',
                code: 'PERMISSION_DENIED',
                requiredAny: permissions,
                role: roleName,
            });
        }

        next();
    };
}

/**
 * Express middleware for admin-only routes
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
    const user = (req as any).user;

    if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    const roleName = user.role || 'guest';

    if (!['admin', 'superadmin'].includes(roleName)) {
        return res.status(403).json({
            error: 'Admin access required',
            code: 'ADMIN_REQUIRED',
        });
    }

    next();
}

/**
 * Resource-level permission check (for sharing)
 */
interface ResourcePermission {
    resourceType: string;
    resourceId: string;
    userId: number;
    permission: 'read' | 'write' | 'admin';
}

// In-memory store for resource permissions (use DB in production)
const resourcePermissions = new Map<string, ResourcePermission[]>();

/**
 * Grant permission on a resource
 */
export function grantResourcePermission(
    resourceType: string,
    resourceId: string,
    userId: number,
    permission: 'read' | 'write' | 'admin'
): void {
    const key = `${resourceType}:${resourceId}`;
    const existing = resourcePermissions.get(key) || [];

    // Remove existing permission for this user
    const filtered = existing.filter(p => p.userId !== userId);

    // Add new permission
    filtered.push({ resourceType, resourceId, userId, permission });
    resourcePermissions.set(key, filtered);
}

/**
 * Revoke permission on a resource
 */
export function revokeResourcePermission(
    resourceType: string,
    resourceId: string,
    userId: number
): void {
    const key = `${resourceType}:${resourceId}`;
    const existing = resourcePermissions.get(key) || [];
    const filtered = existing.filter(p => p.userId !== userId);
    resourcePermissions.set(key, filtered);
}

/**
 * Check if user has permission on a resource
 */
export function hasResourcePermission(
    resourceType: string,
    resourceId: string,
    userId: number,
    requiredPermission: 'read' | 'write' | 'admin'
): boolean {
    const key = `${resourceType}:${resourceId}`;
    const permissions = resourcePermissions.get(key) || [];

    const userPerm = permissions.find(p => p.userId === userId);
    if (!userPerm) return false;

    // Permission hierarchy: admin > write > read
    const hierarchy: Record<string, number> = { read: 1, write: 2, admin: 3 };
    return hierarchy[userPerm.permission] >= hierarchy[requiredPermission];
}

/**
 * Get all users with access to a resource
 */
export function getResourcePermissions(
    resourceType: string,
    resourceId: string
): ResourcePermission[] {
    const key = `${resourceType}:${resourceId}`;
    return resourcePermissions.get(key) || [];
}
