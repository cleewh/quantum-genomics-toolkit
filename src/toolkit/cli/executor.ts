/**
 * Local Simulator Executor for the CLI.
 *
 * Simulates quantum circuit execution locally. For basis-state preparation
 * circuits (only X gates), the output is deterministic: each qubit is either
 * |0⟩ or |1⟩ based on whether an X gate was applied.
 */

import type { TranspiledCircuit, MeasurementResult } from '../../types/index.js';

export interface CircuitExecutor {
  execute(circuit: TranspiledCircuit, shots: number): Promise<MeasurementResult>;
}

/**
 * Local simulator executor that deterministically simulates basis-state circuits.
 */
export class LocalSimulatorExecutor implements CircuitExecutor {
  async execute(circuit: TranspiledCircuit, shots: number): Promise<MeasurementResult> {
    const qubitCount = circuit.originalCircuit.qubitCount;
    const qasm = circuit.originalCircuit.qasm;

    // For encoding circuits, determine the expected bitstring from X gates
    const bits = new Array(qubitCount).fill('0');
    const xGateRegex = /x q\[(\d+)\];/g;
    let match;
    while ((match = xGateRegex.exec(qasm)) !== null) {
      bits[parseInt(match[1], 10)] = '1';
    }
    const expectedBitstring = bits.join('');

    // In a noiseless simulation, all shots produce the same result
    return {
      bitstrings: { [expectedBitstring]: shots },
      totalShots: shots,
      backend: 'braket-local-simulator',
      jobId: `local-sim-${Date.now()}`,
    };
  }
}
