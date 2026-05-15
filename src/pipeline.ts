/**
 * End-to-end Quantum Genomics Encoding Pipeline.
 *
 * Orchestrates the full flow:
 * upload → validate → budget analysis → encode → transpile → execute → decode → report
 *
 * Handles the compression/partitioning branch when genome exceeds backend capacity.
 *
 * Requirements: 1.1–1.5, 2.1–2.5, 3.1–3.5, 4.1–4.5, 5.1–5.5, 7.1–7.5
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
  BackendId,
  JobConfig,
  BackendConfig,
} from './types/index.js';
import { getDefaultEncodingScheme } from './types/encoding-schemes.js';
import { BACKENDS } from './types/backends.js';
import { SequenceValidatorImpl, type UploadedFile } from './validators/sequence-validator.js';
import { EncodingEngine } from './encoding/encoding-engine.js';
import { DefaultQubitBudgetAnalyzer } from './budget/qubit-budget-analyzer.js';
import { DefaultGenomeCompressor } from './budget/genome-compressor.js';
import { CircuitTranspiler } from './transpiler/circuit-transpiler.js';
import { ResultProcessor } from './results/result-processor.js';
import { BackendSelector, type BackendState } from './orchestrator/backend-selector.js';

// ─── Pipeline Configuration ──────────────────────────────────────────────────

export interface PipelineConfig {
  defaultBackend?: BackendId;
  defaultShots?: number;
  encodingScheme?: EncodingScheme;
  backendStates?: BackendState[];
}

// ─── Pipeline Result ─────────────────────────────────────────────────────────

export interface PipelineResult {
  sequence: ParsedSequence;
  encodedCircuits: EncodedCircuit[];
  transpiledCircuits: TranspiledCircuit[];
  decoded: DecodedSequence;
  report: Report;
  backend: BackendId;
  partitioned: boolean;
  segmentCount: number;
}

// ─── Pipeline Executor Interface ─────────────────────────────────────────────

export interface CircuitExecutor {
  execute(circuit: TranspiledCircuit, shots: number): Promise<MeasurementResult>;
}

// ─── Pipeline Class ──────────────────────────────────────────────────────────

export class QuantumGenomicsPipeline {
  private validator: SequenceValidatorImpl;
  private encoder: EncodingEngine;
  private budgetAnalyzer: DefaultQubitBudgetAnalyzer;
  private compressor: DefaultGenomeCompressor;
  private transpiler: CircuitTranspiler;
  private resultProcessor: ResultProcessor;
  private backendSelector: BackendSelector;
  private executor: CircuitExecutor;
  private config: PipelineConfig;

  constructor(executor: CircuitExecutor, config?: PipelineConfig) {
    this.validator = new SequenceValidatorImpl();
    this.encoder = new EncodingEngine();
    this.budgetAnalyzer = new DefaultQubitBudgetAnalyzer();
    this.compressor = new DefaultGenomeCompressor();
    this.transpiler = new CircuitTranspiler();
    this.resultProcessor = new ResultProcessor();
    this.backendSelector = new BackendSelector(config?.backendStates);
    this.executor = executor;
    this.config = config ?? {};
  }

  /**
   * Runs the full pipeline: file → validate → encode → transpile → execute → decode → report.
   */
  async run(file: UploadedFile, options?: { backend?: BackendId; shots?: number; scheme?: EncodingScheme }): Promise<PipelineResult> {
    // 1. Validate and parse
    const validationResult = await this.validator.validate(file);
    if (!validationResult.valid) {
      throw new Error(`Validation failed: ${validationResult.errors.map((e) => e.message).join('; ')}`);
    }
    const sequence = await this.validator.parse(file);

    // 2. Determine encoding scheme
    const scheme = options?.scheme ?? this.config.encodingScheme ?? getDefaultEncodingScheme(sequence.type);

    // 3. Budget analysis
    const budget = this.budgetAnalyzer.analyze(sequence, scheme);

    // 4. Select backend
    const backendId = options?.backend ?? this.config.defaultBackend ?? this.selectBackend(budget.requiredQubits);
    const backendConfig = BACKENDS[backendId];

    // 5. Encode (with partitioning if needed)
    let encodedCircuits: EncodedCircuit[];
    let partitioned = false;

    if (budget.backendFit[backendId]?.fits) {
      // Direct encoding — genome fits
      const circuit = await this.encoder.encode(sequence, options?.scheme);
      encodedCircuits = [circuit];
    } else {
      // Partition the genome
      partitioned = true;
      const partitions = this.compressor.partition(sequence, backendConfig.qubitCount, scheme);
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
        const circuit = await this.encoder.encode(segSequence, options?.scheme);
        encodedCircuits.push({ ...circuit, segmentIndex: segment.index });
      }
    }

    // 6. Transpile all circuits
    const transpiledCircuits: TranspiledCircuit[] = [];
    for (const circuit of encodedCircuits) {
      const transpiled = await this.transpiler.transpile(circuit, backendConfig);
      transpiledCircuits.push(transpiled);
    }

    // 7. Execute all circuits
    const shots = options?.shots ?? this.config.defaultShots ?? 1000;
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
      // Merge decoded segments
      decoded = this.mergeDecodedSegments(measurements, scheme);
    }

    // 9. Generate report
    const metadata: ExecutionMetadata = {
      jobId: `pipeline-${Date.now()}`,
      backend: backendId,
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
      backend: backendId,
      partitioned,
      segmentCount: encodedCircuits.length,
    };
  }

  /**
   * Selects the best backend based on qubit requirements.
   */
  private selectBackend(requiredQubits: number): BackendId {
    const recommendation = this.backendSelector.recommendBackend(requiredQubits);
    if (recommendation) {
      return recommendation.recommended;
    }
    // Fallback to local simulator
    return 'braket-local-simulator';
  }

  /**
   * Merges decoded segments from partitioned genome execution.
   */
  private mergeDecodedSegments(measurements: MeasurementResult[], scheme: EncodingScheme): DecodedSequence {
    const decodedSegments = measurements.map((m) => this.resultProcessor.decode(m, scheme));

    // Concatenate nucleotides (overlap handling would need partition metadata)
    const allNucleotides = decodedSegments.map((d) => d.nucleotides).join('');
    const allConfidence = decodedSegments.flatMap((d) => d.perBaseConfidence);
    const averageConfidence = allConfidence.length > 0
      ? allConfidence.reduce((sum, c) => sum + c, 0) / allConfidence.length
      : 0;

    return {
      nucleotides: allNucleotides,
      perBaseConfidence: allConfidence,
      averageConfidence,
      lowConfidenceFlag: averageConfidence < 0.7,
    };
  }
}
