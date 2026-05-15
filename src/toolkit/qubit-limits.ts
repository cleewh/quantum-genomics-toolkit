/**
 * Per-operation qubit limit enforcer for the Quantum Genomics Toolkit.
 *
 * Validates that a given operation's qubit requirements do not exceed
 * the selected backend's capacity, and calculates maximum allowed
 * sequence lengths per operation/backend combination.
 */

import {
  ExtendedBackendId,
  EXTENDED_BACKENDS,
  OperationType,
  QUBIT_REQUIREMENTS,
  ToolkitError,
} from './types.js';

export interface EnforceResult {
  allowed: boolean;
  error?: ToolkitError;
  requiredQubits: number;
  availableQubits: number;
}

/**
 * Enforces per-operation qubit limits against backend capacity.
 */
export class QubitLimitEnforcer {
  /**
   * Checks whether the given operation with the specified sequence length
   * can be executed on the given backend.
   *
   * @param operation - The type of quantum operation (encode, swap-test, grover-search)
   * @param sequenceLength - The number of nucleotide bases in the sequence
   * @param backend - The target backend identifier
   * @returns An EnforceResult indicating whether the operation is allowed
   */
  enforce(
    operation: OperationType,
    sequenceLength: number,
    backend: ExtendedBackendId
  ): EnforceResult {
    const backendConfig = EXTENDED_BACKENDS[backend];
    const requirement = QUBIT_REQUIREMENTS[operation];

    const requiredQubits = requirement.formula(sequenceLength);
    const availableQubits = backendConfig.qubitCount;

    if (requiredQubits <= availableQubits) {
      return {
        allowed: true,
        requiredQubits,
        availableQubits,
      };
    }

    return {
      allowed: false,
      requiredQubits,
      availableQubits,
      error: {
        code: 'SEQUENCE_TOO_LONG',
        message:
          `Operation '${operation}' requires ${requiredQubits} qubits for a sequence of length ${sequenceLength}, ` +
          `but backend '${backend}' only has ${availableQubits} qubits available.`,
        details: {
          operation,
          sequenceLength,
          backend,
          requiredQubits,
          availableQubits,
          formula: operation === 'encode'
            ? '2N'
            : operation === 'swap-test'
              ? '4N+1'
              : '2N+⌈log₂N⌉',
        },
      },
    };
  }

  /**
   * Returns the maximum sequence length (N) for which the given operation
   * can be executed on the given backend without exceeding qubit capacity.
   *
   * Uses binary search for grover-search (non-linear formula) and direct
   * calculation for encode and swap-test (linear formulas).
   *
   * @param operation - The type of quantum operation
   * @param backend - The target backend identifier
   * @returns The maximum allowed sequence length (number of nucleotide bases)
   */
  getMaxSequenceLength(operation: OperationType, backend: ExtendedBackendId): number {
    const backendConfig = EXTENDED_BACKENDS[backend];
    const availableQubits = backendConfig.qubitCount;
    const requirement = QUBIT_REQUIREMENTS[operation];

    if (operation === 'encode') {
      // 2N ≤ availableQubits → N ≤ availableQubits / 2
      return Math.floor(availableQubits / 2);
    }

    if (operation === 'swap-test') {
      // 4N + 1 ≤ availableQubits → N ≤ (availableQubits - 1) / 4
      return Math.floor((availableQubits - 1) / 4);
    }

    // grover-search: 2N + ⌈log₂N⌉ ≤ availableQubits
    // Use binary search since the formula is not trivially invertible
    let low = 1;
    let high = availableQubits; // upper bound (can't need more bases than qubits)
    let result = 0;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const required = requirement.formula(mid);

      if (required <= availableQubits) {
        result = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return result;
  }
}
