/**
 * Shared type interfaces and constants for the Quantum Genomics Toolkit.
 */

// ─── Extended Backend Types ──────────────────────────────────────────────────

export type ExtendedBackendId =
  | 'braket-local-simulator'
  | 'braket-sv1'
  | 'braket-dm1'
  | 'ionq-forte-enterprise'
  | 'rigetti-cepheus-1';

export interface ExtendedBackendConfig {
  id: ExtendedBackendId;
  name: string;
  provider: string;
  qubitCount: number;
  nativeGates: string[];
  connectivity: { type: string };
  costModel: 'free' | 'per-minute' | 'per-task-and-shot';
  costPerMinute?: number;
  costPerTask?: number;
  costPerShot?: number;
  isNoisy: boolean;
  region: string;
  deviceArn: string;
}

/**
 * All available extended backend configurations indexed by ExtendedBackendId.
 */
export const EXTENDED_BACKENDS: Record<ExtendedBackendId, ExtendedBackendConfig> = {
  'braket-local-simulator': {
    id: 'braket-local-simulator',
    name: 'Amazon Braket Local Simulator',
    provider: 'AWS',
    qubitCount: 34,
    nativeGates: ['*'],
    connectivity: { type: 'all-to-all' },
    costModel: 'free',
    isNoisy: false,
    region: 'local',
    deviceArn: 'local:braket/default',
  },
  'braket-sv1': {
    id: 'braket-sv1',
    name: 'Amazon Braket SV1',
    provider: 'AWS',
    qubitCount: 34,
    nativeGates: ['*'],
    connectivity: { type: 'all-to-all' },
    costModel: 'per-minute',
    costPerMinute: 0.075,
    isNoisy: false,
    region: 'us-east-1',
    deviceArn: 'arn:aws:braket:::device/quantum-simulator/amazon/sv1',
  },
  'braket-dm1': {
    id: 'braket-dm1',
    name: 'Amazon Braket DM1',
    provider: 'AWS',
    qubitCount: 17,
    nativeGates: ['*'],
    connectivity: { type: 'all-to-all' },
    costModel: 'per-minute',
    costPerMinute: 0.075,
    isNoisy: true,
    region: 'us-east-1',
    deviceArn: 'arn:aws:braket:::device/quantum-simulator/amazon/dm1',
  },
  'ionq-forte-enterprise': {
    id: 'ionq-forte-enterprise',
    name: 'IonQ Forte Enterprise',
    provider: 'IonQ',
    qubitCount: 36,
    nativeGates: ['GPi', 'GPi2', 'MS'],
    connectivity: { type: 'all-to-all' },
    costModel: 'per-task-and-shot',
    costPerTask: 0.30,
    costPerShot: 0.01,
    isNoisy: true,
    region: 'us-east-1',
    deviceArn: 'arn:aws:braket:us-east-1::device/qpu/ionq/Forte-Enterprise-1',
  },
  'rigetti-cepheus-1': {
    id: 'rigetti-cepheus-1',
    name: 'Rigetti Cepheus-1',
    provider: 'Rigetti',
    qubitCount: 108,
    nativeGates: ['RX', 'RZ', 'CZ'],
    connectivity: { type: 'grid' },
    costModel: 'per-task-and-shot',
    costPerTask: 0.30,
    costPerShot: 0.01,
    isNoisy: true,
    region: 'us-west-1',
    deviceArn: 'arn:aws:braket:us-west-1::device/qpu/rigetti/Cepheus-1-108Q',
  },
};

// ─── Qubit Requirement Types ─────────────────────────────────────────────────

export type OperationType = 'encode' | 'swap-test' | 'grover-search';

export interface QubitRequirement {
  operation: OperationType;
  formula: (sequenceLength: number) => number;
  supportsPartitioning: boolean;
}

/**
 * Per-operation qubit requirement formulas.
 * - encode: 2N qubits (2 qubits per nucleotide base)
 * - swap-test: 4N + 1 qubits (2N per sequence + 1 ancilla)
 * - grover-search: 2N + ⌈log₂N⌉ qubits (sequence + index register)
 */
export const QUBIT_REQUIREMENTS: Record<OperationType, QubitRequirement> = {
  encode: {
    operation: 'encode',
    formula: (N: number) => 2 * N,
    supportsPartitioning: true,
  },
  'swap-test': {
    operation: 'swap-test',
    formula: (N: number) => 4 * N + 1,
    supportsPartitioning: false,
  },
  'grover-search': {
    operation: 'grover-search',
    formula: (N: number) => 2 * N + Math.ceil(Math.log2(N)),
    supportsPartitioning: false,
  },
};

// ─── Error Types ─────────────────────────────────────────────────────────────

export interface ToolkitError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// ─── Cost Estimation Types ───────────────────────────────────────────────────

export interface CostEstimate {
  totalCost: number;
  breakdown: CostBreakdown;
  backend: ExtendedBackendId;
  isFree: boolean;
  estimatedExecutionTimeSeconds: number;
}

export interface CostBreakdown {
  taskCost: number;
  shotCost: number;
  simulatorTimeCost: number;
  totalShots: number;
  circuitCount: number;
}

export type CostableOperation = {
  backend: ExtendedBackendId;
  shots: number;
  circuitCount: number;
  estimatedCircuitDepth: number;
};
