/**
 * Unit tests for the Job Orchestrator.
 * Tests quantum job submission, validation, retry logic,
 * and hybrid workflow DAG execution.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  JobOrchestrator,
  type BraketClientInterface,
  type BraketJobStatus,
  type S3StorageInterface,
} from '../../src/orchestrator/job-orchestrator.js';
import type {
  TranspiledCircuit,
  JobConfig,
  EncodedCircuit,
  EncodingScheme,
  WorkflowDefinition,
  WorkflowStep,
  MeasurementResult,
  BackendId,
} from '../../src/types/index.js';

// ─── Test Helpers ────────────────────────────────────────────────────────────

const defaultScheme: EncodingScheme = {
  name: 'default-2qubit-basis',
  qubitsPerBase: 2,
  mapping: { A: '00', C: '01', G: '10', T: '11', U: '11' } as Record<any, string>,
};

function makeTranspiledCircuit(): TranspiledCircuit {
  const encoded: EncodedCircuit = {
    qasm: 'OPENQASM 3.0;\nqubit[4] q;\nbit[4] c;\nx q[1];\nc = measure q;',
    qubitCount: 4,
    gateCount: 1,
    depth: 1,
    scheme: defaultScheme,
    sourceSequenceId: 'test-seq',
  };
  return {
    qasm: 'OPENQASM 3.0;\nqubit[4] q;\nbit[4] c;\ngpi(0) q[1];\nc = measure q;',
    originalCircuit: encoded,
    backend: 'ionq-forte-enterprise',
    nativeGateCount: 1,
    depth: 1,
    swapCount: 0,
  };
}

function makeJobConfig(overrides?: Partial<JobConfig>): JobConfig {
  return {
    shots: 1000,
    backend: 'ionq-forte-enterprise',
    priority: 'normal',
    maxRetries: 3,
    timeoutMinutes: 30,
    ...overrides,
  };
}

function makeMockBraketClient(options?: {
  submitResult?: string;
  statusSequence?: BraketJobStatus[];
  result?: MeasurementResult;
  submitError?: Error;
}): BraketClientInterface {
  let statusCallCount = 0;
  const statusSequence = options?.statusSequence || [{ state: 'COMPLETED' as const }];

  return {
    submitJob: options?.submitError
      ? vi.fn().mockRejectedValue(options.submitError)
      : vi.fn().mockResolvedValue(options?.submitResult || 'braket-job-123'),
    getJobStatus: vi.fn().mockImplementation(async () => {
      const status = statusSequence[Math.min(statusCallCount, statusSequence.length - 1)];
      statusCallCount++;
      return status;
    }),
    getJobResult: vi.fn().mockResolvedValue(
      options?.result || {
        bitstrings: { '0100': 800, '0000': 200 },
        totalShots: 1000,
        backend: 'ionq-forte-enterprise' as BackendId,
        jobId: 'braket-job-123',
      }
    ),
    cancelJob: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMockS3Storage(): S3StorageInterface {
  const store = new Map<string, string>();
  return {
    putObject: vi.fn().mockImplementation(async (path: string, data: string) => {
      store.set(path, data);
    }),
    getObject: vi.fn().mockImplementation(async (path: string) => {
      return store.get(path) || '{}';
    }),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('JobOrchestrator', () => {
  let braketClient: BraketClientInterface;
  let s3Storage: S3StorageInterface;
  let orchestrator: JobOrchestrator;

  beforeEach(() => {
    braketClient = makeMockBraketClient();
    s3Storage = makeMockS3Storage();
    orchestrator = new JobOrchestrator(braketClient, s3Storage, { pollIntervalMs: 10, retryBackoffMs: [1, 1, 1], resultRetrievalTimeoutMs: 100 });
  });

  describe('Shot Count Validation', () => {
    it('should accept shot count of 100 (minimum)', () => {
      expect(() => orchestrator.validateShotCount(100)).not.toThrow();
    });

    it('should accept shot count of 10000 (maximum)', () => {
      expect(() => orchestrator.validateShotCount(10000)).not.toThrow();
    });

    it('should accept shot count of 1000 (middle range)', () => {
      expect(() => orchestrator.validateShotCount(1000)).not.toThrow();
    });

    it('should reject shot count below 100', () => {
      expect(() => orchestrator.validateShotCount(99)).toThrow(/Invalid shot count/);
    });

    it('should reject shot count above 10000', () => {
      expect(() => orchestrator.validateShotCount(10001)).toThrow(/Invalid shot count/);
    });

    it('should reject shot count of 0', () => {
      expect(() => orchestrator.validateShotCount(0)).toThrow(/Invalid shot count/);
    });

    it('should reject negative shot count', () => {
      expect(() => orchestrator.validateShotCount(-1)).toThrow(/Invalid shot count/);
    });

    it('should reject non-integer shot count', () => {
      expect(() => orchestrator.validateShotCount(100.5)).toThrow(/Invalid shot count/);
    });
  });

  describe('submitQuantumJob', () => {
    it('should submit a job and return a handle', async () => {
      const circuit = makeTranspiledCircuit();
      const config = makeJobConfig();

      const handle = await orchestrator.submitQuantumJob(circuit, config);

      expect(handle.type).toBe('quantum');
      expect(handle.jobId).toMatch(/^qjob-/);
    });

    it('should reject invalid shot count', async () => {
      const circuit = makeTranspiledCircuit();
      const config = makeJobConfig({ shots: 50 });

      await expect(orchestrator.submitQuantumJob(circuit, config)).rejects.toThrow(
        /Invalid shot count/
      );
    });

    it('should call braket client to submit the job', async () => {
      const circuit = makeTranspiledCircuit();
      const config = makeJobConfig();

      await orchestrator.submitQuantumJob(circuit, config);

      expect(braketClient.submitJob).toHaveBeenCalledWith(circuit, config);
    });

    it('should set status to COMPLETED on successful execution', async () => {
      const circuit = makeTranspiledCircuit();
      const config = makeJobConfig();

      const handle = await orchestrator.submitQuantumJob(circuit, config);
      const status = await orchestrator.getStatus(handle);

      expect(status.state).toBe('COMPLETED');
      expect(status.endTime).toBeDefined();
    });

    it('should retrieve measurement results on completion', async () => {
      const expectedResult: MeasurementResult = {
        bitstrings: { '0100': 800, '0000': 200 },
        totalShots: 1000,
        backend: 'ionq-forte-enterprise',
        jobId: 'braket-job-123',
      };
      braketClient = makeMockBraketClient({ result: expectedResult });
      orchestrator = new JobOrchestrator(braketClient, s3Storage, { pollIntervalMs: 10, retryBackoffMs: [1, 1, 1], resultRetrievalTimeoutMs: 100 });

      const circuit = makeTranspiledCircuit();
      const config = makeJobConfig();

      const handle = await orchestrator.submitQuantumJob(circuit, config);
      const result = orchestrator.getJobResult(handle);

      expect(result).toEqual(expectedResult);
    });
  });

  describe('Retry Logic', () => {
    it('should retry on failure up to maxRetries times', async () => {
      braketClient = makeMockBraketClient({
        statusSequence: [
          { state: 'FAILED', failureReason: 'Hardware error' },
          { state: 'FAILED', failureReason: 'Hardware error' },
          { state: 'FAILED', failureReason: 'Hardware error' },
          { state: 'FAILED', failureReason: 'Hardware error' },
        ],
      });
      orchestrator = new JobOrchestrator(braketClient, s3Storage, { pollIntervalMs: 1, retryBackoffMs: [1, 1, 1], resultRetrievalTimeoutMs: 50 });

      const circuit = makeTranspiledCircuit();
      const config = makeJobConfig({ maxRetries: 3 });

      const handle = await orchestrator.submitQuantumJob(circuit, config);
      const status = await orchestrator.getStatus(handle);

      expect(status.state).toBe('FAILED');
      // Should have been called 4 times (initial + 3 retries)
      expect(braketClient.submitJob).toHaveBeenCalledTimes(4);
    });

    it('should succeed on retry after initial failure', async () => {
      let callCount = 0;
      braketClient = {
        submitJob: vi.fn().mockResolvedValue('braket-job-123'),
        getJobStatus: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount <= 1) {
            return { state: 'FAILED', failureReason: 'Transient error' };
          }
          return { state: 'COMPLETED' };
        }),
        getJobResult: vi.fn().mockResolvedValue({
          bitstrings: { '0100': 1000 },
          totalShots: 1000,
          backend: 'ionq-forte-enterprise' as BackendId,
          jobId: 'braket-job-123',
        }),
        cancelJob: vi.fn(),
      };
      orchestrator = new JobOrchestrator(braketClient, s3Storage, { pollIntervalMs: 1, retryBackoffMs: [1, 1, 1], resultRetrievalTimeoutMs: 50 });

      const circuit = makeTranspiledCircuit();
      const config = makeJobConfig({ maxRetries: 3 });

      const handle = await orchestrator.submitQuantumJob(circuit, config);
      const status = await orchestrator.getStatus(handle);

      expect(status.state).toBe('COMPLETED');
    });

    it('should retry on submit error', async () => {
      let submitCallCount = 0;
      braketClient = {
        submitJob: vi.fn().mockImplementation(async () => {
          submitCallCount++;
          if (submitCallCount <= 2) {
            throw new Error('Service unavailable');
          }
          return 'braket-job-123';
        }),
        getJobStatus: vi.fn().mockResolvedValue({ state: 'COMPLETED' }),
        getJobResult: vi.fn().mockResolvedValue({
          bitstrings: { '0100': 1000 },
          totalShots: 1000,
          backend: 'ionq-forte-enterprise' as BackendId,
          jobId: 'braket-job-123',
        }),
        cancelJob: vi.fn(),
      };
      orchestrator = new JobOrchestrator(braketClient, s3Storage, { pollIntervalMs: 1, retryBackoffMs: [1, 1, 1], resultRetrievalTimeoutMs: 50 });

      const circuit = makeTranspiledCircuit();
      const config = makeJobConfig({ maxRetries: 3 });

      const handle = await orchestrator.submitQuantumJob(circuit, config);
      const status = await orchestrator.getStatus(handle);

      expect(status.state).toBe('COMPLETED');
      expect(submitCallCount).toBe(3);
    });
  });

  describe('cancelJob', () => {
    it('should cancel a running job', async () => {
      // Make the job stay in RUNNING state
      braketClient = makeMockBraketClient({
        statusSequence: [{ state: 'RUNNING' }, { state: 'RUNNING' }],
      });
      orchestrator = new JobOrchestrator(braketClient, s3Storage, { pollIntervalMs: 1, retryBackoffMs: [1, 1, 1], resultRetrievalTimeoutMs: 50 });

      const circuit = makeTranspiledCircuit();
      const config = makeJobConfig();

      // We need to start the job but not wait for it to complete
      // Since our mock will timeout, let's just test the cancel path directly
      const handle = await orchestrator.submitQuantumJob(circuit, config);
      // The job will have timed out and failed, but we can still test cancel
      await orchestrator.cancelJob(handle);

      expect(braketClient.cancelJob).toHaveBeenCalledWith(handle.jobId);
    });

    it('should throw for non-existent job', async () => {
      await expect(
        orchestrator.cancelJob({ jobId: 'non-existent', type: 'quantum' })
      ).rejects.toThrow(/Job not found/);
    });
  });

  describe('getStatus', () => {
    it('should return status for a quantum job', async () => {
      const circuit = makeTranspiledCircuit();
      const config = makeJobConfig();

      const handle = await orchestrator.submitQuantumJob(circuit, config);
      const status = await orchestrator.getStatus(handle);

      expect(status.state).toBeDefined();
      expect(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']).toContain(status.state);
    });

    it('should throw for non-existent job', async () => {
      await expect(
        orchestrator.getStatus({ jobId: 'non-existent', type: 'quantum' })
      ).rejects.toThrow(/Job not found/);
    });

    it('should throw for non-existent workflow', async () => {
      await expect(
        orchestrator.getStatus({ workflowId: 'non-existent', type: 'workflow' })
      ).rejects.toThrow(/Workflow not found/);
    });
  });

  describe('DAG Validation', () => {
    it('should accept a valid DAG with no cycles', () => {
      const workflow: WorkflowDefinition = {
        name: 'test-workflow',
        steps: [
          { id: 'step-0', type: 'classical', config: {}, outputS3Path: 's3://out/0/' },
          { id: 'step-1', type: 'quantum', config: makeJobConfig(), outputS3Path: 's3://out/1/' },
          { id: 'step-2', type: 'classical', config: {}, outputS3Path: 's3://out/2/' },
        ],
        dependencies: [
          ['step-0', 'step-1'],
          ['step-1', 'step-2'],
        ],
      };

      expect(() => orchestrator.validateDAG(workflow)).not.toThrow();
    });

    it('should accept a DAG with no dependencies', () => {
      const workflow: WorkflowDefinition = {
        name: 'parallel-workflow',
        steps: [
          { id: 'step-0', type: 'classical', config: {}, outputS3Path: 's3://out/0/' },
          { id: 'step-1', type: 'quantum', config: makeJobConfig(), outputS3Path: 's3://out/1/' },
        ],
        dependencies: [],
      };

      expect(() => orchestrator.validateDAG(workflow)).not.toThrow();
    });

    it('should reject a DAG with a cycle', () => {
      const workflow: WorkflowDefinition = {
        name: 'cyclic-workflow',
        steps: [
          { id: 'step-0', type: 'classical', config: {}, outputS3Path: 's3://out/0/' },
          { id: 'step-1', type: 'quantum', config: makeJobConfig(), outputS3Path: 's3://out/1/' },
        ],
        dependencies: [
          ['step-0', 'step-1'],
          ['step-1', 'step-0'],
        ],
      };

      expect(() => orchestrator.validateDAG(workflow)).toThrow(/cycle/);
    });

    it('should reject a DAG with a self-loop', () => {
      const workflow: WorkflowDefinition = {
        name: 'self-loop-workflow',
        steps: [
          { id: 'step-0', type: 'classical', config: {}, outputS3Path: 's3://out/0/' },
        ],
        dependencies: [['step-0', 'step-0']],
      };

      expect(() => orchestrator.validateDAG(workflow)).toThrow(/cycle/);
    });

    it('should reject a DAG with non-existent step reference', () => {
      const workflow: WorkflowDefinition = {
        name: 'bad-ref-workflow',
        steps: [
          { id: 'step-0', type: 'classical', config: {}, outputS3Path: 's3://out/0/' },
        ],
        dependencies: [['step-0', 'non-existent']],
      };

      expect(() => orchestrator.validateDAG(workflow)).toThrow(/not found in steps/);
    });

    it('should reject a DAG with non-existent source step', () => {
      const workflow: WorkflowDefinition = {
        name: 'bad-source-workflow',
        steps: [
          { id: 'step-0', type: 'classical', config: {}, outputS3Path: 's3://out/0/' },
        ],
        dependencies: [['ghost', 'step-0']],
      };

      expect(() => orchestrator.validateDAG(workflow)).toThrow(/not found in steps/);
    });
  });

  describe('Topological Sort', () => {
    it('should return steps in dependency order', () => {
      const workflow: WorkflowDefinition = {
        name: 'linear',
        steps: [
          { id: 'c', type: 'classical', config: {}, outputS3Path: 's3://out/c/' },
          { id: 'a', type: 'classical', config: {}, outputS3Path: 's3://out/a/' },
          { id: 'b', type: 'quantum', config: makeJobConfig(), outputS3Path: 's3://out/b/' },
        ],
        dependencies: [
          ['a', 'b'],
          ['b', 'c'],
        ],
      };

      const order = orchestrator.topologicalSort(workflow);
      expect(order).not.toBeNull();
      expect(order!.indexOf('a')).toBeLessThan(order!.indexOf('b'));
      expect(order!.indexOf('b')).toBeLessThan(order!.indexOf('c'));
    });

    it('should return null for cyclic graph', () => {
      const workflow: WorkflowDefinition = {
        name: 'cyclic',
        steps: [
          { id: 'a', type: 'classical', config: {}, outputS3Path: 's3://out/a/' },
          { id: 'b', type: 'classical', config: {}, outputS3Path: 's3://out/b/' },
          { id: 'c', type: 'classical', config: {}, outputS3Path: 's3://out/c/' },
        ],
        dependencies: [
          ['a', 'b'],
          ['b', 'c'],
          ['c', 'a'],
        ],
      };

      const order = orchestrator.topologicalSort(workflow);
      expect(order).toBeNull();
    });

    it('should handle independent steps (no dependencies)', () => {
      const workflow: WorkflowDefinition = {
        name: 'parallel',
        steps: [
          { id: 'a', type: 'classical', config: {}, outputS3Path: 's3://out/a/' },
          { id: 'b', type: 'classical', config: {}, outputS3Path: 's3://out/b/' },
          { id: 'c', type: 'classical', config: {}, outputS3Path: 's3://out/c/' },
        ],
        dependencies: [],
      };

      const order = orchestrator.topologicalSort(workflow);
      expect(order).not.toBeNull();
      expect(order!.sort()).toEqual(['a', 'b', 'c']);
    });
  });

  describe('submitHybridWorkflow', () => {
    it('should execute a simple linear workflow', async () => {
      const workflow: WorkflowDefinition = {
        name: 'linear-workflow',
        steps: [
          { id: 'step-0', type: 'classical', config: {}, outputS3Path: 's3://out/0/' },
          { id: 'step-1', type: 'quantum', config: makeJobConfig(), outputS3Path: 's3://out/1/' },
        ],
        dependencies: [['step-0', 'step-1']],
      };

      const handle = await orchestrator.submitHybridWorkflow(workflow);

      expect(handle.type).toBe('workflow');
      expect(handle.workflowId).toMatch(/^wf-/);

      const status = await orchestrator.getStatus(handle);
      expect(status.state).toBe('COMPLETED');
    });

    it('should execute parallel steps independently', async () => {
      const workflow: WorkflowDefinition = {
        name: 'parallel-workflow',
        steps: [
          { id: 'step-0', type: 'classical', config: {}, outputS3Path: 's3://out/0/' },
          { id: 'step-1', type: 'classical', config: {}, outputS3Path: 's3://out/1/' },
          { id: 'step-2', type: 'classical', config: {}, outputS3Path: 's3://out/2/' },
        ],
        dependencies: [],
      };

      const handle = await orchestrator.submitHybridWorkflow(workflow);
      const status = await orchestrator.getStatus(handle);

      expect(status.state).toBe('COMPLETED');

      const stepStatuses = orchestrator.getWorkflowStepStatuses(handle)!;
      expect(stepStatuses.get('step-0')!.state).toBe('COMPLETED');
      expect(stepStatuses.get('step-1')!.state).toBe('COMPLETED');
      expect(stepStatuses.get('step-2')!.state).toBe('COMPLETED');
    });

    it('should halt dependent steps on failure', async () => {
      // Make S3 throw on a specific step to simulate failure
      const failingS3: S3StorageInterface = {
        putObject: vi.fn().mockImplementation(async (path: string) => {
          if (path.includes('step-0')) {
            throw new Error('Step 0 failed');
          }
        }),
        getObject: vi.fn().mockResolvedValue('{}'),
      };
      orchestrator = new JobOrchestrator(braketClient, failingS3, { pollIntervalMs: 1, retryBackoffMs: [1, 1, 1], resultRetrievalTimeoutMs: 50 });

      const workflow: WorkflowDefinition = {
        name: 'failing-workflow',
        steps: [
          { id: 'step-0', type: 'classical', config: {}, outputS3Path: 's3://out/step-0/' },
          { id: 'step-1', type: 'classical', config: {}, outputS3Path: 's3://out/step-1/' },
          { id: 'step-2', type: 'classical', config: {}, outputS3Path: 's3://out/step-2/' },
        ],
        dependencies: [
          ['step-0', 'step-1'],
          ['step-1', 'step-2'],
        ],
      };

      const handle = await orchestrator.submitHybridWorkflow(workflow);
      const stepStatuses = orchestrator.getWorkflowStepStatuses(handle)!;

      expect(stepStatuses.get('step-0')!.state).toBe('FAILED');
      expect(stepStatuses.get('step-1')!.state).toBe('CANCELLED');
      expect(stepStatuses.get('step-2')!.state).toBe('CANCELLED');
    });

    it('should allow independent branches to continue on failure', async () => {
      // Make S3 throw only for step-1
      const failingS3: S3StorageInterface = {
        putObject: vi.fn().mockImplementation(async (path: string) => {
          if (path.includes('step-1')) {
            throw new Error('Step 1 failed');
          }
        }),
        getObject: vi.fn().mockResolvedValue('{}'),
      };
      orchestrator = new JobOrchestrator(braketClient, failingS3, { pollIntervalMs: 1, retryBackoffMs: [1, 1, 1], resultRetrievalTimeoutMs: 50 });

      // step-0 -> step-1 -> step-3
      // step-0 -> step-2 (independent branch)
      const workflow: WorkflowDefinition = {
        name: 'branching-workflow',
        steps: [
          { id: 'step-0', type: 'classical', config: {}, outputS3Path: 's3://out/step-0/' },
          { id: 'step-1', type: 'classical', config: {}, outputS3Path: 's3://out/step-1/' },
          { id: 'step-2', type: 'classical', config: {}, outputS3Path: 's3://out/step-2/' },
          { id: 'step-3', type: 'classical', config: {}, outputS3Path: 's3://out/step-3/' },
        ],
        dependencies: [
          ['step-0', 'step-1'],
          ['step-0', 'step-2'],
          ['step-1', 'step-3'],
        ],
      };

      const handle = await orchestrator.submitHybridWorkflow(workflow);
      const stepStatuses = orchestrator.getWorkflowStepStatuses(handle)!;

      expect(stepStatuses.get('step-0')!.state).toBe('COMPLETED');
      expect(stepStatuses.get('step-1')!.state).toBe('FAILED');
      expect(stepStatuses.get('step-2')!.state).toBe('COMPLETED');
      expect(stepStatuses.get('step-3')!.state).toBe('CANCELLED');
    });

    it('should reject a workflow with cycles', async () => {
      const workflow: WorkflowDefinition = {
        name: 'cyclic-workflow',
        steps: [
          { id: 'step-0', type: 'classical', config: {}, outputS3Path: 's3://out/0/' },
          { id: 'step-1', type: 'classical', config: {}, outputS3Path: 's3://out/1/' },
        ],
        dependencies: [
          ['step-0', 'step-1'],
          ['step-1', 'step-0'],
        ],
      };

      await expect(orchestrator.submitHybridWorkflow(workflow)).rejects.toThrow(/cycle/);
    });

    it('should aggregate results on success', async () => {
      const workflow: WorkflowDefinition = {
        name: 'aggregate-workflow',
        steps: [
          { id: 'step-0', type: 'classical', config: {}, outputS3Path: 's3://out/step-0/' },
          { id: 'step-1', type: 'classical', config: {}, outputS3Path: 's3://out/step-1/' },
        ],
        dependencies: [['step-0', 'step-1']],
      };

      const handle = await orchestrator.submitHybridWorkflow(workflow);
      const status = await orchestrator.getStatus(handle);

      expect(status.state).toBe('COMPLETED');
      // Verify S3 was called to store aggregated results
      expect(s3Storage.putObject).toHaveBeenCalled();
    });

    it('should pass data between steps via S3', async () => {
      const workflow: WorkflowDefinition = {
        name: 's3-data-flow',
        steps: [
          { id: 'step-0', type: 'classical', config: {}, outputS3Path: 's3://out/step-0/' },
          {
            id: 'step-1',
            type: 'quantum',
            config: makeJobConfig(),
            inputS3Path: 's3://out/step-0/',
            outputS3Path: 's3://out/step-1/',
          },
        ],
        dependencies: [['step-0', 'step-1']],
      };

      await orchestrator.submitHybridWorkflow(workflow);

      // step-1 should have read from step-0's output path
      expect(s3Storage.getObject).toHaveBeenCalledWith('s3://out/step-0/');
    });
  });
});
