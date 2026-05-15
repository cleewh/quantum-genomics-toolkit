/**
 * Shared type interfaces and constants for the Quantum Genomics Encoding Pipeline.
 */

// ─── Nucleotide Types ────────────────────────────────────────────────────────

export type Nucleotide = 'A' | 'C' | 'G' | 'T' | 'U';

// ─── Backend Types ───────────────────────────────────────────────────────────

export type BackendId = 'ionq-forte-enterprise' | 'rigetti-cepheus-1' | 'braket-local-simulator';

// ─── Validation Types ────────────────────────────────────────────────────────

export interface ValidationError {
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
  sequenceLength: number;
  format: 'FASTA' | 'FASTQ' | 'GenBank';
}

// ─── Sequence Types ──────────────────────────────────────────────────────────

export interface ParsedSequence {
  id: string;
  description: string;
  nucleotides: string; // uppercase A, C, G, T/U characters
  length: number;
  type: 'DNA' | 'RNA';
  metadata: Record<string, string>;
}

// ─── Encoding Types ──────────────────────────────────────────────────────────

export interface EncodingScheme {
  name: string;
  qubitsPerBase: number;
  mapping: Record<Nucleotide, string>; // e.g., { A: '00', C: '01', G: '10', T: '11' }
}

export interface EncodedCircuit {
  qasm: string;           // OpenQASM 3.0 representation
  qubitCount: number;
  gateCount: number;
  depth: number;
  scheme: EncodingScheme;
  sourceSequenceId: string;
  segmentIndex?: number;  // if from partitioned genome
}

// ─── Backend Configuration ───────────────────────────────────────────────────

export interface QubitConnectivity {
  type: 'all-to-all' | 'grid' | 'ring' | 'custom';
  edges?: [number, number][]; // for custom topologies
}

export interface BackendConfig {
  id: BackendId;
  name: string;
  qubitCount: number;
  nativeGates: string[];
  connectivity: QubitConnectivity;
  provider: 'IonQ' | 'Rigetti' | 'AWS';
}

// ─── Transpilation Types ─────────────────────────────────────────────────────

export interface TranspiledCircuit {
  qasm: string;
  originalCircuit: EncodedCircuit;
  backend: BackendId;
  nativeGateCount: number;
  depth: number;
  swapCount: number; // routing overhead
}

// ─── Measurement and Decoding Types ──────────────────────────────────────────

export interface MeasurementResult {
  bitstrings: Record<string, number>; // bitstring → count
  totalShots: number;
  backend: BackendId;
  jobId: string;
}

export interface DecodedSequence {
  nucleotides: string;
  perBaseConfidence: number[];
  averageConfidence: number;
  lowConfidenceFlag: boolean; // true if avg < 0.7
}

// ─── Job Orchestration Types ─────────────────────────────────────────────────

export interface JobHandle {
  jobId: string;
  type: 'quantum';
}

export interface WorkflowHandle {
  workflowId: string;
  type: 'workflow';
}

export interface JobConfig {
  shots: number;          // 100–10000
  backend: BackendId;
  priority: 'normal' | 'high';
  maxRetries: number;     // default: 3
  timeoutMinutes: number;
}

export interface ExecutionStatus {
  state: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  progress?: number;
  startTime?: Date;
  endTime?: Date;
  failureReason?: string;
  retryCount: number;
}

// ─── Budget Analysis Types ────────────────────────────────────────────────────

export interface BudgetAnalysis {
  requiredQubits: number;
  backendFit: Record<BackendId, FitResult>;
  recommendation: 'direct' | 'compress' | 'partition';
}

export interface FitResult {
  fits: boolean;
  availableQubits: number;
  utilizationPercent: number;
}

export interface PartitionedGenome {
  segments: GenomeSegment[];
  originalLength: number;
  overlapSize: number;
  totalSegments: number;
}

export interface GenomeSegment {
  index: number;
  nucleotides: string;
  startPosition: number;
  endPosition: number;
  overlapWithNext: number;
}

// ─── Execution Metadata and Report Types ─────────────────────────────────────

export interface ExecutionMetadata {
  jobId: string;
  backend: BackendId;
  shots: number;
  encodingScheme: string;
  executionTimeMs?: number;
}

export interface Report {
  fasta: string;
  vcf?: string;
  confidence: number[];
  metadata: ExecutionMetadata;
  recommendations: string[];
}

// ─── Workflow Types ──────────────────────────────────────────────────────────

export interface WorkflowStep {
  id: string;
  type: 'quantum' | 'classical';
  config: JobConfig | Record<string, unknown>;
  inputS3Path?: string;
  outputS3Path: string;
}

export interface WorkflowDefinition {
  name: string;
  steps: WorkflowStep[];
  dependencies: [string, string][]; // DAG edges: [from, to]
}
