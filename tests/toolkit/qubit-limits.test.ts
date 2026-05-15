import { describe, it, expect } from 'vitest';
import { QubitLimitEnforcer } from '../../src/toolkit/qubit-limits.js';
import { EXTENDED_BACKENDS, QUBIT_REQUIREMENTS } from '../../src/toolkit/types.js';
import type { ExtendedBackendId, OperationType } from '../../src/toolkit/types.js';

describe('QubitLimitEnforcer', () => {
  const enforcer = new QubitLimitEnforcer();

  describe('enforce()', () => {
    describe('encode operation (2N qubits)', () => {
      it('allows encoding 17 bases on local simulator (34 qubits)', () => {
        const result = enforcer.enforce('encode', 17, 'braket-local-simulator');
        expect(result.allowed).toBe(true);
        expect(result.requiredQubits).toBe(34);
        expect(result.availableQubits).toBe(34);
      });

      it('rejects encoding 18 bases on local simulator (needs 36, has 34)', () => {
        const result = enforcer.enforce('encode', 18, 'braket-local-simulator');
        expect(result.allowed).toBe(false);
        expect(result.requiredQubits).toBe(36);
        expect(result.availableQubits).toBe(34);
        expect(result.error).toBeDefined();
        expect(result.error!.code).toBe('SEQUENCE_TOO_LONG');
      });

      it('allows encoding 18 bases on IonQ (36 qubits)', () => {
        const result = enforcer.enforce('encode', 18, 'ionq-forte-enterprise');
        expect(result.allowed).toBe(true);
        expect(result.requiredQubits).toBe(36);
        expect(result.availableQubits).toBe(36);
      });

      it('allows encoding 54 bases on Rigetti (108 qubits)', () => {
        const result = enforcer.enforce('encode', 54, 'rigetti-cepheus-1');
        expect(result.allowed).toBe(true);
        expect(result.requiredQubits).toBe(108);
        expect(result.availableQubits).toBe(108);
      });

      it('rejects encoding 55 bases on Rigetti (needs 110, has 108)', () => {
        const result = enforcer.enforce('encode', 55, 'rigetti-cepheus-1');
        expect(result.allowed).toBe(false);
        expect(result.requiredQubits).toBe(110);
        expect(result.availableQubits).toBe(108);
      });

      it('allows encoding 8 bases on DM1 (17 qubits)', () => {
        const result = enforcer.enforce('encode', 8, 'braket-dm1');
        expect(result.allowed).toBe(true);
        expect(result.requiredQubits).toBe(16);
        expect(result.availableQubits).toBe(17);
      });

      it('rejects encoding 9 bases on DM1 (needs 18, has 17)', () => {
        const result = enforcer.enforce('encode', 9, 'braket-dm1');
        expect(result.allowed).toBe(false);
        expect(result.requiredQubits).toBe(18);
        expect(result.availableQubits).toBe(17);
      });
    });

    describe('swap-test operation (4N+1 qubits)', () => {
      it('allows swap-test with 8 bases on local simulator (needs 33, has 34)', () => {
        const result = enforcer.enforce('swap-test', 8, 'braket-local-simulator');
        expect(result.allowed).toBe(true);
        expect(result.requiredQubits).toBe(33);
        expect(result.availableQubits).toBe(34);
      });

      it('rejects swap-test with 9 bases on local simulator (needs 37, has 34)', () => {
        const result = enforcer.enforce('swap-test', 9, 'braket-local-simulator');
        expect(result.allowed).toBe(false);
        expect(result.requiredQubits).toBe(37);
        expect(result.availableQubits).toBe(34);
      });

      it('allows swap-test with 4 bases on DM1 (needs 17, has 17)', () => {
        const result = enforcer.enforce('swap-test', 4, 'braket-dm1');
        expect(result.allowed).toBe(true);
        expect(result.requiredQubits).toBe(17);
        expect(result.availableQubits).toBe(17);
      });

      it('rejects swap-test with 5 bases on DM1 (needs 21, has 17)', () => {
        const result = enforcer.enforce('swap-test', 5, 'braket-dm1');
        expect(result.allowed).toBe(false);
        expect(result.requiredQubits).toBe(21);
        expect(result.availableQubits).toBe(17);
      });

      it('allows swap-test with 26 bases on Rigetti (needs 105, has 108)', () => {
        const result = enforcer.enforce('swap-test', 26, 'rigetti-cepheus-1');
        expect(result.allowed).toBe(true);
        expect(result.requiredQubits).toBe(105);
        expect(result.availableQubits).toBe(108);
      });

      it('rejects swap-test with 27 bases on Rigetti (needs 109, has 108)', () => {
        const result = enforcer.enforce('swap-test', 27, 'rigetti-cepheus-1');
        expect(result.allowed).toBe(false);
        expect(result.requiredQubits).toBe(109);
        expect(result.availableQubits).toBe(108);
      });
    });

    describe('grover-search operation (2N+⌈log₂N⌉ qubits)', () => {
      it('allows grover-search with 14 bases on local simulator (needs 32, has 34)', () => {
        // 2*14 + ceil(log2(14)) = 28 + 4 = 32
        const result = enforcer.enforce('grover-search', 14, 'braket-local-simulator');
        expect(result.allowed).toBe(true);
        expect(result.requiredQubits).toBe(32);
        expect(result.availableQubits).toBe(34);
      });

      it('rejects grover-search with 16 bases on local simulator (needs 36, has 34)', () => {
        // 2*16 + ceil(log2(16)) = 32 + 4 = 36
        const result = enforcer.enforce('grover-search', 16, 'braket-local-simulator');
        expect(result.allowed).toBe(false);
        expect(result.requiredQubits).toBe(36);
        expect(result.availableQubits).toBe(34);
      });

      it('allows grover-search with 6 bases on DM1 (needs 15, has 17)', () => {
        // 2*6 + ceil(log2(6)) = 12 + 3 = 15
        const result = enforcer.enforce('grover-search', 6, 'braket-dm1');
        expect(result.allowed).toBe(true);
        expect(result.requiredQubits).toBe(15);
        expect(result.availableQubits).toBe(17);
      });

      it('allows grover-search with 7 bases on DM1 (needs 17, has 17 — exact fit)', () => {
        // 2*7 + ceil(log2(7)) = 14 + 3 = 17
        const result = enforcer.enforce('grover-search', 7, 'braket-dm1');
        expect(result.allowed).toBe(true);
        expect(result.requiredQubits).toBe(17);
        expect(result.availableQubits).toBe(17);
      });

      it('rejects grover-search with 8 bases on DM1 (needs 19, has 17)', () => {
        // 2*8 + ceil(log2(8)) = 16 + 3 = 19
        const result = enforcer.enforce('grover-search', 8, 'braket-dm1');
        expect(result.allowed).toBe(false);
        expect(result.requiredQubits).toBe(19);
        expect(result.availableQubits).toBe(17);
      });
    });

    describe('error structure', () => {
      it('returns a properly structured ToolkitError on rejection', () => {
        const result = enforcer.enforce('encode', 100, 'braket-local-simulator');
        expect(result.allowed).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.error!.code).toBe('SEQUENCE_TOO_LONG');
        expect(result.error!.message).toContain('encode');
        expect(result.error!.message).toContain('200');
        expect(result.error!.message).toContain('34');
        expect(result.error!.details).toBeDefined();
        expect(result.error!.details!.operation).toBe('encode');
        expect(result.error!.details!.sequenceLength).toBe(100);
        expect(result.error!.details!.backend).toBe('braket-local-simulator');
      });

      it('does not include error when operation is allowed', () => {
        const result = enforcer.enforce('encode', 1, 'braket-local-simulator');
        expect(result.allowed).toBe(true);
        expect(result.error).toBeUndefined();
      });
    });
  });

  describe('getMaxSequenceLength()', () => {
    describe('encode operation', () => {
      it('returns 17 for local simulator (34 / 2)', () => {
        expect(enforcer.getMaxSequenceLength('encode', 'braket-local-simulator')).toBe(17);
      });

      it('returns 17 for SV1 (34 / 2)', () => {
        expect(enforcer.getMaxSequenceLength('encode', 'braket-sv1')).toBe(17);
      });

      it('returns 8 for DM1 (17 / 2 = 8.5, floor = 8)', () => {
        expect(enforcer.getMaxSequenceLength('encode', 'braket-dm1')).toBe(8);
      });

      it('returns 18 for IonQ (36 / 2)', () => {
        expect(enforcer.getMaxSequenceLength('encode', 'ionq-forte-enterprise')).toBe(18);
      });

      it('returns 54 for Rigetti (108 / 2)', () => {
        expect(enforcer.getMaxSequenceLength('encode', 'rigetti-cepheus-1')).toBe(54);
      });
    });

    describe('swap-test operation', () => {
      it('returns 8 for local simulator ((34-1)/4 = 8.25, floor = 8)', () => {
        expect(enforcer.getMaxSequenceLength('swap-test', 'braket-local-simulator')).toBe(8);
      });

      it('returns 4 for DM1 ((17-1)/4 = 4)', () => {
        expect(enforcer.getMaxSequenceLength('swap-test', 'braket-dm1')).toBe(4);
      });

      it('returns 8 for IonQ ((36-1)/4 = 8.75, floor = 8)', () => {
        expect(enforcer.getMaxSequenceLength('swap-test', 'ionq-forte-enterprise')).toBe(8);
      });

      it('returns 26 for Rigetti ((108-1)/4 = 26.75, floor = 26)', () => {
        expect(enforcer.getMaxSequenceLength('swap-test', 'rigetti-cepheus-1')).toBe(26);
      });
    });

    describe('grover-search operation', () => {
      it('returns correct max for local simulator (34 qubits)', () => {
        const max = enforcer.getMaxSequenceLength('grover-search', 'braket-local-simulator');
        // Verify the max fits
        const formula = QUBIT_REQUIREMENTS['grover-search'].formula;
        expect(formula(max)).toBeLessThanOrEqual(34);
        // Verify max+1 does not fit
        expect(formula(max + 1)).toBeGreaterThan(34);
      });

      it('returns correct max for DM1 (17 qubits)', () => {
        const max = enforcer.getMaxSequenceLength('grover-search', 'braket-dm1');
        const formula = QUBIT_REQUIREMENTS['grover-search'].formula;
        expect(formula(max)).toBeLessThanOrEqual(17);
        expect(formula(max + 1)).toBeGreaterThan(17);
      });

      it('returns correct max for IonQ (36 qubits)', () => {
        const max = enforcer.getMaxSequenceLength('grover-search', 'ionq-forte-enterprise');
        const formula = QUBIT_REQUIREMENTS['grover-search'].formula;
        expect(formula(max)).toBeLessThanOrEqual(36);
        expect(formula(max + 1)).toBeGreaterThan(36);
      });

      it('returns correct max for Rigetti (108 qubits)', () => {
        const max = enforcer.getMaxSequenceLength('grover-search', 'rigetti-cepheus-1');
        const formula = QUBIT_REQUIREMENTS['grover-search'].formula;
        expect(formula(max)).toBeLessThanOrEqual(108);
        expect(formula(max + 1)).toBeGreaterThan(108);
      });
    });

    describe('consistency with enforce()', () => {
      const backends: ExtendedBackendId[] = [
        'braket-local-simulator',
        'braket-sv1',
        'braket-dm1',
        'ionq-forte-enterprise',
        'rigetti-cepheus-1',
      ];
      const operations: OperationType[] = ['encode', 'swap-test', 'grover-search'];

      for (const backend of backends) {
        for (const operation of operations) {
          it(`max length for ${operation} on ${backend} is allowed by enforce()`, () => {
            const max = enforcer.getMaxSequenceLength(operation, backend);
            if (max > 0) {
              const result = enforcer.enforce(operation, max, backend);
              expect(result.allowed).toBe(true);
            }
          });

          it(`max+1 length for ${operation} on ${backend} is rejected by enforce()`, () => {
            const max = enforcer.getMaxSequenceLength(operation, backend);
            const result = enforcer.enforce(operation, max + 1, backend);
            expect(result.allowed).toBe(false);
          });
        }
      }
    });
  });
});
