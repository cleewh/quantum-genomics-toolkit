/**
 * Unit tests for the Cost Estimator.
 *
 * Tests cost calculation for QPU, simulator, and free backends,
 * format output, and free backend detection.
 */

import { describe, it, expect } from 'vitest';
import { CostEstimator } from '../../src/toolkit/cost-estimator/cost-estimator.js';
import { CostableOperation } from '../../src/toolkit/types.js';

describe('CostEstimator', () => {
  const estimator = new CostEstimator();

  describe('estimate()', () => {
    describe('QPU backends (per-task-and-shot)', () => {
      it('calculates cost for IonQ Forte Enterprise', () => {
        const operation: CostableOperation = {
          backend: 'ionq-forte-enterprise',
          shots: 1000,
          circuitCount: 1,
          estimatedCircuitDepth: 50,
        };

        const result = estimator.estimate(operation);

        // taskCost = 0.30 × 1 = 0.30
        // shotCost = 0.01 × 1000 × 1 = 10.00
        // totalCost = 0.30 + 10.00 = 10.30
        expect(result.totalCost).toBeCloseTo(10.30, 4);
        expect(result.breakdown.taskCost).toBeCloseTo(0.30, 4);
        expect(result.breakdown.shotCost).toBeCloseTo(10.00, 4);
        expect(result.breakdown.simulatorTimeCost).toBe(0);
        expect(result.isFree).toBe(false);
        expect(result.backend).toBe('ionq-forte-enterprise');
      });

      it('calculates cost for Rigetti Cepheus-1 with multiple circuits', () => {
        const operation: CostableOperation = {
          backend: 'rigetti-cepheus-1',
          shots: 500,
          circuitCount: 3,
          estimatedCircuitDepth: 100,
        };

        const result = estimator.estimate(operation);

        // taskCost = 0.30 × 3 = 0.90
        // shotCost = 0.01 × 500 × 3 = 15.00
        // totalCost = 0.90 + 15.00 = 15.90
        expect(result.totalCost).toBeCloseTo(15.90, 4);
        expect(result.breakdown.taskCost).toBeCloseTo(0.90, 4);
        expect(result.breakdown.shotCost).toBeCloseTo(15.00, 4);
        expect(result.breakdown.totalShots).toBe(1500);
        expect(result.breakdown.circuitCount).toBe(3);
      });

      it('handles single shot', () => {
        const operation: CostableOperation = {
          backend: 'ionq-forte-enterprise',
          shots: 1,
          circuitCount: 1,
          estimatedCircuitDepth: 10,
        };

        const result = estimator.estimate(operation);

        // taskCost = 0.30 × 1 = 0.30
        // shotCost = 0.01 × 1 × 1 = 0.01
        // totalCost = 0.31
        expect(result.totalCost).toBeCloseTo(0.31, 4);
      });
    });

    describe('simulator backends (per-minute)', () => {
      it('calculates cost for SV1', () => {
        const operation: CostableOperation = {
          backend: 'braket-sv1',
          shots: 1000,
          circuitCount: 1,
          estimatedCircuitDepth: 100,
        };

        const result = estimator.estimate(operation);

        // estimatedMinutes = 100 * 0.001 * 1 = 0.1 minutes
        // simulatorTimeCost = 0.075 * 0.1 = 0.0075
        expect(result.totalCost).toBeCloseTo(0.0075, 4);
        expect(result.breakdown.simulatorTimeCost).toBeCloseTo(0.0075, 4);
        expect(result.breakdown.taskCost).toBe(0);
        expect(result.breakdown.shotCost).toBe(0);
        expect(result.isFree).toBe(false);
      });

      it('calculates cost for DM1 with multiple circuits', () => {
        const operation: CostableOperation = {
          backend: 'braket-dm1',
          shots: 500,
          circuitCount: 5,
          estimatedCircuitDepth: 200,
        };

        const result = estimator.estimate(operation);

        // estimatedMinutes = 200 * 0.001 * 5 = 1.0 minutes
        // simulatorTimeCost = 0.075 * 1.0 = 0.075
        expect(result.totalCost).toBeCloseTo(0.075, 4);
        expect(result.breakdown.simulatorTimeCost).toBeCloseTo(0.075, 4);
        expect(result.isFree).toBe(false);
      });

      it('provides estimated execution time in seconds', () => {
        const operation: CostableOperation = {
          backend: 'braket-sv1',
          shots: 1000,
          circuitCount: 1,
          estimatedCircuitDepth: 100,
        };

        const result = estimator.estimate(operation);

        // estimatedMinutes = 100 * 0.001 * 1 = 0.1 minutes = 6 seconds
        expect(result.estimatedExecutionTimeSeconds).toBeCloseTo(6, 1);
      });
    });

    describe('free backends (local simulator)', () => {
      it('returns zero cost for local simulator', () => {
        const operation: CostableOperation = {
          backend: 'braket-local-simulator',
          shots: 10000,
          circuitCount: 10,
          estimatedCircuitDepth: 500,
        };

        const result = estimator.estimate(operation);

        expect(result.totalCost).toBe(0);
        expect(result.breakdown.taskCost).toBe(0);
        expect(result.breakdown.shotCost).toBe(0);
        expect(result.breakdown.simulatorTimeCost).toBe(0);
        expect(result.isFree).toBe(true);
        expect(result.backend).toBe('braket-local-simulator');
      });

      it('still provides execution time estimate for free backend', () => {
        const operation: CostableOperation = {
          backend: 'braket-local-simulator',
          shots: 1000,
          circuitCount: 1,
          estimatedCircuitDepth: 50,
        };

        const result = estimator.estimate(operation);

        expect(result.estimatedExecutionTimeSeconds).toBeGreaterThan(0);
      });
    });
  });

  describe('formatEstimate()', () => {
    it('formats free backend estimate', () => {
      const operation: CostableOperation = {
        backend: 'braket-local-simulator',
        shots: 1000,
        circuitCount: 1,
        estimatedCircuitDepth: 50,
      };

      const estimate = estimator.estimate(operation);
      const formatted = estimator.formatEstimate(estimate);

      expect(formatted).toContain('FREE');
      expect(formatted).toContain('Amazon Braket Local Simulator');
      expect(formatted).toContain('1000');
      // Should contain execution time
      expect(formatted).toMatch(/Estimated execution time:/);
    });

    it('formats QPU backend estimate with breakdown', () => {
      const operation: CostableOperation = {
        backend: 'ionq-forte-enterprise',
        shots: 1000,
        circuitCount: 1,
        estimatedCircuitDepth: 50,
      };

      const estimate = estimator.estimate(operation);
      const formatted = estimator.formatEstimate(estimate);

      expect(formatted).toContain('$');
      expect(formatted).toContain('IonQ Forte Enterprise');
      expect(formatted).toContain('1000');
      expect(formatted).toContain('Task cost');
      expect(formatted).toContain('Shot cost');
      expect(formatted).toMatch(/Estimated execution time:/);
    });

    it('formats simulator backend estimate', () => {
      const operation: CostableOperation = {
        backend: 'braket-sv1',
        shots: 1000,
        circuitCount: 2,
        estimatedCircuitDepth: 100,
      };

      const estimate = estimator.estimate(operation);
      const formatted = estimator.formatEstimate(estimate);

      expect(formatted).toContain('$');
      expect(formatted).toContain('Amazon Braket SV1');
      expect(formatted).toContain('2000'); // totalShots = 1000 * 2
      expect(formatted).toContain('Simulator time cost');
      expect(formatted).toMatch(/Estimated execution time:/);
    });

    it('includes shots count in formatted output', () => {
      const operation: CostableOperation = {
        backend: 'rigetti-cepheus-1',
        shots: 5000,
        circuitCount: 1,
        estimatedCircuitDepth: 30,
      };

      const estimate = estimator.estimate(operation);
      const formatted = estimator.formatEstimate(estimate);

      expect(formatted).toContain('5000');
    });
  });

  describe('isFreeBackend()', () => {
    it('returns true for local simulator', () => {
      expect(estimator.isFreeBackend('braket-local-simulator')).toBe(true);
    });

    it('returns false for SV1', () => {
      expect(estimator.isFreeBackend('braket-sv1')).toBe(false);
    });

    it('returns false for DM1', () => {
      expect(estimator.isFreeBackend('braket-dm1')).toBe(false);
    });

    it('returns false for IonQ Forte Enterprise', () => {
      expect(estimator.isFreeBackend('ionq-forte-enterprise')).toBe(false);
    });

    it('returns false for Rigetti Cepheus-1', () => {
      expect(estimator.isFreeBackend('rigetti-cepheus-1')).toBe(false);
    });
  });
});
