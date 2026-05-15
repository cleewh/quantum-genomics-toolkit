/**
 * AWS HealthOmics integration for classical genomics pipeline steps.
 * Wires the Job_Orchestrator to invoke HealthOmics tasks for classical steps
 * and manages S3 intermediate storage for data passing between classical and quantum steps.
 *
 * Requirements: 6.1, 6.2, 6.3
 */

import type { WorkflowStep } from '../types/index.js';

// ─── HealthOmics Client Interface ────────────────────────────────────────────

export interface HealthOmicsClientInterface {
  startRun(params: HealthOmicsRunParams): Promise<string>; // returns run ID
  getRunStatus(runId: string): Promise<HealthOmicsRunStatus>;
  getRunOutput(runId: string): Promise<string>; // returns S3 output path
}

export interface HealthOmicsRunParams {
  workflowId: string;
  roleArn: string;
  outputUri: string;
  parameters?: Record<string, string>;
}

export interface HealthOmicsRunStatus {
  status: 'PENDING' | 'STARTING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  failureReason?: string;
}

// ─── HealthOmics Task Config ─────────────────────────────────────────────────

export interface HealthOmicsTaskConfig {
  workflowId: string;
  roleArn: string;
  parameters?: Record<string, string>;
}

/**
 * Determines if a workflow step is a HealthOmics classical step.
 */
export function isHealthOmicsStep(step: WorkflowStep): boolean {
  return step.type === 'classical' && 'workflowId' in (step.config as Record<string, unknown>);
}

/**
 * HealthOmicsExecutor handles execution of classical genomics steps via AWS HealthOmics.
 * It manages the lifecycle of HealthOmics runs and passes data via S3.
 */
export class HealthOmicsExecutor {
  private client: HealthOmicsClientInterface;
  private pollIntervalMs: number;

  constructor(client: HealthOmicsClientInterface, options?: { pollIntervalMs?: number }) {
    this.client = client;
    this.pollIntervalMs = options?.pollIntervalMs ?? 30000;
  }

  /**
   * Executes a HealthOmics workflow step.
   * Starts the run, polls for completion, and returns the output S3 path.
   */
  async executeStep(step: WorkflowStep): Promise<string> {
    const config = step.config as HealthOmicsTaskConfig;

    const runId = await this.client.startRun({
      workflowId: config.workflowId,
      roleArn: config.roleArn,
      outputUri: step.outputS3Path,
      parameters: config.parameters,
    });

    // Poll until completion
    while (true) {
      const status = await this.client.getRunStatus(runId);

      if (status.status === 'COMPLETED') {
        return await this.client.getRunOutput(runId);
      }

      if (status.status === 'FAILED' || status.status === 'CANCELLED') {
        throw new Error(
          `HealthOmics run ${runId} ${status.status.toLowerCase()}: ${status.failureReason || 'Unknown error'}`
        );
      }

      await this.delay(this.pollIntervalMs);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
