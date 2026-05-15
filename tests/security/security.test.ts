/**
 * Unit tests for Security module: Encryption, Authorization, and Audit Logging.
 */

import { describe, it, expect, vi } from 'vitest';
import { EncryptedS3Client, type S3ClientInterface } from '../../src/security/encryption.js';
import { AuthorizationService, type PermissionPolicy } from '../../src/security/authorization.js';
import { AuditLogger, type AuditLogSink } from '../../src/security/audit-logger.js';

// ─── Encryption Tests ────────────────────────────────────────────────────────

describe('EncryptedS3Client', () => {
  function makeMockS3(): S3ClientInterface {
    return {
      putObject: vi.fn().mockResolvedValue(undefined),
      getObject: vi.fn().mockResolvedValue(Buffer.from('test data')),
    };
  }

  it('should apply KMS encryption on putObject', async () => {
    const mockS3 = makeMockS3();
    const client = new EncryptedS3Client(mockS3, 'arn:aws:kms:us-east-1:123:key/abc');

    await client.putObject('my-bucket', 'data/file.json', '{"hello":"world"}');

    expect(mockS3.putObject).toHaveBeenCalledWith({
      Bucket: 'my-bucket',
      Key: 'data/file.json',
      Body: '{"hello":"world"}',
      ServerSideEncryption: 'aws:kms',
      SSEKMSKeyId: 'arn:aws:kms:us-east-1:123:key/abc',
    });
  });

  it('should handle Buffer data', async () => {
    const mockS3 = makeMockS3();
    const client = new EncryptedS3Client(mockS3, 'key-123');
    const data = Buffer.from('binary data');

    await client.putObject('bucket', 'key', data);

    expect(mockS3.putObject).toHaveBeenCalledWith(
      expect.objectContaining({
        Body: data,
        ServerSideEncryption: 'aws:kms',
        SSEKMSKeyId: 'key-123',
      })
    );
  });

  it('should pass through getObject calls', async () => {
    const mockS3 = makeMockS3();
    const client = new EncryptedS3Client(mockS3, 'key-123');

    const result = await client.getObject('bucket', 'key');

    expect(mockS3.getObject).toHaveBeenCalledWith({ Bucket: 'bucket', Key: 'key' });
    expect(result).toEqual(Buffer.from('test data'));
  });

  it('should return the configured KMS key ID', () => {
    const mockS3 = makeMockS3();
    const client = new EncryptedS3Client(mockS3, 'arn:aws:kms:us-east-1:123:key/my-key');

    expect(client.getKmsKeyId()).toBe('arn:aws:kms:us-east-1:123:key/my-key');
  });
});

// ─── Authorization Tests ─────────────────────────────────────────────────────

describe('AuthorizationService', () => {
  const policies: PermissionPolicy[] = [
    {
      researcherId: 'researcher-1',
      allowedActions: ['submit-job', 'read-results', 'upload-data'],
      allowedResources: ['arn:aws:braket:*', 's3://genomics-bucket/*'],
    },
    {
      researcherId: 'researcher-2',
      allowedActions: ['read-results'],
      allowedResources: ['s3://genomics-bucket/results/*'],
    },
  ];

  it('should allow a permitted action on a permitted resource', async () => {
    const service = new AuthorizationService(policies);

    const result = await service.checkPermission(
      'researcher-1',
      'submit-job',
      'arn:aws:braket:us-east-1:123:device/qpu/ionq'
    );

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('should deny an action not in the policy', async () => {
    const service = new AuthorizationService(policies);

    const result = await service.checkPermission(
      'researcher-2',
      'submit-job',
      'arn:aws:braket:us-east-1:123:device/qpu/ionq'
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('does not have permission');
  });

  it('should deny access to a resource not in the policy', async () => {
    const service = new AuthorizationService(policies);

    const result = await service.checkPermission(
      'researcher-2',
      'read-results',
      's3://other-bucket/data'
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('does not have access to resource');
  });

  it('should deny unknown researchers', async () => {
    const service = new AuthorizationService(policies);

    const result = await service.checkPermission(
      'unknown-researcher',
      'read-results',
      's3://genomics-bucket/results/file.json'
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('No policy found');
  });

  it('should support wildcard resource matching', async () => {
    const service = new AuthorizationService(policies);

    const result = await service.checkPermission(
      'researcher-1',
      'upload-data',
      's3://genomics-bucket/uploads/file.fasta'
    );

    expect(result.allowed).toBe(true);
  });

  it('should log denied attempts via audit logger', async () => {
    const logger = new AuditLogger();
    const service = new AuthorizationService(policies, logger);

    await service.checkPermission('unknown', 'submit-job', 'some-resource');

    const entries = logger.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].outcome).toBe('denied');
    expect(entries[0].researcherId).toBe('unknown');
    expect(entries[0].action).toBe('submit-job');
  });

  it('should not log successful authorizations', async () => {
    const logger = new AuditLogger();
    const service = new AuthorizationService(policies, logger);

    await service.checkPermission(
      'researcher-1',
      'submit-job',
      'arn:aws:braket:us-east-1:123:device'
    );

    const entries = logger.getEntries();
    expect(entries).toHaveLength(0);
  });
});

// ─── Audit Logger Tests ──────────────────────────────────────────────────────

describe('AuditLogger', () => {
  it('should log entries with all required fields', () => {
    const logger = new AuditLogger();

    logger.log({
      timestamp: new Date('2025-01-15T10:00:00Z'),
      researcherId: 'researcher-1',
      action: 'submit-job',
      resource: 'arn:aws:braket:us-east-1:123:device/qpu/ionq',
      outcome: 'success',
    });

    const entries = logger.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].timestamp).toEqual(new Date('2025-01-15T10:00:00Z'));
    expect(entries[0].researcherId).toBe('researcher-1');
    expect(entries[0].action).toBe('submit-job');
    expect(entries[0].resource).toBe('arn:aws:braket:us-east-1:123:device/qpu/ionq');
    expect(entries[0].outcome).toBe('success');
  });

  it('should write structured JSON to the sink', () => {
    const writtenLines: string[] = [];
    const sink: AuditLogSink = { write: (line) => writtenLines.push(line) };
    const logger = new AuditLogger(sink);

    logger.log({
      timestamp: new Date('2025-01-15T10:00:00Z'),
      researcherId: 'researcher-1',
      action: 'upload-data',
      resource: 's3://bucket/file.fasta',
      outcome: 'success',
    });

    expect(writtenLines).toHaveLength(1);
    const parsed = JSON.parse(writtenLines[0]);
    expect(parsed.timestamp).toBe('2025-01-15T10:00:00.000Z');
    expect(parsed.researcherId).toBe('researcher-1');
    expect(parsed.action).toBe('upload-data');
    expect(parsed.outcome).toBe('success');
  });

  it('should include optional details in log entries', () => {
    const logger = new AuditLogger();

    logger.log({
      timestamp: new Date(),
      researcherId: 'researcher-1',
      action: 'submit-job',
      resource: 'backend-ionq',
      outcome: 'error',
      details: { errorCode: 'TIMEOUT', retryCount: 3 },
    });

    const entries = logger.getEntries();
    expect(entries[0].details).toEqual({ errorCode: 'TIMEOUT', retryCount: 3 });
  });

  it('should filter entries by researcher', () => {
    const logger = new AuditLogger();

    logger.log({ timestamp: new Date(), researcherId: 'alice', action: 'a', resource: 'r', outcome: 'success' });
    logger.log({ timestamp: new Date(), researcherId: 'bob', action: 'b', resource: 'r', outcome: 'success' });
    logger.log({ timestamp: new Date(), researcherId: 'alice', action: 'c', resource: 'r', outcome: 'denied' });

    expect(logger.getEntriesByResearcher('alice')).toHaveLength(2);
    expect(logger.getEntriesByResearcher('bob')).toHaveLength(1);
  });

  it('should filter entries by action', () => {
    const logger = new AuditLogger();

    logger.log({ timestamp: new Date(), researcherId: 'r1', action: 'submit-job', resource: 'r', outcome: 'success' });
    logger.log({ timestamp: new Date(), researcherId: 'r1', action: 'read-results', resource: 'r', outcome: 'success' });
    logger.log({ timestamp: new Date(), researcherId: 'r2', action: 'submit-job', resource: 'r', outcome: 'denied' });

    expect(logger.getEntriesByAction('submit-job')).toHaveLength(2);
    expect(logger.getEntriesByAction('read-results')).toHaveLength(1);
  });

  it('should filter entries by outcome', () => {
    const logger = new AuditLogger();

    logger.log({ timestamp: new Date(), researcherId: 'r1', action: 'a', resource: 'r', outcome: 'success' });
    logger.log({ timestamp: new Date(), researcherId: 'r1', action: 'b', resource: 'r', outcome: 'denied' });
    logger.log({ timestamp: new Date(), researcherId: 'r1', action: 'c', resource: 'r', outcome: 'error' });

    expect(logger.getEntriesByOutcome('success')).toHaveLength(1);
    expect(logger.getEntriesByOutcome('denied')).toHaveLength(1);
    expect(logger.getEntriesByOutcome('error')).toHaveLength(1);
  });

  it('should clear all entries', () => {
    const logger = new AuditLogger();

    logger.log({ timestamp: new Date(), researcherId: 'r1', action: 'a', resource: 'r', outcome: 'success' });
    logger.log({ timestamp: new Date(), researcherId: 'r1', action: 'b', resource: 'r', outcome: 'success' });

    expect(logger.getEntries()).toHaveLength(2);
    logger.clear();
    expect(logger.getEntries()).toHaveLength(0);
  });
});
