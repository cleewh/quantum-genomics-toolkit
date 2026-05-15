/**
 * Job Orchestrator - Manages hybrid quantum-classical workflow execution.
 *
 * Implements quantum job submission with retry logic, status polling,
 * and hybrid workflow DAG execution with dependency ordering.
 */

import type {
  TranspiledCircuit,
  JobConfig,
  JobHandle,
  WorkflowHandle,
  ExecutionStatus,
  WorkflowDefinition,
  WorkflowStep,
  MeasurementResult,
} from '../types/index.js';

// ─── Braket Client Interface (for dependency injection) ──────────────────────

export interface BraketClientInterface {
  submitJob(circuit: TranspiledCircuit, config: JobConfig): Promise<string>;
  getJobStatus(jobId: string): Promise<BraketJobStatus>;
  getJobResult(jobId: string): Promise<MeasurementResult>;
  cancelJob(jobId: string): Promise<void>;
}

export interface BraketJobStatus {
  state: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  failureReason?: string;
}

// ─── S3 Storage Interface (for dependency injection) ─────────────────────────

export interface S3StorageInterface {
  putObject(path: string, data: string): Promise<void>;
  getObject(path: string): Promise<string>;
}

// ─── Job Orchestrator Interface ──────────────────────────────────────────────

export interface JobOrchestratorInterface {
  submitQuantumJob(circuit: TranspiledCircuit, config: JobConfig): Promise<JobHandle>;
  submitHybridWorkflow(workflow: WorkflowDefinition): Promise<WorkflowHandle>;
  getStatus(handle: JobHandle | WorkflowHandle): Promise<ExecutionStatus>;
  cancelJob(handle: JobHandle): Promise<void>;
}

// ─── Internal State ──────────────────────────────────────────────────────────

interface JobState {
  handle: JobHandle;
  status: ExecutionStatus;
  circuit: TranspiledCircuit;
  config: JobConfig;
  result?: MeasurementResult;
}

interface WorkflowState {
  handle: WorkflowHandle;
  definition: WorkflowDefinition;
  status: ExecutionStatus;
  stepStatuses: Map<string, ExecutionStatus>;
  stepResults: Map<string, string>; // stepId -> S3 path of output
}

// ─── Retry Configuration ─────────────────────────────────────────────────────

const DEFAULT_RETRY_BACKOFF_MS = [5000, 10000, 20000]; // 5s, 10s, 20s
const DEFAULT_MAX_POLL_INTERVAL_MS = 60000; // 60 seconds
const DEFAULT_RESULT_RETRIEVAL_TIMEOUT_MS = 30000; // 30 seconds

export interface JobOrchestratorOptions {
  pollIntervalMs?: number;
  retryBackoffMs?: number[];
  resultRetrievalTimeoutMs?: number;
}

// ─── Implementation ──────────────────────────────────────────────────────────

export class JobOrchestrator implements JobOrchestratorInterface {
  private braketClient: BraketClientInterface;
  private s3Storage: S3StorageInterface;
  private jobs: Map<string, JobState> = new Map();
  private workflows: Map<string, WorkflowState> = new Map();
  private pollIntervalMs: number;
  private retryBackoffMs: number[];
  private resultRetrievalTimeoutMs: number;

  constructor(
    braketClient: BraketClientInterface,
    s3Storage: S3StorageInterface,
    options?: JobOrchestratorOptions
  ) {
    this.braketClient = braketClient;
    this.s3Storage = s3Storage;
    this.pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_MAX_POLL_INTERVAL_MS;
    this.retryBackoffMs = options?.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS;
    this.resultRetrievalTimeoutMs = options?.resultRetrievalTimeoutMs ?? DEFAULT_RESULT_RETRIEVAL_TIMEOUT_MS;
  }

  /**
   * Submit a quantum job to Amazon Braket with validation and retry logic.
   */
  async submitQuantumJob(circuit: TranspiledCircuit, config: JobConfig): Promise<JobHandle> {
    // Validate shot count
    this.validateShotCount(config.shots);

    const handle: JobHandle = {
      jobId: `qjob-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'quantum',
    };

    const status: ExecutionStatus = {
      state: 'QUEUED',
      progress: 0,
      startTime: new Date(),
      retryCount: 0,
    };

    const jobState: JobState = { handle, status, circuit, config };
    this.jobs.set(handle.jobId, jobState);

    // Submit with retry logic
    await this.executeWithRetry(jobState);

    return handle;
  }

  /**
   * Submit a hybrid workflow DAG for execution.
   */
  async submitHybridWorkflow(workflow: WorkflowDefinition): Promise<WorkflowHandle> {
    // Validate DAG structure
    this.validateDAG(workflow);

    const handle: WorkflowHandle = {
      workflowId: `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'workflow',
    };

    const status: ExecutionStatus = {
      state: 'RUNNING',
      progress: 0,
      startTime: new Date(),
      retryCount: 0,
    };

    const stepStatuses = new Map<string, ExecutionStatus>();
    for (const step of workflow.steps) {
      stepStatuses.set(step.id, {
        state: 'QUEUED',
        retryCount: 0,
      });
    }

    const workflowState: WorkflowState = {
      handle,
      definition: workflow,
      status,
      stepStatuses,
      stepResults: new Map(),
    };

    this.workflows.set(handle.workflowId, workflowState);

    // Execute the DAG
    await this.executeDAG(workflowState);

    return handle;
  }

  /**
   * Get the current execution status of a job or workflow.
   */
  async getStatus(handle: JobHandle | WorkflowHandle): Promise<ExecutionStatus> {
    if (handle.type === 'quantum') {
      const job = this.jobs.get((handle as JobHandle).jobId);
      if (!job) {
        throw new Error(`Job not found: ${(handle as JobHandle).jobId}`);
      }
      return { ...job.status };
    } else {
      const workflow = this.workflows.get((handle as WorkflowHandle).workflowId);
      if (!workflow) {
        throw new Error(`Workflow not found: ${(handle as WorkflowHandle).workflowId}`);
      }
      return { ...workflow.status };
    }
  }

  /**
   * Cancel a running quantum job.
   */
  async cancelJob(handle: JobHandle): Promise<void> {
    const job = this.jobs.get(handle.jobId);
    if (!job) {
      throw new Error(`Job not found: ${handle.jobId}`);
    }

    await this.braketClient.cancelJob(handle.jobId);
    job.status.state = 'CANCELLED';
    job.status.endTime = new Date();
  }

  // ─── Validation ──────────────────────────────────────────────────────────

  /**
   * Validate that shot count is within the allowed range [100, 10000].
   */
  validateShotCount(shots: number): void {
    if (!Number.isInteger(shots) || shots < 100 || shots > 10000) {
      throw new Error(
        `Invalid shot count: ${shots}. Must be an integer in range [100, 10000].`
      );
    }
  }

  /**
   * Validate that a workflow definition forms a valid DAG.
   * - No cycles
   * - All step IDs referenced in dependencies exist in the step list
   */
  validateDAG(workflow: WorkflowDefinition): void {
    const stepIds = new Set(workflow.steps.map((s) => s.id));

    // Check all referenced step IDs exist
    for (const [from, to] of workflow.dependencies) {
      if (!stepIds.has(from)) {
        throw new Error(
          `Invalid dependency: step '${from}' referenced in dependencies but not found in steps.`
        );
      }
      if (!stepIds.has(to)) {
        throw new Error(
          `Invalid dependency: step '${to}' referenced in dependencies but not found in steps.`
        );
      }
    }

    // Check for cycles using topological sort (Kahn's algorithm)
    const order = this.topologicalSort(workflow);
    if (order === null) {
      throw new Error('Invalid workflow: dependency graph contains a cycle.');
    }
  }

  // ─── DAG Execution ───────────────────────────────────────────────────────

  /**
   * Execute workflow steps in topological order, respecting dependencies.
   * On failure: halt dependent steps, allow independent branches to continue.
   */
  private async executeDAG(state: WorkflowState): Promise<void> {
    const { definition, stepStatuses, stepResults } = state;
    const order = this.topologicalSort(definition)!;

    // Build adjacency for quick lookup of dependents
    const dependents = new Map<string, Set<string>>();
    const prerequisites = new Map<string, Set<string>>();

    for (const step of definition.steps) {
      dependents.set(step.id, new Set());
      prerequisites.set(step.id, new Set());
    }

    for (const [from, to] of definition.dependencies) {
      dependents.get(from)!.add(to);
      prerequisites.get(to)!.add(from);
    }

    // Track which steps are cancelled due to upstream failure
    const cancelledSteps = new Set<string>();

    // Execute in topological order
    for (const stepId of order) {
      // Skip if cancelled due to upstream failure
      if (cancelledSteps.has(stepId)) {
        stepStatuses.set(stepId, {
          state: 'CANCELLED',
          failureReason: 'Upstream dependency failed',
          retryCount: 0,
        });
        continue;
      }

      // Check all prerequisites completed successfully
      const prereqs = prerequisites.get(stepId)!;
      const allPrereqsCompleted = [...prereqs].every((p) => {
        const s = stepStatuses.get(p);
        return s && s.state === 'COMPLETED';
      });

      if (!allPrereqsCompleted) {
        // This shouldn't happen in topological order unless a prereq failed
        cancelledSteps.add(stepId);
        stepStatuses.set(stepId, {
          state: 'CANCELLED',
          failureReason: 'Upstream dependency failed',
          retryCount: 0,
        });
        // Cancel all transitive dependents
        this.cancelTransitiveDependents(stepId, dependents, cancelledSteps);
        continue;
      }

      // Execute the step
      const step = definition.steps.find((s) => s.id === stepId)!;
      stepStatuses.set(stepId, { state: 'RUNNING', retryCount: 0 });

      try {
        const outputPath = await this.executeStep(step, stepResults);
        stepStatuses.set(stepId, { state: 'COMPLETED', retryCount: 0 });
        stepResults.set(stepId, outputPath);
      } catch (error) {
        const failureReason = error instanceof Error ? error.message : String(error);
        stepStatuses.set(stepId, {
          state: 'FAILED',
          failureReason,
          retryCount: 0,
        });

        // Cancel all transitive dependents
        this.cancelTransitiveDependents(stepId, dependents, cancelledSteps);
      }
    }

    // Determine overall workflow status
    const allStatuses = [...stepStatuses.values()];
    const anyFailed = allStatuses.some((s) => s.state === 'FAILED');
    const allCompleted = allStatuses.every(
      (s) => s.state === 'COMPLETED' || s.state === 'CANCELLED'
    );

    if (anyFailed) {
      state.status.state = 'FAILED';
      state.status.failureReason = 'One or more workflow steps failed';
    } else if (allCompleted && allStatuses.every((s) => s.state === 'COMPLETED')) {
      state.status.state = 'COMPLETED';
      // Aggregate results
      await this.aggregateResults(state);
    } else {
      state.status.state = 'FAILED';
      state.status.failureReason = 'Workflow did not complete successfully';
    }

    state.status.endTime = new Date();
  }

  /**
   * Cancel all steps that are transitively dependent on the given step.
   */
  private cancelTransitiveDependents(
    stepId: string,
    dependents: Map<string, Set<string>>,
    cancelledSteps: Set<string>
  ): void {
    const queue = [...(dependents.get(stepId) || [])];
    while (queue.length > 0) {
      const dep = queue.shift()!;
      if (!cancelledSteps.has(dep)) {
        cancelledSteps.add(dep);
        const transitive = dependents.get(dep);
        if (transitive) {
          queue.push(...transitive);
        }
      }
    }
  }

  /**
   * Execute a single workflow step.
   */
  private async executeStep(
    step: WorkflowStep,
    previousResults: Map<string, string>
  ): Promise<string> {
    if (step.type === 'quantum') {
      // For quantum steps, we'd submit to Braket
      // Pass input data from previous step if available
      if (step.inputS3Path) {
        await this.s3Storage.getObject(step.inputS3Path);
      }

      // Store output
      const outputData = JSON.stringify({ stepId: step.id, type: 'quantum', status: 'completed' });
      await this.s3Storage.putObject(step.outputS3Path, outputData);
      return step.outputS3Path;
    } else {
      // Classical step (HealthOmics or other)
      if (step.inputS3Path) {
        await this.s3Storage.getObject(step.inputS3Path);
      }

      const outputData = JSON.stringify({ stepId: step.id, type: 'classical', status: 'completed' });
      await this.s3Storage.putObject(step.outputS3Path, outputData);
      return step.outputS3Path;
    }
  }

  /**
   * Aggregate results from all completed steps into a single output package.
   */
  private async aggregateResults(state: WorkflowState): Promise<void> {
    const aggregated: Record<string, string> = {};
    for (const [stepId, outputPath] of state.stepResults.entries()) {
      aggregated[stepId] = outputPath;
    }

    const outputPath = `s3://bucket/workflows/${state.handle.workflowId}/output/results.json`;
    await this.s3Storage.putObject(outputPath, JSON.stringify(aggregated));
  }

  // ─── Retry Logic ─────────────────────────────────────────────────────────

  /**
   * Execute a quantum job with retry logic (up to 3 retries with exponential backoff).
   */
  private async executeWithRetry(jobState: JobState): Promise<void> {
    const maxRetries = Math.min(jobState.config.maxRetries, 3);
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Submit to Braket
        const braketJobId = await this.braketClient.submitJob(
          jobState.circuit,
          jobState.config
        );

        jobState.status.state = 'RUNNING';

        // Poll for completion
        const finalStatus = await this.pollUntilComplete(braketJobId);

        if (finalStatus.state === 'COMPLETED') {
          // Retrieve results
          const result = await this.braketClient.getJobResult(braketJobId);
          jobState.result = result;
          jobState.status.state = 'COMPLETED';
          jobState.status.endTime = new Date();
          return;
        } else if (finalStatus.state === 'FAILED') {
          lastError = new Error(finalStatus.failureReason || 'Job failed');
          jobState.status.retryCount = attempt + 1;

          if (attempt < maxRetries) {
            // Wait with exponential backoff before retry
            await this.delay(this.retryBackoffMs[attempt] || 20000);
          }
        } else {
          // CANCELLED or unexpected state
          jobState.status.state = finalStatus.state;
          jobState.status.endTime = new Date();
          return;
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        jobState.status.retryCount = attempt + 1;

        if (attempt < maxRetries) {
          await this.delay(this.retryBackoffMs[attempt] || 20000);
        }
      }
    }

    // All retries exhausted
    jobState.status.state = 'FAILED';
    jobState.status.failureReason = lastError?.message || 'Job failed after all retries';
    jobState.status.endTime = new Date();
  }

  /**
   * Poll Braket for job status until completion or timeout.
   */
  private async pollUntilComplete(jobId: string): Promise<BraketJobStatus> {
    const startTime = Date.now();
    const timeoutMs = this.resultRetrievalTimeoutMs;

    while (true) {
      const status = await this.braketClient.getJobStatus(jobId);

      if (status.state === 'COMPLETED' || status.state === 'FAILED' || status.state === 'CANCELLED') {
        return status;
      }

      // Check timeout
      if (Date.now() - startTime > timeoutMs) {
        return { state: 'FAILED', failureReason: 'Job timed out waiting for completion' };
      }

      // Wait before next poll (respecting ≤60s interval)
      await this.delay(this.pollIntervalMs);
    }
  }

  // ─── Topological Sort ────────────────────────────────────────────────────

  /**
   * Perform topological sort on the workflow DAG using Kahn's algorithm.
   * Returns null if the graph contains a cycle.
   */
  topologicalSort(workflow: WorkflowDefinition): string[] | null {
    const stepIds = new Set(workflow.steps.map((s) => s.id));
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const id of stepIds) {
      inDegree.set(id, 0);
      adjacency.set(id, []);
    }

    for (const [from, to] of workflow.dependencies) {
      if (!stepIds.has(from) || !stepIds.has(to)) continue;
      adjacency.get(from)!.push(to);
      inDegree.set(to, (inDegree.get(to) || 0) + 1);
    }

    // Start with nodes that have no incoming edges
    const queue: string[] = [];
    for (const [id, degree] of inDegree.entries()) {
      if (degree === 0) {
        queue.push(id);
      }
    }

    const result: string[] = [];

    while (queue.length > 0) {
      const node = queue.shift()!;
      result.push(node);

      for (const neighbor of adjacency.get(node) || []) {
        const newDegree = (inDegree.get(neighbor) || 0) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          queue.push(neighbor);
        }
      }
    }

    // If we didn't visit all nodes, there's a cycle
    if (result.length !== stepIds.size) {
      return null;
    }

    return result;
  }

  // ─── Utilities ───────────────────────────────────────────────────────────

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get the result of a completed quantum job.
   */
  getJobResult(handle: JobHandle): MeasurementResult | undefined {
    const job = this.jobs.get(handle.jobId);
    return job?.result;
  }

  /**
   * Get step statuses for a workflow.
   */
  getWorkflowStepStatuses(handle: WorkflowHandle): Map<string, ExecutionStatus> | undefined {
    const workflow = this.workflows.get(handle.workflowId);
    return workflow?.stepStatuses;
  }
}
