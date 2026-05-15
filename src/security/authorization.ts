/**
 * IAM Authorization checks for the Quantum Genomics Pipeline.
 * Verifies researcher permissions before job submission and data access.
 *
 * Requirements: 10.3, 10.5
 */

import type { AuditLogger } from './audit-logger.js';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export type AuthAction = 'submit-job' | 'read-results' | 'upload-data' | 'cancel-job';

export interface AuthResult {
  allowed: boolean;
  reason?: string;
}

export interface PermissionPolicy {
  researcherId: string;
  allowedActions: AuthAction[];
  allowedResources: string[]; // glob patterns or ARNs
}

export interface AuthorizationServiceInterface {
  checkPermission(researcherId: string, action: AuthAction, resource: string): Promise<AuthResult>;
}

/**
 * AuthorizationService verifies researcher permissions against configured policies.
 * On denial, logs the unauthorized access attempt.
 */
export class AuthorizationService implements AuthorizationServiceInterface {
  private policies: PermissionPolicy[];
  private auditLogger?: AuditLogger;

  constructor(policies: PermissionPolicy[], auditLogger?: AuditLogger) {
    this.policies = policies;
    this.auditLogger = auditLogger;
  }

  /**
   * Checks if a researcher has permission to perform an action on a resource.
   * Logs denied attempts via the audit logger.
   */
  async checkPermission(
    researcherId: string,
    action: AuthAction,
    resource: string
  ): Promise<AuthResult> {
    const policy = this.policies.find((p) => p.researcherId === researcherId);

    if (!policy) {
      const result: AuthResult = {
        allowed: false,
        reason: `No policy found for researcher '${researcherId}'`,
      };
      this.logDenial(researcherId, action, resource, result.reason!);
      return result;
    }

    if (!policy.allowedActions.includes(action)) {
      const result: AuthResult = {
        allowed: false,
        reason: `Researcher '${researcherId}' does not have permission for action '${action}'`,
      };
      this.logDenial(researcherId, action, resource, result.reason!);
      return result;
    }

    if (!this.matchesResource(resource, policy.allowedResources)) {
      const result: AuthResult = {
        allowed: false,
        reason: `Researcher '${researcherId}' does not have access to resource '${resource}'`,
      };
      this.logDenial(researcherId, action, resource, result.reason!);
      return result;
    }

    return { allowed: true };
  }

  /**
   * Checks if a resource matches any of the allowed resource patterns.
   * Supports '*' as a wildcard for all resources.
   */
  private matchesResource(resource: string, allowedResources: string[]): boolean {
    for (const pattern of allowedResources) {
      if (pattern === '*') return true;
      if (pattern === resource) return true;
      // Simple prefix matching for ARN-style patterns
      if (pattern.endsWith('*') && resource.startsWith(pattern.slice(0, -1))) return true;
    }
    return false;
  }

  private logDenial(researcherId: string, action: string, resource: string, reason: string): void {
    if (this.auditLogger) {
      this.auditLogger.log({
        timestamp: new Date(),
        researcherId,
        action,
        resource,
        outcome: 'denied',
        details: { reason },
      });
    }
  }
}
