/**
 * User Type Definitions
 * Types for local multi-user management
 */

export type UserRole = 'admin' | 'manager' | 'member';

export interface User {
  id: string;
  name: string;
  email?: string;
  role: UserRole;
  avatar?: string;
  createdAt: number;
  lastLoginAt: number;
}

export interface CreateUserInput {
  name: string;
  email?: string;
  role?: UserRole;
  avatar?: string;
}

/**
 * Permission actions that can be checked against user roles
 */
export type PermissionAction =
  | 'employee:create'
  | 'employee:delete'
  | 'employee:configure'
  | 'task:create'
  | 'task:assign'
  | 'task:delete'
  | 'credits:view'
  | 'credits:topup'
  | 'settings:edit'
  | 'user:manage';

/**
 * Role-based permission matrix.
 * true = allowed, false = denied.
 */
export const ROLE_PERMISSIONS: Record<UserRole, Record<PermissionAction, boolean>> = {
  admin: {
    'employee:create': true,
    'employee:delete': true,
    'employee:configure': true,
    'task:create': true,
    'task:assign': true,
    'task:delete': true,
    'credits:view': true,
    'credits:topup': true,
    'settings:edit': true,
    'user:manage': true,
  },
  manager: {
    'employee:create': true,
    'employee:delete': false,
    'employee:configure': true,
    'task:create': true,
    'task:assign': true,
    'task:delete': true,
    'credits:view': true,
    'credits:topup': false,
    'settings:edit': false,
    'user:manage': false,
  },
  member: {
    'employee:create': false,
    'employee:delete': false,
    'employee:configure': false,
    'task:create': true,
    'task:assign': false,
    'task:delete': false,
    'credits:view': true,
    'credits:topup': false,
    'settings:edit': false,
    'user:manage': false,
  },
};

/**
 * Check if a user role has a specific permission
 */
export function hasPermission(role: UserRole, action: PermissionAction): boolean {
  return ROLE_PERMISSIONS[role]?.[action] ?? false;
}
