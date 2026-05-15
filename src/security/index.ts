/**
 * Security module - Encryption, Authorization, and Audit Logging.
 */

export { EncryptedS3Client } from './encryption.js';
export type { S3ClientInterface, S3PutParams, S3GetParams } from './encryption.js';

export { AuthorizationService } from './authorization.js';
export type {
  AuthAction,
  AuthResult,
  PermissionPolicy,
  AuthorizationServiceInterface,
} from './authorization.js';

export { AuditLogger } from './audit-logger.js';
export type { AuditEntry, AuditLogSink } from './audit-logger.js';
