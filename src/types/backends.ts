/**
 * Backend configuration constants for supported quantum hardware targets.
 */

import { BackendConfig } from './index.js';

export const IONQ_FORTE_ENTERPRISE: BackendConfig = {
  id: 'ionq-forte-enterprise',
  name: 'IonQ Forte Enterprise',
  provider: 'IonQ',
  qubitCount: 36,
  nativeGates: ['GPi', 'GPi2', 'MS'],
  connectivity: { type: 'all-to-all' },
};

export const RIGETTI_CEPHEUS_1: BackendConfig = {
  id: 'rigetti-cepheus-1',
  name: 'Rigetti Cepheus-1',
  provider: 'Rigetti',
  qubitCount: 108,
  nativeGates: ['RX', 'RZ', 'CZ'],
  connectivity: { type: 'grid' },
};

export const BRAKET_LOCAL_SIMULATOR: BackendConfig = {
  id: 'braket-local-simulator',
  name: 'Amazon Braket Local Simulator',
  provider: 'AWS',
  qubitCount: 34,
  nativeGates: ['*'],
  connectivity: { type: 'all-to-all' },
};

/**
 * All available backend configurations indexed by BackendId.
 */
export const BACKENDS: Record<string, BackendConfig> = {
  'ionq-forte-enterprise': IONQ_FORTE_ENTERPRISE,
  'rigetti-cepheus-1': RIGETTI_CEPHEUS_1,
  'braket-local-simulator': BRAKET_LOCAL_SIMULATOR,
};

/**
 * Maximum sequence length (in nucleotides) each backend can encode
 * with the default 2-qubit-per-base scheme.
 */
export const MAX_SEQUENCE_LENGTH: Record<string, number> = {
  'ionq-forte-enterprise': 18,   // 36 qubits / 2 qubits per base
  'rigetti-cepheus-1': 54,       // 108 qubits / 2 qubits per base
  'braket-local-simulator': 17,  // 34 qubits / 2 qubits per base
};

/**
 * Braket device ARNs for each backend.
 */
export const BACKEND_ARNS: Record<string, string> = {
  'ionq-forte-enterprise': 'arn:aws:braket:us-east-1::device/qpu/ionq/Forte-Enterprise',
  'rigetti-cepheus-1': 'arn:aws:braket:us-west-1::device/qpu/rigetti/Cepheus-1-108Q',
  'braket-local-simulator': 'local:braket/default',
};
