/**
 * Genome Analyzer for the Quantum Genomics Toolkit.
 *
 * Orchestrates single-genome encode/decode with confidence reporting:
 * FASTA validation → sequence parsing → qubit limit check → optional partitioning
 * → encoding → transpilation → execution → decoding → report generation.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7
 */

import type {
  ParsedSequence,
  EncodingScheme,
  EncodedCircuit,
  TranspiledCircuit,
  MeasurementResult,
  DecodedSequence,
  ExecutionMetadata,
  Report,
} from '../../types/index.js';
import { getDefaultEncodingScheme } from '../../types/encoding-schemes.js';
import { EncodingEngine } from '../../encoding/encoding-engine.js';
import { DefaultQubitBudgetAnalyzer } from '../../budget/qubit-budget-analyzer.js';
import { DefaultGenomeCompressor } from '../../budget/genome-compressor.js';
import { CircuitTranspiler } from '../../transpiler/circuit-transpiler.js';
import { ResultProcessor } from '../../results/result-processor.js';
import { FastaValidator } from '../validators/fasta-validator.js';
import { QubitLimitEnforcer } from '../qubit-limits.js';
import { CostEstimator } from '../cost-estimator/cost-estimator.js';
import {
  ExtendedBackendId,
  EXTENDED_BACKENDS,
  CostEstimate,
} from '../types.js';

// ─── Genome Analyzer Config ─────────────────────────────────────────────────

export interface GenomeAnalyzerConfig {
  backend: ExtendedBackendId;
  shots?: number;           // default: 1000
  scheme?: EncodingScheme;
  autoPartition?: boolean;  // default: true
}

// ─── Genome Analysis Result ──────────────────────────────────────────────────

export interface GenomeAnalysisResult {
  sequence: ParsedSequence;
  encodedCircuits: EncodedCircuit[];
  transpiledCircuits: TranspiledCircuit[];
  decoded: DecodedSequence;
  report: Report;
  backend: ExtendedBackendId;
  partitioned: boolean;
  segmentCount: number;
  costEstimate?: CostEstimate;
}

// ─── Circuit Executor Interface ──────────────────────────────────────────────

export interface CircuitExecutor {
  execute(circuit: TranspiledCircuit, shots: number): Promise<MeasurementResult>;
}

// ─── Genome Analyzer ─────────────────────────────────────────────────────────

export class GenomeAnalyzer {
  private fastaValidator: FastaValidator;
  private qubitLimitEnforcer: QubitLimitEnforcer;
  private encoder: EncodingEngine;
  private budgetAnalyzer: DefaultQubitBudgetAnalyzer;
  private compressor: DefaultGenomeCompressor;
  private transpiler: CircuitTranspiler;
  private resultProcessor: ResultProcessor;
  private costEstimator: CostEstimator;
  private executor: CircuitExecutor;

  constructor(executor: CircuitExecutor) {
    this.fastaValidator = new FastaValidator();
    this.qubitLimitEnforcer = new QubitLimitEnforcer();
    this.encoder = new EncodingEngine();
    this.budgetAnalyzer = new DefaultQubitBudgetAnalyzer();
    this.compressor = new DefaultGenomeCompressor();
    this.transpiler = new CircuitTranspiler();
    this.resultProcessor = new ResultProcessor();
    this.costEstimator = new CostEstimator();
    this.executor = executor;
  }

  /**
   * Analyzes a genome from FASTA content through the full quantum pipeline.
   *
   * @param fastaContent - The FASTA file content as a string
   * @param filename - The filename (used for extension validation)
   * @param config - Configuration specifying backend, shots, scheme, and partitioning
   * @returns A GenomeAnalysisResult with decoded sequence, confidence, and metadata
   */
  async analyze(
    fastaContent: string,
    filename: string,
    config: GenomeAnalyzerConfig
  ): Promise<GenomeAnalysisResult> {
    const shots = config.shots ?? 1000;
    const autoPartition = config.autoPartition ?? true;
    const backend = config.backend;

    // 1. Validate FASTA file
    const validationResult = this.fastaValidator.validate(filename, fastaContent);
    if (!validationResult.valid) {
      const errorMessages = validationResult.errors.map(e => e.message).join('; ');
      throw new Error(`FASTA validation failed: ${errorMessages}`);
    }

    const sequence = validationResult.sequence!;

    // 2. Determine encoding scheme
    const scheme = config.scheme ?? getDefaultEncodingScheme(sequence.type);

    // 3. Check qubit limits
    const backendConfig = EXTENDED_BACKENDS[backend];
    const maxSequenceLength = this.qubitLimitEnforcer.getMaxSequenceLength('encode', backend);
    const needsPartitioning = sequence.length > maxSequenceLength;

    if (needsPartitioning && !autoPartition) {
      throw new Error(
        `Sequence length (${sequence.length} bases) exceeds the maximum allowed for backend '${backend}' ` +
        `(max: ${maxSequenceLength} bases). Enable autoPartition or use a backend with more qubits.`
      );
    }

    // 4. Encode (with partitioning if needed)
    let encodedCircuits: EncodedCircuit[];
    let partitioned = false;

    // Only pass scheme to encoder if user explicitly provided one (non-default).
    // The encoder's internal default handles T/U compatibility without triggering
    // duplicate-mapping validation.
    const encoderScheme = config.scheme ?? undefined;

    if (!needsPartitioning) {
      // Direct encoding — genome fits
      const circuit = await this.encoder.encode(sequence, encoderScheme);
      encodedCircuits = [circuit];
    } else {
      // Partition the genome
      partitioned = true;
      const partitions = this.compressor.partition(
        sequence,
        backendConfig.qubitCount,
        scheme
      );
      encodedCircuits = [];
      for (const segment of partitions.segments) {
        const segSequence: ParsedSequence = {
          id: `${sequence.id}_seg${segment.index}`,
          description: `Segment ${segment.index} of ${sequence.id}`,
          nucleotides: segment.nucleotides,
          length: segment.nucleotides.length,
          type: sequence.type,
          metadata: { ...sequence.metadata, segmentIndex: String(segment.index) },
        };
        const circuit = await this.encoder.encode(segSequence, encoderScheme);
        encodedCircuits.push({ ...circuit, segmentIndex: segment.index });
      }
    }

    // 5. Estimate cost
    const totalDepth = encodedCircuits.reduce((sum, c) => sum + c.depth, 0);
    const costEstimate = this.costEstimator.estimate({
      backend,
      shots,
      circuitCount: encodedCircuits.length,
      estimatedCircuitDepth: totalDepth > 0 ? totalDepth : 1,
    });

    // 6. Transpile all circuits
    const transpiledCircuits: TranspiledCircuit[] = [];
    for (const circuit of encodedCircuits) {
      const transpiled = await this.transpiler.transpile(circuit, backendConfig as any);
      transpiledCircuits.push(transpiled);
    }

    // 7. Execute all circuits
    const measurements: MeasurementResult[] = [];
    for (const transpiled of transpiledCircuits) {
      const result = await this.executor.execute(transpiled, shots);
      measurements.push(result);
    }

    // 8. Decode results
    let decoded: DecodedSequence;
    if (measurements.length === 1) {
      decoded = this.resultProcessor.decode(measurements[0], scheme);
    } else {
      // Use the compressor's overlap size for proper reassembly
      const overlapBases = 10; // default overlap from GenomeCompressor
      decoded = this.mergeDecodedSegments(measurements, scheme, overlapBases);
    }

    // 9. Generate report
    const metadata: ExecutionMetadata = {
      jobId: `genome-analyzer-${Date.now()}`,
      backend: backend as any,
      shots,
      encodingScheme: scheme.name,
    };
    const report = this.resultProcessor.generateReport(decoded, metadata);

    return {
      sequence,
      encodedCircuits,
      transpiledCircuits,
      decoded,
      report,
      backend,
      partitioned,
      segmentCount: encodedCircuits.length,
      costEstimate,
    };
  }

  /**
   * Merges decoded segments from partitioned genome execution.
   * Strips the overlap from each segment (except the first) to reconstruct
   * the original sequence without duplication.
   */
  private mergeDecodedSegments(
    measurements: MeasurementResult[],
    scheme: EncodingScheme,
    overlapBases: number
  ): DecodedSequence {
    const decodedSegments = measurements.map(m => this.resultProcessor.decode(m, scheme));

    // Take the first segment fully, then skip overlap for subsequent segments
    let mergedNucleotides = decodedSegments[0].nucleotides;
    let mergedConfidence = [...decodedSegments[0].perBaseConfidence];

    for (let i = 1; i < decodedSegments.length; i++) {
      const segment = decodedSegments[i];
      // Skip the first `overlapBases` characters (they duplicate the end of the previous segment)
      mergedNucleotides += segment.nucleotides.slice(overlapBases);
      mergedConfidence.push(...segment.perBaseConfidence.slice(overlapBases));
    }

    const averageConfidence = mergedConfidence.length > 0
      ? mergedConfidence.reduce((sum, c) => sum + c, 0) / mergedConfidence.length
      : 0;

    return {
      nucleotides: mergedNucleotides,
      perBaseConfidence: mergedConfidence,
      averageConfidence,
      lowConfidenceFlag: averageConfidence < 0.7,
    };
  }
}
