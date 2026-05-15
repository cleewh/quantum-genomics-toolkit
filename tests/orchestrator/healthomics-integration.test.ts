/**
 * Unit tests for HealthOmics integration.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  HealthOmicsExecutor,
  isHealthOmicsStep,
  type HealthOmicsClientInterface,
  type HealthOmicsRunStatus,
} from '../../src/orchestrator/healthomics-integration.js';
import type { WorkflowStep } from '../../src/types/index.js';

function makeMockClient(options?: {
  statusSequence?: HealthOmicsRunStatus[];
  outputPath?: string;
}): HealthOmicsClientInterface {
  let statusCallCount = 0;
  const statusSequence = options?.statusSequence ?? [{ status: 'COMPLETED' as const }];

  return {
    startRun: vi.fn().mockResolvedValue('run-123'),
    getRunStatus: vi.fn().mockImplementation(async () => {
      const status = statusSequence[Math.min(statusCallCount, statusSequence.length - 1)];
      statusCallCount++;
      return status;
    }),
    getRunOutput: vi.fn().mockResolvedValue(options?.outputPath ?? 's3://output/results/'),
  };
}

describe('HealthOmicsExecutor', () => {
  it('should execute a step and return output path', async () => {
    const client = makeMockClient();
    const executor = new HealthOmicsExecutor(client, { pollIntervalMs: 1 });

    const step: WorkflowStep = {
      id: 'align',
      type: 'classical',
      config: { workflowId: 'wf-bwa-mem2', roleArn: 'arn:aws:iam::123:role/omics' },
      outputS3Path: 's3://bucket/output/align/',
    };

    const result = await executor.executeStep(step);

    expect(result).toBe('s3://output/results/');
    expect(client.startRun).toHaveBeenCalledWith({
      workflowId: 'wf-bwa-mem2',
      roleArn: 'arn:aws:iam::123:role/omics',
      outputUri: 's3://bucket/output/align/',
      parameters: undefined,
    });
  });

  it('should poll until completion', async () => {
    const client = makeMockClient({
      statusSequence: [
        { status: 'RUNNING' },
        { status: 'RUNNING' },
        { status: 'COMPLETED' },
      ],
    });
    const executor = new HealthOmicsExecutor(client, { pollIntervalMs: 1 });

    const step: WorkflowStep = {
      id: 'step-1',
      type: 'classical',
      config: { workflowId: 'wf-1', roleArn: 'arn:role' },
      outputS3Path: 's3://out/',
    };

    await executor.executeStep(step);

    expect(client.getRunStatus).toHaveBeenCalledTimes(3);
  });

  it('should throw on failure', async () => {
    const client = makeMockClient({
      statusSequence: [{ status: 'FAILED', failureReason: 'Out of memory' }],
    });
    const executor = new HealthOmicsExecutor(client, { pollIntervalMs: 1 });

    const step: WorkflowStep = {
      id: 'step-1',
      type: 'classical',
      config: { workflowId: 'wf-1', roleArn: 'arn:role' },
      outputS3Path: 's3://out/',
    };

    await expect(executor.executeStep(step)).rejects.toThrow('failed: Out of memory');
  });

  it('should pass parameters to HealthOmics', async () => {
    const client = makeMockClient();
    const executor = new HealthOmicsExecutor(client, { pollIntervalMs: 1 });

    const step: WorkflowStep = {
      id: 'step-1',
      type: 'classical',
      config: {
        workflowId: 'wf-variant-call',
        roleArn: 'arn:role',
        parameters: { reference: 's3://ref/GRCh38.fasta' },
      },
      outputS3Path: 's3://out/',
    };

    await executor.executeStep(step);

    expect(client.startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        parameters: { reference: 's3://ref/GRCh38.fasta' },
      })
    );
  });
});

describe('isHealthOmicsStep', () => {
  it('should return true for classical steps with workflowId', () => {
    const step: WorkflowStep = {
      id: 'align',
      type: 'classical',
      config: { workflowId: 'wf-1', roleArn: 'arn:role' },
      outputS3Path: 's3://out/',
    };
    expect(isHealthOmicsStep(step)).toBe(true);
  });

  it('should return false for quantum steps', () => {
    const step: WorkflowStep = {
      id: 'encode',
      type: 'quantum',
      config: { shots: 1000, backend: 'ionq-forte-enterprise', priority: 'normal', maxRetries: 3, timeoutMinutes: 30 },
      outputS3Path: 's3://out/',
    };
    expect(isHealthOmicsStep(step)).toBe(false);
  });

  it('should return false for classical steps without workflowId', () => {
    const step: WorkflowStep = {
      id: 'process',
      type: 'classical',
      config: { command: 'run-script' },
      outputS3Path: 's3://out/',
    };
    expect(isHealthOmicsStep(step)).toBe(false);
  });
});
