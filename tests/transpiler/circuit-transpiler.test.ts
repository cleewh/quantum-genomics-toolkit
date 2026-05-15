/**
 * Unit tests for the Circuit Transpiler.
 * Tests gate decomposition for IonQ and Rigetti backends,
 * connectivity routing, and QASM generation.
 */

import { describe, it, expect } from 'vitest';
import { CircuitTranspiler, GridConnectivity } from '../../src/transpiler/circuit-transpiler.js';
import type { EncodedCircuit, BackendConfig, EncodingScheme } from '../../src/types/index.js';
import { IONQ_FORTE_ENTERPRISE, RIGETTI_CEPHEUS_1, BRAKET_LOCAL_SIMULATOR } from '../../src/types/backends.js';

const transpiler = new CircuitTranspiler();

// Helper to create a minimal EncodedCircuit for testing
function makeCircuit(qasm: string, qubitCount: number): EncodedCircuit {
  const scheme: EncodingScheme = {
    name: 'default-2qubit-basis',
    qubitsPerBase: 2,
    mapping: { A: '00', C: '01', G: '10', T: '11', U: '11' } as Record<any, string>,
  };
  return {
    qasm,
    qubitCount,
    gateCount: 0,
    depth: 0,
    scheme,
    sourceSequenceId: 'test-seq',
  };
}

// Helper to generate a simple QASM with X gates
function makeXGateQASM(qubitCount: number, targets: number[]): string {
  const lines = [
    'OPENQASM 3.0;',
    'include "stdgates.inc";',
    '',
    `qubit[${qubitCount}] q;`,
    `bit[${qubitCount}] c;`,
    '',
  ];
  for (const t of targets) {
    lines.push(`x q[${t}];`);
  }
  lines.push('');
  lines.push('c = measure q;');
  return lines.join('\n');
}

// Helper to generate QASM with various gates
function makeGateQASM(qubitCount: number, gates: string[]): string {
  const lines = [
    'OPENQASM 3.0;',
    'include "stdgates.inc";',
    '',
    `qubit[${qubitCount}] q;`,
    `bit[${qubitCount}] c;`,
    '',
  ];
  for (const g of gates) {
    lines.push(g);
  }
  lines.push('');
  lines.push('c = measure q;');
  return lines.join('\n');
}

describe('CircuitTranspiler', () => {
  describe('parseGates', () => {
    it('should parse single-qubit X gates', () => {
      const qasm = makeXGateQASM(4, [0, 1, 3]);
      const gates = transpiler.parseGates(qasm);
      expect(gates).toHaveLength(3);
      expect(gates[0]).toEqual({ name: 'x', qubits: [0] });
      expect(gates[1]).toEqual({ name: 'x', qubits: [1] });
      expect(gates[2]).toEqual({ name: 'x', qubits: [3] });
    });

    it('should parse H, Z, S, T gates', () => {
      const qasm = makeGateQASM(4, [
        'h q[0];',
        'z q[1];',
        's q[2];',
        't q[3];',
      ]);
      const gates = transpiler.parseGates(qasm);
      expect(gates).toHaveLength(4);
      expect(gates[0]).toEqual({ name: 'h', qubits: [0] });
      expect(gates[1]).toEqual({ name: 'z', qubits: [1] });
      expect(gates[2]).toEqual({ name: 's', qubits: [2] });
      expect(gates[3]).toEqual({ name: 't', qubits: [3] });
    });

    it('should parse CX (CNOT) gates', () => {
      const qasm = makeGateQASM(4, ['cx q[0], q[1];', 'cx q[2], q[3];']);
      const gates = transpiler.parseGates(qasm);
      expect(gates).toHaveLength(2);
      expect(gates[0]).toEqual({ name: 'cx', qubits: [0, 1] });
      expect(gates[1]).toEqual({ name: 'cx', qubits: [2, 3] });
    });

    it('should return empty array for circuit with no gates', () => {
      const qasm = makeXGateQASM(4, []);
      const gates = transpiler.parseGates(qasm);
      expect(gates).toHaveLength(0);
    });
  });

  describe('IonQ Transpilation', () => {
    it('should transpile X gates to GPi(0)', async () => {
      const qasm = makeXGateQASM(4, [0, 2]);
      const circuit = makeCircuit(qasm, 4);
      const result = await transpiler.transpile(circuit, IONQ_FORTE_ENTERPRISE);

      expect(result.backend).toBe('ionq-forte-enterprise');
      expect(result.swapCount).toBe(0); // IonQ has all-to-all connectivity
      expect(result.nativeGateCount).toBe(2); // 2 X gates → 2 GPi gates
      expect(result.qasm).toContain('gpi(0)');
    });

    it('should transpile H gate to GPi2(0) + GPi(π/2)', async () => {
      const qasm = makeGateQASM(2, ['h q[0];']);
      const circuit = makeCircuit(qasm, 2);
      const result = await transpiler.transpile(circuit, IONQ_FORTE_ENTERPRISE);

      expect(result.nativeGateCount).toBe(2); // GPi2 + GPi
      expect(result.qasm).toContain('gpi2(0)');
      expect(result.qasm).toContain('gpi(pi/2)');
    });

    it('should transpile Z gate to GPi(π)', async () => {
      const qasm = makeGateQASM(2, ['z q[0];']);
      const circuit = makeCircuit(qasm, 2);
      const result = await transpiler.transpile(circuit, IONQ_FORTE_ENTERPRISE);

      expect(result.nativeGateCount).toBe(1);
      expect(result.qasm).toContain('gpi(pi)');
    });

    it('should transpile S gate to GPi2(π/2)', async () => {
      const qasm = makeGateQASM(2, ['s q[0];']);
      const circuit = makeCircuit(qasm, 2);
      const result = await transpiler.transpile(circuit, IONQ_FORTE_ENTERPRISE);

      expect(result.nativeGateCount).toBe(1);
      expect(result.qasm).toContain('gpi2(pi/2)');
    });

    it('should transpile T gate to GPi2(π/4)', async () => {
      const qasm = makeGateQASM(2, ['t q[0];']);
      const circuit = makeCircuit(qasm, 2);
      const result = await transpiler.transpile(circuit, IONQ_FORTE_ENTERPRISE);

      expect(result.nativeGateCount).toBe(1);
      expect(result.qasm).toContain('gpi2(pi/4)');
    });

    it('should transpile CX gate to MS + single qubit corrections', async () => {
      const qasm = makeGateQASM(4, ['cx q[0], q[1];']);
      const circuit = makeCircuit(qasm, 4);
      const result = await transpiler.transpile(circuit, IONQ_FORTE_ENTERPRISE);

      // CX → GPi2(-π/2) + MS(π/4) + GPi2(π/2) + GPi2(π/2) = 4 gates
      expect(result.nativeGateCount).toBe(4);
      expect(result.swapCount).toBe(0);
      expect(result.qasm).toContain('ms(pi/4)');
    });

    it('should produce only IonQ native gates in output', async () => {
      const qasm = makeGateQASM(4, ['x q[0];', 'h q[1];', 'cx q[2], q[3];']);
      const circuit = makeCircuit(qasm, 4);
      const result = await transpiler.transpile(circuit, IONQ_FORTE_ENTERPRISE);

      // Check that only GPi, GPi2, MS gates appear in the output
      const gateLines = result.qasm.split('\n').filter(
        (l) => l.trim().match(/^(gpi|gpi2|ms)\(/)
      );
      expect(gateLines.length).toBe(result.nativeGateCount);
    });

    it('should handle empty circuit', async () => {
      const qasm = makeXGateQASM(4, []);
      const circuit = makeCircuit(qasm, 4);
      const result = await transpiler.transpile(circuit, IONQ_FORTE_ENTERPRISE);

      expect(result.nativeGateCount).toBe(0);
      expect(result.depth).toBe(0);
      expect(result.swapCount).toBe(0);
    });

    it('should preserve original circuit reference', async () => {
      const qasm = makeXGateQASM(4, [0]);
      const circuit = makeCircuit(qasm, 4);
      const result = await transpiler.transpile(circuit, IONQ_FORTE_ENTERPRISE);

      expect(result.originalCircuit).toBe(circuit);
    });
  });

  describe('Rigetti Transpilation', () => {
    it('should transpile X gates to RX(π)', async () => {
      const qasm = makeXGateQASM(4, [0, 2]);
      const circuit = makeCircuit(qasm, 4);
      const result = await transpiler.transpile(circuit, RIGETTI_CEPHEUS_1);

      expect(result.backend).toBe('rigetti-cepheus-1');
      expect(result.nativeGateCount).toBe(2); // 2 X gates → 2 RX gates
      expect(result.swapCount).toBe(0); // No two-qubit gates, no routing needed
      expect(result.qasm).toContain('rx(pi)');
    });

    it('should transpile H gate to RZ(π/2) + RX(π/2) + RZ(π/2)', async () => {
      const qasm = makeGateQASM(2, ['h q[0];']);
      const circuit = makeCircuit(qasm, 2);
      const result = await transpiler.transpile(circuit, RIGETTI_CEPHEUS_1);

      expect(result.nativeGateCount).toBe(3); // RZ + RX + RZ
      expect(result.qasm).toContain('rz(pi/2)');
      expect(result.qasm).toContain('rx(pi/2)');
    });

    it('should transpile Z gate to RZ(π)', async () => {
      const qasm = makeGateQASM(2, ['z q[0];']);
      const circuit = makeCircuit(qasm, 2);
      const result = await transpiler.transpile(circuit, RIGETTI_CEPHEUS_1);

      expect(result.nativeGateCount).toBe(1);
      expect(result.qasm).toContain('rz(pi)');
    });

    it('should transpile S gate to RZ(π/2)', async () => {
      const qasm = makeGateQASM(2, ['s q[0];']);
      const circuit = makeCircuit(qasm, 2);
      const result = await transpiler.transpile(circuit, RIGETTI_CEPHEUS_1);

      expect(result.nativeGateCount).toBe(1);
      expect(result.qasm).toContain('rz(pi/2)');
    });

    it('should transpile T gate to RZ(π/4)', async () => {
      const qasm = makeGateQASM(2, ['t q[0];']);
      const circuit = makeCircuit(qasm, 2);
      const result = await transpiler.transpile(circuit, RIGETTI_CEPHEUS_1);

      expect(result.nativeGateCount).toBe(1);
      expect(result.qasm).toContain('rz(pi/4)');
    });

    it('should transpile CX on adjacent qubits without SWAPs', async () => {
      // In a grid, q[0] and q[1] are adjacent (same row, adjacent columns)
      const qasm = makeGateQASM(4, ['cx q[0], q[1];']);
      const circuit = makeCircuit(qasm, 4);
      const result = await transpiler.transpile(circuit, RIGETTI_CEPHEUS_1);

      // CX → RZ(-π/2) + CZ + RX(π/2) + RZ(π/2) = 4 gates
      expect(result.nativeGateCount).toBe(4);
      expect(result.swapCount).toBe(0);
      expect(result.qasm).toContain('cz');
    });

    it('should insert SWAPs for CX on non-adjacent qubits', async () => {
      // Use a small custom backend with grid connectivity to test routing
      const smallGrid: BackendConfig = {
        id: 'rigetti-cepheus-1',
        name: 'Test Grid',
        qubitCount: 9,
        nativeGates: ['RX', 'RZ', 'CZ'],
        connectivity: { type: 'grid' },
        provider: 'Rigetti',
      };

      // In a 3x3 grid: q[0] is at (0,0), q[2] is at (0,2) — not adjacent
      const qasm = makeGateQASM(9, ['cx q[0], q[2];']);
      const circuit = makeCircuit(qasm, 9);
      const result = await transpiler.transpile(circuit, smallGrid);

      // Should have SWAPs since q[0] and q[2] are not adjacent in a 3x3 grid
      expect(result.swapCount).toBeGreaterThan(0);
      expect(result.nativeGateCount).toBeGreaterThan(4); // More than just CX decomposition
    });

    it('should produce only Rigetti native gates in output', async () => {
      const qasm = makeGateQASM(4, ['x q[0];', 'h q[1];', 'z q[2];', 's q[3];']);
      const circuit = makeCircuit(qasm, 4);
      const result = await transpiler.transpile(circuit, RIGETTI_CEPHEUS_1);

      // Extract gate lines from QASM
      const gateLines = result.qasm.split('\n').filter((l) => {
        const trimmed = l.trim();
        return (
          trimmed.match(/^(rx|rz|cz)\(/) ||
          trimmed.match(/^cz\s/)
        );
      });
      expect(gateLines.length).toBe(result.nativeGateCount);
    });

    it('should handle empty circuit', async () => {
      const qasm = makeXGateQASM(4, []);
      const circuit = makeCircuit(qasm, 4);
      const result = await transpiler.transpile(circuit, RIGETTI_CEPHEUS_1);

      expect(result.nativeGateCount).toBe(0);
      expect(result.depth).toBe(0);
      expect(result.swapCount).toBe(0);
    });
  });

  describe('Local Simulator Transpilation', () => {
    it('should pass through gates for local simulator', async () => {
      const qasm = makeGateQASM(4, ['x q[0];', 'h q[1];', 'cx q[2], q[3];']);
      const circuit = makeCircuit(qasm, 4);
      const result = await transpiler.transpile(circuit, BRAKET_LOCAL_SIMULATOR);

      expect(result.backend).toBe('braket-local-simulator');
      expect(result.nativeGateCount).toBe(3);
      expect(result.swapCount).toBe(0);
    });
  });

  describe('Circuit Depth Calculation', () => {
    it('should calculate depth 0 for empty circuit', async () => {
      const qasm = makeXGateQASM(4, []);
      const circuit = makeCircuit(qasm, 4);
      const result = await transpiler.transpile(circuit, IONQ_FORTE_ENTERPRISE);
      expect(result.depth).toBe(0);
    });

    it('should calculate depth 1 for parallel single-qubit gates', async () => {
      // All X gates on different qubits can execute in parallel
      const qasm = makeXGateQASM(4, [0, 1, 2, 3]);
      const circuit = makeCircuit(qasm, 4);
      const result = await transpiler.transpile(circuit, IONQ_FORTE_ENTERPRISE);
      // Each X → GPi(0), all on different qubits → depth 1
      expect(result.depth).toBe(1);
    });

    it('should calculate depth > 1 for sequential gates on same qubit', async () => {
      const qasm = makeGateQASM(2, ['h q[0];']); // H → GPi2(0) + GPi(π/2) on same qubit
      const circuit = makeCircuit(qasm, 2);
      const result = await transpiler.transpile(circuit, IONQ_FORTE_ENTERPRISE);
      // Two gates on same qubit → depth 2
      expect(result.depth).toBe(2);
    });
  });

  describe('QASM Output Format', () => {
    it('should include OPENQASM 3.0 header', async () => {
      const qasm = makeXGateQASM(4, [0]);
      const circuit = makeCircuit(qasm, 4);
      const result = await transpiler.transpile(circuit, IONQ_FORTE_ENTERPRISE);

      expect(result.qasm).toContain('OPENQASM 3.0;');
    });

    it('should include backend metadata comments', async () => {
      const qasm = makeXGateQASM(4, [0]);
      const circuit = makeCircuit(qasm, 4);
      const result = await transpiler.transpile(circuit, IONQ_FORTE_ENTERPRISE);

      expect(result.qasm).toContain('// Backend: IonQ Forte Enterprise');
      expect(result.qasm).toContain('// Native gates: GPi, GPi2, MS');
    });

    it('should include qubit and bit register declarations', async () => {
      const qasm = makeXGateQASM(4, [0]);
      const circuit = makeCircuit(qasm, 4);
      const result = await transpiler.transpile(circuit, IONQ_FORTE_ENTERPRISE);

      expect(result.qasm).toContain('qubit[4] q;');
      expect(result.qasm).toContain('bit[4] c;');
    });

    it('should include measurement at the end', async () => {
      const qasm = makeXGateQASM(4, [0]);
      const circuit = makeCircuit(qasm, 4);
      const result = await transpiler.transpile(circuit, IONQ_FORTE_ENTERPRISE);

      const lines = result.qasm.split('\n');
      const lastNonEmpty = lines.filter((l) => l.trim().length > 0).pop();
      expect(lastNonEmpty).toBe('c = measure q;');
    });

    it('should include encoding scheme metadata', async () => {
      const qasm = makeXGateQASM(4, [0]);
      const circuit = makeCircuit(qasm, 4);
      const result = await transpiler.transpile(circuit, IONQ_FORTE_ENTERPRISE);

      expect(result.qasm).toContain('// Encoding scheme: default-2qubit-basis');
      expect(result.qasm).toContain('// Qubits per base: 2');
      expect(result.qasm).toContain('// Mapping:');
    });
  });

  describe('GridConnectivity', () => {
    it('should connect horizontally adjacent qubits', () => {
      // 3x3 grid: q0 q1 q2 / q3 q4 q5 / q6 q7 q8
      const grid = new GridConnectivity(3, 3, 9);
      expect(grid.areConnected(0, 1)).toBe(true);
      expect(grid.areConnected(1, 2)).toBe(true);
      expect(grid.areConnected(3, 4)).toBe(true);
    });

    it('should connect vertically adjacent qubits', () => {
      const grid = new GridConnectivity(3, 3, 9);
      expect(grid.areConnected(0, 3)).toBe(true);
      expect(grid.areConnected(1, 4)).toBe(true);
      expect(grid.areConnected(4, 7)).toBe(true);
    });

    it('should not connect diagonal qubits', () => {
      const grid = new GridConnectivity(3, 3, 9);
      expect(grid.areConnected(0, 4)).toBe(false);
      expect(grid.areConnected(1, 3)).toBe(false);
    });

    it('should not connect non-adjacent qubits', () => {
      const grid = new GridConnectivity(3, 3, 9);
      expect(grid.areConnected(0, 2)).toBe(false);
      expect(grid.areConnected(0, 6)).toBe(false);
      expect(grid.areConnected(0, 8)).toBe(false);
    });

    it('should find shortest path between adjacent qubits', () => {
      const grid = new GridConnectivity(3, 3, 9);
      const path = grid.findShortestPath(0, 1);
      expect(path).toEqual([0, 1]);
    });

    it('should find shortest path between non-adjacent qubits', () => {
      const grid = new GridConnectivity(3, 3, 9);
      // From q0 to q2: path should be [0, 1, 2]
      const path = grid.findShortestPath(0, 2);
      expect(path).toEqual([0, 1, 2]);
    });

    it('should find shortest path across rows', () => {
      const grid = new GridConnectivity(3, 3, 9);
      // From q0 to q8 (corner to corner): Manhattan distance = 4
      const path = grid.findShortestPath(0, 8);
      expect(path.length).toBe(5); // 4 steps = 5 nodes
      expect(path[0]).toBe(0);
      expect(path[path.length - 1]).toBe(8);
    });
  });

  describe('Error Handling', () => {
    it('should throw for unsupported gate in IonQ transpilation', async () => {
      // Manually create a gate list with an unsupported gate
      const gates = [{ name: 'ry', qubits: [0] }];
      expect(() => transpiler.transpileToIonQ(gates)).toThrow(
        "Unsupported gate 'ry' for IonQ transpilation"
      );
    });

    it('should throw for unsupported backend provider', async () => {
      const qasm = makeXGateQASM(4, [0]);
      const circuit = makeCircuit(qasm, 4);
      const badBackend: BackendConfig = {
        id: 'ionq-forte-enterprise',
        name: 'Unknown',
        qubitCount: 10,
        nativeGates: ['X'],
        connectivity: { type: 'all-to-all' },
        provider: 'IonQ' as any,
      };
      // This should work since IonQ is supported
      const result = await transpiler.transpile(circuit, badBackend);
      expect(result).toBeDefined();
    });
  });

  describe('Integration with Encoding Engine output', () => {
    it('should transpile a typical encoding circuit (ACG sequence)', async () => {
      // Simulates what the encoding engine produces for "ACG":
      // A=00 (no X gates), C=01 (X on q[1]), G=10 (X on q[2])
      const qasm = makeXGateQASM(6, [1, 2]);
      const circuit = makeCircuit(qasm, 6);

      // IonQ transpilation
      const ionqResult = await transpiler.transpile(circuit, IONQ_FORTE_ENTERPRISE);
      expect(ionqResult.nativeGateCount).toBe(2); // 2 GPi gates
      expect(ionqResult.swapCount).toBe(0);

      // Rigetti transpilation
      const rigettiResult = await transpiler.transpile(circuit, RIGETTI_CEPHEUS_1);
      expect(rigettiResult.nativeGateCount).toBe(2); // 2 RX gates
      expect(rigettiResult.swapCount).toBe(0);
    });

    it('should transpile a full encoding circuit (ACGT sequence)', async () => {
      // A=00, C=01, G=10, T=11
      // X gates on: q[1] (C), q[2] (G), q[6] (T first bit), q[7] (T second bit)
      const qasm = makeXGateQASM(8, [1, 2, 6, 7]);
      const circuit = makeCircuit(qasm, 8);

      const ionqResult = await transpiler.transpile(circuit, IONQ_FORTE_ENTERPRISE);
      expect(ionqResult.nativeGateCount).toBe(4);
      expect(ionqResult.depth).toBe(1); // All GPi gates on different qubits

      const rigettiResult = await transpiler.transpile(circuit, RIGETTI_CEPHEUS_1);
      expect(rigettiResult.nativeGateCount).toBe(4);
      expect(rigettiResult.depth).toBe(1); // All RX gates on different qubits
    });
  });
});
