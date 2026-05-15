/**
 * Unit tests for the Backend Selector.
 * Tests backend presentation, recommendation logic, and capacity validation.
 */

import { describe, it, expect } from 'vitest';
import {
  BackendSelector,
  type BackendState,
} from '../../src/orchestrator/backend-selector.js';
import type { BackendId } from '../../src/types/index.js';
import { BACKENDS } from '../../src/types/backends.js';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeBackendStates(overrides?: Partial<Record<BackendId, Partial<BackendState>>>): BackendState[] {
  const defaults: BackendState[] = [
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

  if (overrides) {
    return defaults.map((state) => {
      const override = overrides[state.id];
      return override ? { ...state, ...override } : state;
    });
  }

  return defaults;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('BackendSelector', () => {
  describe('presentBackends', () => {
    it('should present all backends with capacity, queue depth, and cost', () => {
      const selector = new BackendSelector(makeBackendStates());
      const presentations = selector.presentBackends();

      expect(presentations).toHaveLength(3);

      const ionq = presentations.find((p) => p.id === 'ionq-forte-enterprise')!;
      expect(ionq.name).toBe('IonQ Forte Enterprise');
      expect(ionq.provider).toBe('IonQ');
      expect(ionq.qubitCapacity).toBe(36);
      expect(ionq.maxSequenceLength).toBe(18);
      expect(ionq.available).toBe(true);
      expect(ionq.queueDepth).toBe(5);
      expect(ionq.estimatedQueueTimeMinutes).toBe(15);
      expect(ionq.costPerShot).toBe(0.01);
    });

    it('should include local simulator', () => {
      const selector = new BackendSelector(makeBackendStates());
      const presentations = selector.presentBackends();

      const simulator = presentations.find((p) => p.id === 'braket-local-simulator')!;
      expect(simulator.name).toBe('Amazon Braket Local Simulator');
      expect(simulator.qubitCapacity).toBe(34);
      expect(simulator.costPerShot).toBe(0.0001);
    });

    it('should reflect unavailable backends', () => {
      const states = makeBackendStates({
        'ionq-forte-enterprise': { available: false },
      });
      const selector = new BackendSelector(states);
      const presentations = selector.presentBackends();

      const ionq = presentations.find((p) => p.id === 'ionq-forte-enterprise')!;
      expect(ionq.available).toBe(false);
    });
  });

  describe('recommendBackend', () => {
    it('should recommend backend with lowest sufficient qubit count', () => {
      const selector = new BackendSelector(makeBackendStates());

      // Need 30 qubits: simulator (34) and IonQ (36) fit, Rigetti (108) also fits
      // Simulator has lowest qubit count that fits
      const rec = selector.recommendBackend(30);

      expect(rec).not.toBeNull();
      expect(rec!.recommended).toBe('braket-local-simulator');
    });

    it('should recommend IonQ when genome needs more than simulator capacity', () => {
      const selector = new BackendSelector(makeBackendStates());

      // Need 35 qubits: only IonQ (36) and Rigetti (108) fit
      const rec = selector.recommendBackend(35);

      expect(rec).not.toBeNull();
      expect(rec!.recommended).toBe('ionq-forte-enterprise');
    });

    it('should recommend Rigetti when genome needs more than IonQ capacity', () => {
      const selector = new BackendSelector(makeBackendStates());

      // Need 50 qubits: only Rigetti (108) fits
      const rec = selector.recommendBackend(50);

      expect(rec).not.toBeNull();
      expect(rec!.recommended).toBe('rigetti-cepheus-1');
    });

    it('should return null when no backend can accommodate the genome', () => {
      const selector = new BackendSelector(makeBackendStates());

      // Need 200 qubits: nothing fits
      const rec = selector.recommendBackend(200);

      expect(rec).toBeNull();
    });

    it('should skip unavailable backends', () => {
      const states = makeBackendStates({
        'braket-local-simulator': { available: false },
      });
      const selector = new BackendSelector(states);

      // Need 30 qubits: simulator would fit but is unavailable
      // IonQ (36) is next smallest that fits
      const rec = selector.recommendBackend(30);

      expect(rec).not.toBeNull();
      expect(rec!.recommended).toBe('ionq-forte-enterprise');
    });

    it('should break ties by shortest queue time', () => {
      // Create two backends with same qubit count but different queue times
      const states: BackendState[] = [
        {
          id: 'ionq-forte-enterprise',
          config: { ...BACKENDS['ionq-forte-enterprise'], qubitCount: 36 },
          available: true,
          queueDepth: 10,
          estimatedQueueTimeMinutes: 30,
          costPerShot: 0.01,
        },
        {
          id: 'rigetti-cepheus-1',
          config: { ...BACKENDS['rigetti-cepheus-1'], qubitCount: 36 }, // Same qubit count
          available: true,
          queueDepth: 2,
          estimatedQueueTimeMinutes: 5,
          costPerShot: 0.005,
        },
      ];
      const selector = new BackendSelector(states);

      const rec = selector.recommendBackend(30);

      expect(rec).not.toBeNull();
      // Both have 36 qubits, Rigetti has shorter queue
      expect(rec!.recommended).toBe('rigetti-cepheus-1');
    });

    it('should include alternatives in recommendation', () => {
      const selector = new BackendSelector(makeBackendStates());

      // Need 10 qubits: all backends fit
      const rec = selector.recommendBackend(10);

      expect(rec).not.toBeNull();
      expect(rec!.alternatives.length).toBeGreaterThan(0);
    });

    it('should return null when all backends are unavailable', () => {
      const states = makeBackendStates({
        'ionq-forte-enterprise': { available: false },
        'rigetti-cepheus-1': { available: false },
        'braket-local-simulator': { available: false },
      });
      const selector = new BackendSelector(states);

      const rec = selector.recommendBackend(10);

      expect(rec).toBeNull();
    });
  });

  describe('validateGenomeFits', () => {
    it('should validate genome fits when qubits are sufficient', () => {
      const selector = new BackendSelector(makeBackendStates());

      const result = selector.validateGenomeFits(30, 'ionq-forte-enterprise');

      expect(result.valid).toBe(true);
      expect(result.requiredQubits).toBe(30);
      expect(result.availableQubits).toBe(36);
      expect(result.reason).toBeUndefined();
    });

    it('should reject genome that exceeds backend capacity', () => {
      const selector = new BackendSelector(makeBackendStates());

      const result = selector.validateGenomeFits(50, 'ionq-forte-enterprise');

      expect(result.valid).toBe(false);
      expect(result.requiredQubits).toBe(50);
      expect(result.availableQubits).toBe(36);
      expect(result.reason).toContain('requires 50 qubits');
      expect(result.reason).toContain('only provides 36');
    });

    it('should validate genome fits exactly at capacity', () => {
      const selector = new BackendSelector(makeBackendStates());

      const result = selector.validateGenomeFits(36, 'ionq-forte-enterprise');

      expect(result.valid).toBe(true);
    });

    it('should reject genome for non-existent backend', () => {
      const selector = new BackendSelector(makeBackendStates());

      const result = selector.validateGenomeFits(10, 'non-existent' as BackendId);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not found');
    });

    it('should validate against local simulator', () => {
      const selector = new BackendSelector(makeBackendStates());

      const result = selector.validateGenomeFits(34, 'braket-local-simulator');

      expect(result.valid).toBe(true);
      expect(result.availableQubits).toBe(34);
    });

    it('should reject genome exceeding local simulator capacity', () => {
      const selector = new BackendSelector(makeBackendStates());

      const result = selector.validateGenomeFits(35, 'braket-local-simulator');

      expect(result.valid).toBe(false);
    });
  });

  describe('isLocalSimulatorAvailable', () => {
    it('should return true when simulator is available', () => {
      const selector = new BackendSelector(makeBackendStates());
      expect(selector.isLocalSimulatorAvailable()).toBe(true);
    });

    it('should return false when simulator is unavailable', () => {
      const states = makeBackendStates({
        'braket-local-simulator': { available: false },
      });
      const selector = new BackendSelector(states);
      expect(selector.isLocalSimulatorAvailable()).toBe(false);
    });
  });

  describe('updateStates', () => {
    it('should update backend states dynamically', () => {
      const selector = new BackendSelector(makeBackendStates());

      // Initially IonQ is available
      expect(selector.getBackendState('ionq-forte-enterprise')!.available).toBe(true);

      // Update states
      const newStates = makeBackendStates({
        'ionq-forte-enterprise': { available: false, queueDepth: 50 },
      });
      selector.updateStates(newStates);

      expect(selector.getBackendState('ionq-forte-enterprise')!.available).toBe(false);
      expect(selector.getBackendState('ionq-forte-enterprise')!.queueDepth).toBe(50);
    });
  });

  describe('getBackendState', () => {
    it('should return state for existing backend', () => {
      const selector = new BackendSelector(makeBackendStates());
      const state = selector.getBackendState('rigetti-cepheus-1');

      expect(state).toBeDefined();
      expect(state!.id).toBe('rigetti-cepheus-1');
      expect(state!.config.qubitCount).toBe(108);
    });

    it('should return undefined for non-existent backend', () => {
      const selector = new BackendSelector(makeBackendStates());
      const state = selector.getBackendState('non-existent' as BackendId);

      expect(state).toBeUndefined();
    });
  });
});
