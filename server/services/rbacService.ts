/**
 * Role-Based Access Control - ILIAGPT PRO 3.0
 * 
 * Granular permission system for enterprise use.
 * Roles, permissions, and resource-level access control.
 */

// ============== Types ==============

export interface Role {
    id: string;
    name: string;
    description: string;
    permissions: Permission[];
    inherits?: string[]; // Role IDs to inherit from
    isSystem: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export interface Permission {
    resource: Resource;
    actions: Action[];
    conditions?: Condition[];
}

export type Resource =
    | "chat"
    | "document"
    | "agent"
    | "tool"
    | "model"
    | "user"
    | "settings"
    | "admin"
    | "billing"
    | "api"
    | "memory"
    | "integration"
    | "*";

export type Action =
    | "create"
    | "read"
    | "update"
    | "delete"
    | "execute"
    | "share"
    | "export"
    | "admin"
    | "*";

export interface Condition {
    field: string;
    operator: "eq" | "ne" | "gt" | "lt" | "in" | "contains";
    value: any;
}

export interface UserRole {
    userId: string;
    roleId: string;
    grantedBy: string;
    grantedAt: Date;
    expiresAt?: Date;
    scope?: string; // Optional scope (e.g., "workspace:123")
}

export interface AccessCheckResult {
    allowed: boolean;
    reason?: string;
    matchedRole?: string;
    matchedPermission?: Permission;
}

// ============== Default Roles ==============

const DEFAULT_ROLES: Role[] = [
    {
        id: "admin",
        name: "Administrator",
        description: "Full access to all resources",
        permissions: [{ resource: "*", actions: ["*"] }],
        isSystem: true,
        createdAt: new Date(),
        updatedAt: new Date(),
    },
    {
        id: "pro",
        name: "Pro User",
        description: "Premium features access",
        permissions: [
            { resource: "chat", actions: ["*"] },
            { resource: "document", actions: ["*"] },
            { resource: "agent", actions: ["*"] },
            { resource: "tool", actions: ["read", "execute"] },
            { resource: "model", actions: ["read", "execute"] },
            { resource: "memory", actions: ["*"] },
            { resource: "integration", actions: ["read", "execute"] },
            { resource: "settings", actions: ["read", "update"] },
        ],
        isSystem: true,
        createdAt: new Date(),
        updatedAt: new Date(),
    },
    {
        id: "free",
        name: "Free User",
        description: "Basic access",
        permissions: [
            { resource: "chat", actions: ["create", "read", "update", "delete"] },
            { resource: "document", actions: ["read"] },
            { resource: "agent", actions: ["read", "execute"], conditions: [{ field: "tier", operator: "eq", value: "free" }] },
            { resource: "tool", actions: ["read", "execute"], conditions: [{ field: "tier", operator: "eq", value: "free" }] },
            { resource: "model", actions: ["read", "execute"], conditions: [{ field: "tier", operator: "in", value: ["free", "basic"] }] },
            { resource: "settings", actions: ["read", "update"] },
        ],
        isSystem: true,
        createdAt: new Date(),
        updatedAt: new Date(),
    },
    {
        id: "readonly",
        name: "Read Only",
        description: "View only access",
        permissions: [
            { resource: "chat", actions: ["read"] },
            { resource: "document", actions: ["read"] },
            { resource: "settings", actions: ["read"] },
        ],
        isSystem: true,
        createdAt: new Date(),
        updatedAt: new Date(),
    },
    {
        id: "developer",
        name: "Developer",
        description: "API and tool access",
        permissions: [
            { resource: "chat", actions: ["*"] },
            { resource: "document", actions: ["*"] },
            { resource: "agent", actions: ["*"] },
            { resource: "tool", actions: ["*"] },
            { resource: "api", actions: ["*"] },
            { resource: "settings", actions: ["read", "update"] },
        ],
        inherits: ["pro"],
        isSystem: true,
        createdAt: new Date(),
        updatedAt: new Date(),
    },
];

// ============== RBAC Service ==============

class RBACService {
    private roles: Map<string, Role> = new Map();
    private userRoles: Map<string, UserRole[]> = new Map();
    private permissionCache: Map<string, AccessCheckResult> = new Map();
    private cacheTimeout = 60000; // 1 minute

    constructor() {
        // Load default roles
        for (const role of DEFAULT_ROLES) {
            this.roles.set(role.id, role);
        }
    }

    // ======== Role Management ========

    /**
     * Create a new role
     */
    createRole(
        id: string,
        name: string,
        description: string,
        permissions: Permission[],
        inherits?: string[]
    ): Role {
        if (this.roles.has(id)) {
            throw new Error(`Role ${id} already exists`);
        }

        const role: Role = {
            id,
            name,
            description,
            permissions,
            inherits,
            isSystem: false,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        this.roles.set(id, role);
        this.invalidateCache();
        return role;
    }

    /**
     * Update a role
     */
    updateRole(id: string, updates: Partial<Omit<Role, 'id' | 'isSystem' | 'createdAt'>>): Role {
        const role = this.roles.get(id);
        if (!role) throw new Error(`Role ${id} not found`);
        if (role.isSystem) throw new Error(`Cannot modify system role ${id}`);

        Object.assign(role, updates, { updatedAt: new Date() });
        this.invalidateCache();
        return role;
    }

    /**
     * Delete a role
     */
    deleteRole(id: string): boolean {
        const role = this.roles.get(id);
        if (!role) return false;
        if (role.isSystem) throw new Error(`Cannot delete system role ${id}`);

        this.roles.delete(id);
        this.invalidateCache();
        return true;
    }

    /**
     * Get all roles
     */
    getRoles(): Role[] {
        return Array.from(this.roles.values());
    }

    /**
     * Get role by ID
     */
    getRole(id: string): Role | undefined {
        return this.roles.get(id);
    }

    // ======== User Role Assignment ========

    /**
     * Assign role to user
     */
    assignRole(
        userId: string,
        roleId: string,
        grantedBy: string,
        options: { expiresAt?: Date; scope?: string } = {}
    ): UserRole {
        if (!this.roles.has(roleId)) {
            throw new Error(`Role ${roleId} not found`);
        }

        const userRole: UserRole = {
            userId,
            roleId,
            grantedBy,
            grantedAt: new Date(),
            expiresAt: options.expiresAt,
            scope: options.scope,
        };

        const userRoles = this.userRoles.get(userId) || [];

        // Remove existing same role
        const filtered = userRoles.filter(r => r.roleId !== roleId || r.scope !== options.scope);
        filtered.push(userRole);

        this.userRoles.set(userId, filtered);
        this.invalidateCache(userId);
        return userRole;
    }

    /**
     * Revoke role from user
     */
    revokeRole(userId: string, roleId: string, scope?: string): boolean {
        const userRoles = this.userRoles.get(userId);
        if (!userRoles) return false;

        const filtered = userRoles.filter(r =>
            !(r.roleId === roleId && r.scope === scope)
        );

        if (filtered.length === userRoles.length) return false;

        this.userRoles.set(userId, filtered);
        this.invalidateCache(userId);
        return true;
    }

    /**
     * Get user roles
     */
    getUserRoles(userId: string): UserRole[] {
        const roles = this.userRoles.get(userId) || [];
        const now = new Date();

        // Filter expired roles
        return roles.filter(r => !r.expiresAt || r.expiresAt > now);
    }

    // ======== Permission Checking ========

    /**
     * Check if user has permission
     */
    checkAccess(
        userId: string,
        resource: Resource,
        action: Action,
        context?: Record<string, any>
    ): AccessCheckResult {
        // Check cache
        const cacheKey = `${userId}:${resource}:${action}:${JSON.stringify(context || {})}`;
        const cached = this.permissionCache.get(cacheKey);
        if (cached) return cached;

        const userRoles = this.getUserRoles(userId);

        if (userRoles.length === 0) {
            return { allowed: false, reason: "No roles assigned" };
        }

        // Check each role
        for (const userRole of userRoles) {
            const result = this.checkRoleAccess(userRole.roleId, resource, action, context);
            if (result.allowed) {
                result.matchedRole = userRole.roleId;
                this.permissionCache.set(cacheKey, result);
                setTimeout(() => this.permissionCache.delete(cacheKey), this.cacheTimeout);
                return result;
            }
        }

        const result: AccessCheckResult = {
            allowed: false,
            reason: `No permission for ${action} on ${resource}`,
        };

        this.permissionCache.set(cacheKey, result);
        setTimeout(() => this.permissionCache.delete(cacheKey), this.cacheTimeout);
        return result;
    }

    /**
     * Check role permission
     */
    private checkRoleAccess(
        roleId: string,
        resource: Resource,
        action: Action,
        context?: Record<string, any>,
        checked: Set<string> = new Set()
    ): AccessCheckResult {
        if (checked.has(roleId)) {
            return { allowed: false, reason: "Circular role inheritance" };
        }
        checked.add(roleId);

        const role = this.roles.get(roleId);
        if (!role) {
            return { allowed: false, reason: `Role ${roleId} not found` };
        }

        // Check permissions
        for (const perm of role.permissions) {
            if (this.matchesPermission(perm, resource, action, context)) {
                return { allowed: true, matchedPermission: perm };
            }
        }

        // Check inherited roles
        if (role.inherits) {
            for (const inheritedRoleId of role.inherits) {
                const result = this.checkRoleAccess(inheritedRoleId, resource, action, context, checked);
                if (result.allowed) return result;
            }
        }

        return { allowed: false };
    }

    /**
     * Check if permission matches
     */
    private matchesPermission(
        permission: Permission,
        resource: Resource,
        action: Action,
        context?: Record<string, any>
    ): boolean {
        // Resource match
        if (permission.resource !== "*" && permission.resource !== resource) {
            return false;
        }

        // Action match
        if (!permission.actions.includes("*") && !permission.actions.includes(action)) {
            return false;
        }

        // Condition match
        if (permission.conditions && context) {
            for (const condition of permission.conditions) {
                if (!this.evaluateCondition(condition, context)) {
                    return false;
                }
            }
        }

        return true;
    }

    /**
     * Evaluate condition
     */
    private evaluateCondition(condition: Condition, context: Record<string, any>): boolean {
        const value = context[condition.field];

        switch (condition.operator) {
            case "eq": return value === condition.value;
            case "ne": return value !== condition.value;
            case "gt": return value > condition.value;
            case "lt": return value < condition.value;
            case "in": return Array.isArray(condition.value) && condition.value.includes(value);
            case "contains": return typeof value === "string" && value.includes(condition.value);
            default: return false;
        }
    }

    /**
     * Get all permissions for user
     */
    getUserPermissions(userId: string): Permission[] {
        const roles = this.getUserRoles(userId);
        const permissions: Permission[] = [];
        const seen = new Set<string>();

        const collectPermissions = (roleId: string) => {
            if (seen.has(roleId)) return;
            seen.add(roleId);

            const role = this.roles.get(roleId);
            if (!role) return;

            permissions.push(...role.permissions);

            if (role.inherits) {
                for (const inherited of role.inherits) {
                    collectPermissions(inherited);
                }
            }
        };

        for (const userRole of roles) {
            collectPermissions(userRole.roleId);
        }

        return permissions;
    }

    /**
     * Invalidate permission cache
     */
    private invalidateCache(userId?: string): void {
        if (userId) {
            for (const key of this.permissionCache.keys()) {
                if (key.startsWith(`${userId}:`)) {
                    this.permissionCache.delete(key);
                }
            }
        } else {
            this.permissionCache.clear();
        }
    }
}

// ============== Singleton ==============

let rbacInstance: RBACService | null = null;

export function getRBAC(): RBACService {
    if (!rbacInstance) {
        rbacInstance = new RBACService();
    }
    return rbacInstance;
}

export default RBACService;
