/**
 * Noise Benchmarker for the Quantum Genomics Toolkit.
 *
 * Systematically tests encoding fidelity across configurations by iterating
 * over all combinations of (sequenceLength × backend × shotCount), generating
 * random sequences, encoding/decoding each, calculating fidelity, and producing
 * a benchmark report with recommendations.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10
 */

import type {
  ParsedSequence,
  TranspiledCircuit,
  MeasurementResult,
} from '../../types/index.js';
import { EncodingEngine } from '../../encoding/encoding-engine.js';
import { CircuitTranspiler } from '../../transpiler/circuit-transpiler.js';
import { CostEstimator } from '../cost-estimator/cost-estimator.js';
import { QubitLimitEnforcer } from '../qubit-limits.js';
import {
  ExtendedBackendId,
  EXTENDED_BACKENDS,
  CostEstimate,
} from '../types.js';

// ─── Benchmark Config ────────────────────────────────────────────────────────

export interface BenchmarkConfig {
  sequenceLengths: number[];     // e.g., [2, 4, 8, 12, 16]
  backends: ExtendedBackendId[];
  shotCounts: number[];          // e.g., [100, 500, 1000]
}

// ─── Benchmark Results ───────────────────────────────────────────────────────

export interface BenchmarkCombinationResult {
  sequenceLength: number;
  backend: ExtendedBackendId;
  shots: number;
  fidelity: number;              // fraction of correctly decoded bases
  gateCount: number;
  circuitDepth: number;
  executionTimeMs?: number;
}

export interface BenchmarkReport {
  results: BenchmarkCombinationResult[];
  recommendations: Record<string, number>;  // backend → max reliable sequence length
  totalCombinations: number;
  completedCombinations: number;
  totalCostEstimate?: CostEstimate;
}

export interface BenchmarkProgress {
  currentCombination: string;
  completedPercent: number;
}

export interface BenchmarkConfigValidation {
  valid: boolean;
  errors: string[];
}

// ─── Benchmark Executor Interface ────────────────────────────────────────────

export interface BenchmarkExecutor {
  execute(circuit: TranspiledCircuit, shots: number): Promise<MeasurementResult>;
}

// ─── Noise Benchmarker ───────────────────────────────────────────────────────

export class NoiseBenchmarker {
  private encodingEngine: EncodingEngine;
  private transpiler: CircuitTranspiler;
  private costEstimator: CostEstimator;
  private qubitLimitEnforcer: QubitLimitEnforcer;

  constructor() {
    this.encodingEngine = new EncodingEngine();
    this.transpiler = new CircuitTranspiler();
    this.costEstimator = new CostEstimator();
    this.qubitLimitEnforcer = new QubitLimitEnforcer();
  }

  /**
   * Runs the noise benchmark across all combinations of configuration parameters.
   *
   * For each (sequenceLength × backend × shotCount) combination:
   * 1. Generate a random nucleotide sequence
   * 2. Encode the sequence
   * 3. Transpile for the target backend
   * 4. Execute on the backend
   * 5. Decode the measurement results
   * 6. Calculate fidelity (fraction of correctly decoded bases)
   *
   * @param config - Benchmark configuration
   * @param executor - Circuit executor (dependency injection for testability)
   * @param onProgress - Optional progress callback
   * @returns BenchmarkReport with results and recommendations
   */
  async run(
    config: BenchmarkConfig,
    executor: BenchmarkExecutor,
    onProgress?: (progress: BenchmarkProgress) => void
  ): Promise<BenchmarkReport> {
    // Validate config first
    const validation = this.validateConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid benchmark config: ${validation.errors.join('; ')}`);
    }

    const results: BenchmarkCombinationResult[] = [];
    const totalCombinations = config.sequenceLengths.length * config.backends.length * config.shotCounts.length;
    let completedCombinations = 0;

    // Track total cost
    let totalCost = 0;

    for (const seqLength of config.sequenceLengths) {
      for (const backend of config.backends) {
        // Check if this sequence length fits on this backend
        const enforceResult = this.qubitLimitEnforcer.enforce('encode', seqLength, backend);
        if (!enforceResult.allowed) {
          // Skip combinations that exceed backend capacity
          for (const shots of config.shotCounts) {
            completedCombinations++;
            results.push({
              sequenceLength: seqLength,
              backend,
              shots,
              fidelity: 0,
              gateCount: 0,
              circuitDepth: 0,
            });

            if (onProgress) {
              onProgress({
                currentCombination: `${seqLength}bp × ${backend} × ${shots} shots (skipped: exceeds capacity)`,
                completedPercent: (completedCombinations / totalCombinations) * 100,
              });
            }
          }
          continue;
        }

        for (const shots of config.shotCounts) {
          const combinationLabel = `${seqLength}bp × ${backend} × ${shots} shots`;

          if (onProgress) {
            onProgress({
              currentCombination: combinationLabel,
              completedPercent: (completedCombinations / totalCombinations) * 100,
            });
          }

          const startTime = Date.now();

          try {
            // Generate random sequence
            const randomSeq = this.generateRandomSequence(seqLength);

            // Create ParsedSequence
            const parsedSequence: ParsedSequence = {
              id: `benchmark-${seqLength}-${backend}-${shots}`,
              description: 'Benchmark random sequence',
              nucleotides: randomSeq,
              length: seqLength,
              type: 'DNA',
              metadata: {},
            };

            // Encode (don't pass scheme explicitly to avoid duplicate mapping validation)
            const encoded = await this.encodingEngine.encode(parsedSequence);

            // Transpile
            const backendConfig = EXTENDED_BACKENDS[backend];
            const transpiled = await this.transpiler.transpile(encoded, backendConfig as any);

            // Execute
            const measurementResult = await executor.execute(transpiled, shots);

            // Decode
            const decoded = await this.encodingEngine.decode(measurementResult, encoded.scheme);

            // Calculate fidelity
            const fidelity = this.calculateFidelity(randomSeq, decoded.nucleotides);

            // Estimate cost for this combination
            const costEstimate = this.costEstimator.estimate({
              backend,
              shots,
              circuitCount: 1,
              estimatedCircuitDepth: encoded.depth,
            });
            totalCost += costEstimate.totalCost;

            const executionTimeMs = Date.now() - startTime;

            results.push({
              sequenceLength: seqLength,
              backend,
              shots,
              fidelity,
              gateCount: encoded.gateCount,
              circuitDepth: encoded.depth,
              executionTimeMs,
            });
          } catch {
            // If execution fails, record zero fidelity
            results.push({
              sequenceLength: seqLength,
              backend,
              shots,
              fidelity: 0,
              gateCount: 0,
              circuitDepth: 0,
              executionTimeMs: Date.now() - startTime,
            });
          }

          completedCombinations++;
        }
      }
    }

    // Generate recommendations
    const recommendations = this.generateRecommendations(results, config.backends);

    // Build total cost estimate
    const totalCostEstimate: CostEstimate = {
      totalCost,
      breakdown: {
        taskCost: 0,
        shotCost: 0,
        simulatorTimeCost: 0,
        totalShots: config.shotCounts.reduce((a, b) => a + b, 0) * config.sequenceLengths.length * config.backends.length,
        circuitCount: totalCombinations,
      },
      backend: config.backends[0],
      isFree: totalCost === 0,
      estimatedExecutionTimeSeconds: 0,
    };

    return {
      results,
      recommendations,
      totalCombinations,
      completedCombinations,
      totalCostEstimate,
    };
  }

  /**
   * Validates the benchmark configuration.
   *
   * Checks:
   * - Sequence lengths are within backend capacity (at least one backend can handle each)
   * - Shot counts are in [100, 10000]
   * - Backend identifiers are valid
   *
   * @param config - The benchmark configuration to validate
   * @returns Validation result with errors if invalid
   */
  validateConfig(config: BenchmarkConfig): BenchmarkConfigValidation {
    const errors: string[] = [];

    // Check sequence lengths
    if (!config.sequenceLengths || config.sequenceLengths.length === 0) {
      errors.push('At least one sequence length must be specified.');
    } else {
      for (const len of config.sequenceLengths) {
        if (len < 1) {
          errors.push(`Sequence length must be at least 1, got ${len}.`);
        }
      }
    }

    // Check backends
    if (!config.backends || config.backends.length === 0) {
      errors.push('At least one backend must be specified.');
    } else {
      const validBackends = Object.keys(EXTENDED_BACKENDS);
      for (const backend of config.backends) {
        if (!validBackends.includes(backend)) {
          errors.push(`Invalid backend identifier: '${backend}'. Valid backends: ${validBackends.join(', ')}.`);
        }
      }
    }

    // Check shot counts
    if (!config.shotCounts || config.shotCounts.length === 0) {
      errors.push('At least one shot count must be specified.');
    } else {
      for (const shots of config.shotCounts) {
        if (shots < 100 || shots > 10000) {
          errors.push(`Shot count must be between 100 and 10000, got ${shots}.`);
        }
      }
    }

    // Check that sequence lengths are within at least one backend's capacity
    if (config.sequenceLengths && config.backends && errors.length === 0) {
      for (const len of config.sequenceLengths) {
        const fitsAnyBackend = config.backends.some(backend => {
          const result = this.qubitLimitEnforcer.enforce('encode', len, backend);
          return result.allowed;
        });
        if (!fitsAnyBackend) {
          errors.push(
            `Sequence length ${len} exceeds capacity of all specified backends.`
          );
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Calculates fidelity as the fraction of correctly decoded bases.
   *
   * @param original - The original nucleotide sequence
   * @param decoded - The decoded nucleotide sequence
   * @returns Fidelity score between 0 and 1
   */
  calculateFidelity(original: string, decoded: string): number {
    if (original.length === 0) return 0;

    const length = Math.min(original.length, decoded.length);
    let matchingBases = 0;

    for (let i = 0; i < length; i++) {
      if (original[i].toUpperCase() === decoded[i].toUpperCase()) {
        matchingBases++;
      }
    }

    return matchingBases / original.length;
  }

  /**
   * Generates a random nucleotide sequence of the specified length.
   * Uses only DNA bases: A, C, G, T.
   *
   * @param length - The desired sequence length
   * @returns A random DNA sequence string
   */
  generateRandomSequence(length: number): string {
    const bases = ['A', 'C', 'G', 'T'];
    let sequence = '';

    for (let i = 0; i < length; i++) {
      const randomIndex = Math.floor(Math.random() * 4);
      sequence += bases[randomIndex];
    }

    return sequence;
  }

  /**
   * Generates recommendations: max reliable sequence length per backend where fidelity ≥ 0.7.
   *
   * @param results - All benchmark combination results
   * @param backends - List of backends to generate recommendations for
   * @returns Record mapping backend → max reliable sequence length
   */
  generateRecommendations(
    results: BenchmarkCombinationResult[],
    backends: ExtendedBackendId[]
  ): Record<string, number> {
    const recommendations: Record<string, number> = {};

    for (const backend of backends) {
      const backendResults = results.filter(r => r.backend === backend);

      // Find the maximum sequence length where fidelity >= 0.7
      // (using the best shot count for each sequence length)
      let maxReliableLength = 0;

      const lengthsWithFidelity = new Map<number, number>();

      for (const result of backendResults) {
        if (result.fidelity >= 0.7) {
          const current = lengthsWithFidelity.get(result.sequenceLength) ?? 0;
          lengthsWithFidelity.set(result.sequenceLength, Math.max(current, result.fidelity));
        }
      }

      for (const [length] of lengthsWithFidelity) {
        if (length > maxReliableLength) {
          maxReliableLength = length;
        }
      }

      recommendations[backend] = maxReliableLength;
    }

    return recommendations;
  }

  /**
   * Formats the benchmark report as a human-readable summary string.
   *
   * @param report - The benchmark report to format
   * @returns A formatted string summary
   */
  formatReport(report: BenchmarkReport): string {
    const lines: string[] = [];

    lines.push('=== Noise Benchmark Report ===');
    lines.push(`Total combinations: ${report.totalCombinations}`);
    lines.push(`Completed: ${report.completedCombinations}`);
    lines.push('');

    lines.push('--- Results ---');
    for (const result of report.results) {
      lines.push(
        `  ${result.sequenceLength}bp | ${result.backend} | ${result.shots} shots | ` +
        `fidelity: ${result.fidelity.toFixed(3)} | gates: ${result.gateCount} | depth: ${result.circuitDepth}`
      );
    }
    lines.push('');

    lines.push('--- Recommendations ---');
    lines.push('Max reliable sequence length per backend (fidelity ≥ 0.7):');
    for (const [backend, maxLength] of Object.entries(report.recommendations)) {
      lines.push(`  ${backend}: ${maxLength} bases`);
    }

    if (report.totalCostEstimate && !report.totalCostEstimate.isFree) {
      lines.push('');
      lines.push(`Total estimated cost: $${report.totalCostEstimate.totalCost.toFixed(4)}`);
    }

    return lines.join('\n');
  }
}
