/**
 * Cost Estimator for the Quantum Genomics Toolkit.
 *
 * Calculates and displays cost estimates before paid backend execution.
 * Supports three pricing models:
 * - Free (local simulator): $0
 * - Per-minute (SV1, DM1): costPerMinute × estimatedMinutes
 * - Per-task-and-shot (QPU): (costPerTask × circuitCount) + (costPerShot × shots × circuitCount)
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5
 */

import {
  ExtendedBackendId,
  EXTENDED_BACKENDS,
  CostEstimate,
  CostBreakdown,
  CostableOperation,
} from '../types.js';

// ─── Cost Estimator ──────────────────────────────────────────────────────────

export class CostEstimator {
  /**
   * Estimates the cost of a quantum operation based on the backend's pricing model.
   *
   * - QPU (per-task-and-shot): totalCost = (costPerTask × circuitCount) + (costPerShot × shots × circuitCount)
   * - Simulator (per-minute): totalCost = costPerMinute × estimatedMinutes
   *   (estimatedMinutes is derived from circuit depth: depth × 0.001 minutes per depth unit × circuitCount)
   * - Free (local): totalCost = 0
   */
  estimate(operation: CostableOperation): CostEstimate {
    const backendConfig = EXTENDED_BACKENDS[operation.backend];
    const { shots, circuitCount, estimatedCircuitDepth } = operation;

    let totalCost = 0;
    let taskCost = 0;
    let shotCost = 0;
    let simulatorTimeCost = 0;
    let estimatedExecutionTimeSeconds = 0;

    switch (backendConfig.costModel) {
      case 'free': {
        // Local simulator: free, estimate time based on circuit complexity
        totalCost = 0;
        estimatedExecutionTimeSeconds = estimatedCircuitDepth * 0.01 * circuitCount;
        break;
      }

      case 'per-minute': {
        // SV1, DM1: cost based on estimated execution time
        // Estimate: each depth unit takes ~0.001 minutes per circuit
        const estimatedMinutes = estimatedCircuitDepth * 0.001 * circuitCount;
        simulatorTimeCost = (backendConfig.costPerMinute ?? 0) * estimatedMinutes;
        totalCost = simulatorTimeCost;
        estimatedExecutionTimeSeconds = estimatedMinutes * 60;
        break;
      }

      case 'per-task-and-shot': {
        // QPU backends: task cost + shot cost
        taskCost = (backendConfig.costPerTask ?? 0) * circuitCount;
        shotCost = (backendConfig.costPerShot ?? 0) * shots * circuitCount;
        totalCost = taskCost + shotCost;
        // QPU execution: estimate ~0.1 seconds per shot per circuit
        estimatedExecutionTimeSeconds = shots * circuitCount * 0.001 + circuitCount * 5;
        break;
      }
    }

    const breakdown: CostBreakdown = {
      taskCost,
      shotCost,
      simulatorTimeCost,
      totalShots: shots * circuitCount,
      circuitCount,
    };

    return {
      totalCost,
      breakdown,
      backend: operation.backend,
      isFree: backendConfig.costModel === 'free',
      estimatedExecutionTimeSeconds,
    };
  }

  /**
   * Formats a cost estimate into a human-readable string.
   * Includes shots, backend name, and estimated execution time.
   */
  formatEstimate(estimate: CostEstimate): string {
    const backendConfig = EXTENDED_BACKENDS[estimate.backend];
    const backendName = backendConfig.name;
    const shots = estimate.breakdown.totalShots;
    const executionTime = this.formatTime(estimate.estimatedExecutionTimeSeconds);

    if (estimate.isFree) {
      return (
        `Cost Estimate: FREE\n` +
        `Backend: ${backendName}\n` +
        `Shots: ${shots}\n` +
        `Estimated execution time: ${executionTime}`
      );
    }

    const costStr = `$${estimate.totalCost.toFixed(4)}`;
    let details = `Cost Estimate: ${costStr}\n` +
      `Backend: ${backendName}\n` +
      `Shots: ${shots}\n` +
      `Estimated execution time: ${executionTime}`;

    if (estimate.breakdown.taskCost > 0) {
      details += `\n  Task cost: $${estimate.breakdown.taskCost.toFixed(4)}`;
    }
    if (estimate.breakdown.shotCost > 0) {
      details += `\n  Shot cost: $${estimate.breakdown.shotCost.toFixed(4)}`;
    }
    if (estimate.breakdown.simulatorTimeCost > 0) {
      details += `\n  Simulator time cost: $${estimate.breakdown.simulatorTimeCost.toFixed(4)}`;
    }

    return details;
  }

  /**
   * Returns true if the given backend is free (local simulator).
   */
  isFreeBackend(backend: ExtendedBackendId): boolean {
    const backendConfig = EXTENDED_BACKENDS[backend];
    return backendConfig.costModel === 'free';
  }

  /**
   * Formats seconds into a human-readable time string.
   */
  private formatTime(seconds: number): string {
    if (seconds < 1) {
      return `${Math.round(seconds * 1000)}ms`;
    }
    if (seconds < 60) {
      return `${seconds.toFixed(1)}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}m ${remainingSeconds}s`;
  }
}
