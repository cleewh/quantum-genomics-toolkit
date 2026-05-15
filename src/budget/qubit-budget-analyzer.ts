/**
 * Qubit Budget Analyzer
 * Assesses whether a nucleotide sequence fits within available quantum backend capacities
 * and recommends an appropriate processing strategy.
 */

import {
  ParsedSequence,
  EncodingScheme,
  BudgetAnalysis,
  FitResult,
  BackendId,
} from '../types/index.js';
import { BACKENDS } from '../types/backends.js';

export interface QubitBudgetAnalyzer {
  analyze(sequence: ParsedSequence, scheme: EncodingScheme): BudgetAnalysis;
}

/**
 * Default implementation of the QubitBudgetAnalyzer interface.
 * Calculates required qubits and evaluates fit against all registered backends.
 */
export class DefaultQubitBudgetAnalyzer implements QubitBudgetAnalyzer {
  analyze(sequence: ParsedSequence, scheme: EncodingScheme): BudgetAnalysis {
    const requiredQubits = sequence.length * scheme.qubitsPerBase;

    const backendFit: Record<BackendId, FitResult> = {} as Record<BackendId, FitResult>;

    for (const [id, config] of Object.entries(BACKENDS)) {
      const fits = requiredQubits <= config.qubitCount;
      const utilizationPercent =
        config.qubitCount > 0
          ? Math.min((requiredQubits / config.qubitCount) * 100, 100)
          : 0;

      backendFit[id as BackendId] = {
        fits,
        availableQubits: config.qubitCount,
        utilizationPercent: Math.round(utilizationPercent * 100) / 100,
      };
    }

    const recommendation = this.determineRecommendation(backendFit);

    return {
      requiredQubits,
      backendFit,
      recommendation,
    };
  }

  /**
   * Determines the processing recommendation based on backend fit results.
   * - 'direct' if the sequence fits in at least one real backend (not just simulator)
   * - 'partition' if it doesn't fit in any real backend
   */
  private determineRecommendation(
    backendFit: Record<BackendId, FitResult>
  ): 'direct' | 'compress' | 'partition' {
    // Check if it fits in at least one real backend (not the local simulator)
    const realBackendIds: BackendId[] = ['ionq-forte-enterprise', 'rigetti-cepheus-1'];

    const fitsInRealBackend = realBackendIds.some(
      (id) => backendFit[id]?.fits === true
    );

    if (fitsInRealBackend) {
      return 'direct';
    }

    return 'partition';
  }
}
