/**
 * Backend Selector - Recommends and validates quantum backend selection.
 *
 * Presents available backends with capacity, queue depth, and estimated cost.
 * Recommends the backend with lowest sufficient qubit count and shortest queue.
 * Validates that a genome fits the selected backend before submission.
 */

import type { BackendId, BackendConfig } from '../types/index.js';
import { BACKENDS } from '../types/backends.js';

// ─── Backend State Interface ─────────────────────────────────────────────────

export interface BackendState {
  id: BackendId;
  config: BackendConfig;
  available: boolean;
  queueDepth: number;
  estimatedQueueTimeMinutes: number;
  costPerShot: number;
}

// ─── Backend Presentation ────────────────────────────────────────────────────

export interface BackendPresentation {
  id: BackendId;
  name: string;
  provider: string;
  qubitCapacity: number;
  maxSequenceLength: number;
  available: boolean;
  queueDepth: number;
  estimatedQueueTimeMinutes: number;
  costPerShot: number;
}

// ─── Backend Recommendation ──────────────────────────────────────────────────

export interface BackendRecommendation {
  recommended: BackendId;
  reason: string;
  alternatives: BackendId[];
}

// ─── Validation Result ───────────────────────────────────────────────────────

export interface BackendValidationResult {
  valid: boolean;
  backendId: BackendId;
  requiredQubits: number;
  availableQubits: number;
  reason?: string;
}

// ─── Backend Selector ────────────────────────────────────────────────────────

export class BackendSelector {
  private backendStates: BackendState[];

  constructor(backendStates?: BackendState[]) {
    this.backendStates = backendStates || this.getDefaultBackendStates();
  }

  /**
   * Update backend states (e.g., from a monitoring service).
   */
  updateStates(states: BackendState[]): void {
    this.backendStates = states;
  }

  /**
   * Present all available backends with their current capacity, queue depth, and cost.
   */
  presentBackends(): BackendPresentation[] {
    return this.backendStates.map((state) => ({
      id: state.id,
      name: state.config.name,
      provider: state.config.provider,
      qubitCapacity: state.config.qubitCount,
      maxSequenceLength: Math.floor(state.config.qubitCount / 2), // 2 qubits per base
      available: state.available,
      queueDepth: state.queueDepth,
      estimatedQueueTimeMinutes: state.estimatedQueueTimeMinutes,
      costPerShot: state.costPerShot,
    }));
  }

  /**
   * Recommend the best backend for a given genome size.
   *
   * Strategy:
   * 1. Filter to backends where the genome fits AND that are available
   * 2. Among those, pick the one with the lowest qubit count that still fits
   * 3. Break ties by shortest queue time
   *
   * @param requiredQubits - Number of qubits needed for the genome
   * @returns Recommendation or null if no backend can accommodate the genome
   */
  recommendBackend(requiredQubits: number): BackendRecommendation | null {
    // Filter to backends that can fit the genome and are available
    const candidates = this.backendStates.filter(
      (state) => state.available && state.config.qubitCount >= requiredQubits
    );

    if (candidates.length === 0) {
      return null;
    }

    // Sort by: lowest qubit count first, then shortest queue time
    const sorted = [...candidates].sort((a, b) => {
      const qubitDiff = a.config.qubitCount - b.config.qubitCount;
      if (qubitDiff !== 0) return qubitDiff;
      return a.estimatedQueueTimeMinutes - b.estimatedQueueTimeMinutes;
    });

    const recommended = sorted[0];
    const alternatives = sorted.slice(1).map((s) => s.id);

    return {
      recommended: recommended.id,
      reason: `Lowest sufficient qubit count (${recommended.config.qubitCount}) with shortest queue time (${recommended.estimatedQueueTimeMinutes} min)`,
      alternatives,
    };
  }

  /**
   * Validate that a genome fits within the selected backend's qubit capacity.
   *
   * @param requiredQubits - Number of qubits needed for the genome
   * @param backendId - The selected backend
   * @returns Validation result
   */
  validateGenomeFits(requiredQubits: number, backendId: BackendId): BackendValidationResult {
    const state = this.backendStates.find((s) => s.id === backendId);

    if (!state) {
      return {
        valid: false,
        backendId,
        requiredQubits,
        availableQubits: 0,
        reason: `Backend '${backendId}' not found`,
      };
    }

    const availableQubits = state.config.qubitCount;
    const fits = requiredQubits <= availableQubits;

    return {
      valid: fits,
      backendId,
      requiredQubits,
      availableQubits,
      reason: fits
        ? undefined
        : `Genome requires ${requiredQubits} qubits but backend '${backendId}' only provides ${availableQubits}`,
    };
  }

  /**
   * Check if the local simulator is available for testing.
   */
  isLocalSimulatorAvailable(): boolean {
    const simulator = this.backendStates.find((s) => s.id === 'braket-local-simulator');
    return simulator?.available ?? false;
  }

  /**
   * Get the backend state for a specific backend.
   */
  getBackendState(backendId: BackendId): BackendState | undefined {
    return this.backendStates.find((s) => s.id === backendId);
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  private getDefaultBackendStates(): BackendState[] {
    return [
      {
        id: 'ionq-forte-enterprise',
        config: BACKENDS['ionq-forte-enterprise'],
        available: true,
        queueDepth: 5,
        estimatedQueueTimeMinutes: 15,
        costPerShot: 0.01,
      },
      {
        id: 'rigetti-cepheus-1',
        config: BACKENDS['rigetti-cepheus-1'],
        available: true,
        queueDepth: 3,
        estimatedQueueTimeMinutes: 10,
        costPerShot: 0.005,
      },
      {
        id: 'braket-local-simulator',
        config: BACKENDS['braket-local-simulator'],
        available: true,
        queueDepth: 0,
        estimatedQueueTimeMinutes: 0,
        costPerShot: 0.0001,
      },
    ];
  }
}
