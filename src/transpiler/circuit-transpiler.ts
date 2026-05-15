/**
 * Circuit Transpiler implementation.
 * Converts abstract encoding circuits to hardware-native gate sets
 * while respecting qubit connectivity topology constraints.
 */

import type {
  EncodedCircuit,
  BackendConfig,
  TranspiledCircuit,
  BackendId,
} from '../types/index.js';

/**
 * CircuitTranspiler interface as defined in the design document.
 */
export interface CircuitTranspilerInterface {
  transpile(circuit: EncodedCircuit, backend: BackendConfig): Promise<TranspiledCircuit>;
}

/**
 * Represents a parsed gate from the abstract circuit.
 */
interface ParsedGate {
  name: string;       // e.g., 'x', 'h', 'z', 's', 't', 'cx'
  qubits: number[];   // qubit indices involved
}

/**
 * Represents a native gate in the transpiled circuit.
 */
interface NativeGate {
  name: string;       // e.g., 'GPi', 'GPi2', 'MS', 'RX', 'RZ', 'CZ'
  params: number[];   // gate parameters (angles in radians)
  qubits: number[];   // qubit indices
}

/**
 * Implementation of the CircuitTranspiler.
 * Supports transpilation to IonQ (GPi, GPi2, MS) and Rigetti (RX, RZ, CZ) native gate sets.
 */
export class CircuitTranspiler implements CircuitTranspilerInterface {
  /**
   * Transpiles an abstract encoding circuit to the native gate set of the target backend.
   *
   * Steps:
   * 1. Parse the input circuit's QASM to identify gates
   * 2. Decompose each gate into the target backend's native gate set
   * 3. For Rigetti, check connectivity and insert SWAPs if needed
   * 4. Generate new OpenQASM 3.0 with native gates
   * 5. Calculate the new gate count, depth, and swap count
   */
  async transpile(circuit: EncodedCircuit, backend: BackendConfig): Promise<TranspiledCircuit> {
    // Parse abstract gates from the circuit QASM
    const parsedGates = this.parseGates(circuit.qasm);
    const qubitCount = circuit.qubitCount;

    let nativeGates: NativeGate[];
    let swapCount = 0;

    if (backend.provider === 'IonQ') {
      nativeGates = this.transpileToIonQ(parsedGates);
    } else if (backend.provider === 'Rigetti') {
      const result = this.transpileToRigetti(parsedGates, qubitCount, backend);
      nativeGates = result.gates;
      swapCount = result.swapCount;
    } else if (backend.provider === 'AWS') {
      // Local simulator accepts all gates - pass through with minimal transformation
      nativeGates = this.transpileToSimulator(parsedGates);
    } else {
      throw new Error(`Unsupported backend provider: ${backend.provider}`);
    }

    // Calculate circuit depth using a greedy layer assignment
    const depth = this.calculateDepth(nativeGates, qubitCount);

    // Generate OpenQASM 3.0 output
    const qasm = this.generateNativeQASM(nativeGates, qubitCount, backend, circuit.scheme);

    return {
      qasm,
      originalCircuit: circuit,
      backend: backend.id,
      nativeGateCount: nativeGates.length,
      depth,
      swapCount,
    };
  }

  /**
   * Parses gate operations from an OpenQASM 3.0 string.
   */
  parseGates(qasm: string): ParsedGate[] {
    const gates: ParsedGate[] = [];
    const lines = qasm.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Match single-qubit gates: x q[0]; h q[1]; z q[2]; s q[3]; t q[4];
      const singleGateMatch = trimmed.match(/^(x|h|z|s|t)\s+\w+\[(\d+)\];$/);
      if (singleGateMatch) {
        gates.push({
          name: singleGateMatch[1],
          qubits: [parseInt(singleGateMatch[2], 10)],
        });
        continue;
      }

      // Match two-qubit gates: cx q[0], q[1];
      const twoGateMatch = trimmed.match(/^(cx)\s+\w+\[(\d+)\],\s*\w+\[(\d+)\];$/);
      if (twoGateMatch) {
        gates.push({
          name: twoGateMatch[1],
          qubits: [parseInt(twoGateMatch[2], 10), parseInt(twoGateMatch[3], 10)],
        });
        continue;
      }
    }

    return gates;
  }

  /**
   * Decomposes abstract gates to IonQ native gate set (GPi, GPi2, MS).
   *
   * IonQ has all-to-all connectivity, so no routing is needed.
   *
   * Decomposition rules:
   * - X gate → GPi(0)
   * - H gate → GPi2(0) followed by GPi(π/2)
   * - Z gate → GPi(π)
   * - S gate → GPi2(π/2)
   * - T gate → GPi2(π/4)
   * - CX (CNOT) → MS(π/4) + single qubit corrections (GPi2 on control, GPi2 on target)
   */
  transpileToIonQ(parsedGates: ParsedGate[]): NativeGate[] {
    const nativeGates: NativeGate[] = [];

    for (const gate of parsedGates) {
      switch (gate.name) {
        case 'x':
          nativeGates.push({
            name: 'GPi',
            params: [0],
            qubits: [gate.qubits[0]],
          });
          break;

        case 'h':
          // H = GPi2(0) followed by GPi(π/2)
          nativeGates.push({
            name: 'GPi2',
            params: [0],
            qubits: [gate.qubits[0]],
          });
          nativeGates.push({
            name: 'GPi',
            params: [Math.PI / 2],
            qubits: [gate.qubits[0]],
          });
          break;

        case 'z':
          nativeGates.push({
            name: 'GPi',
            params: [Math.PI],
            qubits: [gate.qubits[0]],
          });
          break;

        case 's':
          nativeGates.push({
            name: 'GPi2',
            params: [Math.PI / 2],
            qubits: [gate.qubits[0]],
          });
          break;

        case 't':
          nativeGates.push({
            name: 'GPi2',
            params: [Math.PI / 4],
            qubits: [gate.qubits[0]],
          });
          break;

        case 'cx':
          // CX = MS(π/4) + single qubit corrections
          nativeGates.push({
            name: 'GPi2',
            params: [-Math.PI / 2],
            qubits: [gate.qubits[0]],
          });
          nativeGates.push({
            name: 'MS',
            params: [Math.PI / 4],
            qubits: [gate.qubits[0], gate.qubits[1]],
          });
          nativeGates.push({
            name: 'GPi2',
            params: [Math.PI / 2],
            qubits: [gate.qubits[0]],
          });
          nativeGates.push({
            name: 'GPi2',
            params: [Math.PI / 2],
            qubits: [gate.qubits[1]],
          });
          break;

        default:
          throw new Error(`Unsupported gate '${gate.name}' for IonQ transpilation`);
      }
    }

    return nativeGates;
  }

  /**
   * Decomposes abstract gates to Rigetti native gate set (RX, RZ, CZ).
   *
   * Rigetti has grid connectivity, so qubit routing with SWAP insertion
   * may be needed for two-qubit gates on non-adjacent qubits.
   *
   * Decomposition rules:
   * - X gate → RX(π)
   * - H gate → RZ(π/2) + RX(π/2) + RZ(π/2)
   * - Z gate → RZ(π)
   * - S gate → RZ(π/2)
   * - T gate → RZ(π/4)
   * - CX (CNOT) → RZ(-π/2) on target + CZ + RX(π/2) on target + RZ(π/2) on target
   *
   * SWAP = 3 CZ gates with surrounding single-qubit gates:
   *   SWAP(a,b) = [RX(π/2) on b, CZ(a,b), RX(π/2) on a, RX(-π/2) on b,
   *                CZ(a,b), RX(π/2) on b, CZ(a,b), RX(-π/2) on a, RX(π/2) on b]
   * Simplified: each SWAP costs 3 CZ gates + 6 RX gates
   */
  transpileToRigetti(
    parsedGates: ParsedGate[],
    qubitCount: number,
    backend: BackendConfig
  ): { gates: NativeGate[]; swapCount: number } {
    const nativeGates: NativeGate[] = [];
    let swapCount = 0;

    // Build connectivity graph for the backend
    const connectivity = this.buildConnectivityGraph(qubitCount, backend);

    for (const gate of parsedGates) {
      switch (gate.name) {
        case 'x':
          nativeGates.push({
            name: 'RX',
            params: [Math.PI],
            qubits: [gate.qubits[0]],
          });
          break;

        case 'h':
          // H = RZ(π/2) + RX(π/2) + RZ(π/2)
          nativeGates.push({
            name: 'RZ',
            params: [Math.PI / 2],
            qubits: [gate.qubits[0]],
          });
          nativeGates.push({
            name: 'RX',
            params: [Math.PI / 2],
            qubits: [gate.qubits[0]],
          });
          nativeGates.push({
            name: 'RZ',
            params: [Math.PI / 2],
            qubits: [gate.qubits[0]],
          });
          break;

        case 'z':
          nativeGates.push({
            name: 'RZ',
            params: [Math.PI],
            qubits: [gate.qubits[0]],
          });
          break;

        case 's':
          nativeGates.push({
            name: 'RZ',
            params: [Math.PI / 2],
            qubits: [gate.qubits[0]],
          });
          break;

        case 't':
          nativeGates.push({
            name: 'RZ',
            params: [Math.PI / 4],
            qubits: [gate.qubits[0]],
          });
          break;

        case 'cx': {
          // Need to route if qubits aren't adjacent
          const control = gate.qubits[0];
          const target = gate.qubits[1];

          if (connectivity.areConnected(control, target)) {
            // Direct CX decomposition: RZ(-π/2) on target + CZ + RX(π/2) on target + RZ(π/2) on target
            this.emitCXDecomposition(nativeGates, control, target);
          } else {
            // Need SWAP routing - find path and insert SWAPs
            const path = connectivity.findShortestPath(control, target);
            if (path.length < 2) {
              throw new Error(
                `No path found between qubits ${control} and ${target} in Rigetti topology`
              );
            }

            // Move control qubit along the path using SWAPs
            // After SWAPs, the logical control qubit is adjacent to target
            let currentControl = control;
            for (let i = 0; i < path.length - 2; i++) {
              const nextQubit = path[i + 1];
              this.emitSWAP(nativeGates, currentControl, nextQubit);
              swapCount++;
              currentControl = nextQubit;
            }

            // Now currentControl is adjacent to target, emit CX
            this.emitCXDecomposition(nativeGates, currentControl, target);

            // Swap back to restore qubit mapping (optional for correctness)
            // For encoding circuits this is typically the last operation,
            // but for general correctness we swap back
            for (let i = path.length - 3; i >= 0; i--) {
              const prevQubit = path[i];
              const curQubit = path[i + 1];
              this.emitSWAP(nativeGates, curQubit, prevQubit);
              swapCount++;
            }
          }
          break;
        }

        default:
          throw new Error(`Unsupported gate '${gate.name}' for Rigetti transpilation`);
      }
    }

    return { gates: nativeGates, swapCount };
  }

  /**
   * For the local simulator, pass through gates with minimal transformation.
   * The simulator accepts all standard gates.
   */
  private transpileToSimulator(parsedGates: ParsedGate[]): NativeGate[] {
    const nativeGates: NativeGate[] = [];

    for (const gate of parsedGates) {
      switch (gate.name) {
        case 'x':
          nativeGates.push({ name: 'x', params: [], qubits: [gate.qubits[0]] });
          break;
        case 'h':
          nativeGates.push({ name: 'h', params: [], qubits: [gate.qubits[0]] });
          break;
        case 'z':
          nativeGates.push({ name: 'z', params: [], qubits: [gate.qubits[0]] });
          break;
        case 's':
          nativeGates.push({ name: 's', params: [], qubits: [gate.qubits[0]] });
          break;
        case 't':
          nativeGates.push({ name: 't', params: [], qubits: [gate.qubits[0]] });
          break;
        case 'cx':
          nativeGates.push({ name: 'cx', params: [], qubits: [gate.qubits[0], gate.qubits[1]] });
          break;
        default:
          throw new Error(`Unsupported gate '${gate.name}' for simulator transpilation`);
      }
    }

    return nativeGates;
  }

  /**
   * Emits the CX (CNOT) decomposition into Rigetti native gates.
   * CX(control, target) = RZ(-π/2) on target + CZ(control, target) + RX(π/2) on target + RZ(π/2) on target
   */
  private emitCXDecomposition(nativeGates: NativeGate[], control: number, target: number): void {
    nativeGates.push({
      name: 'RZ',
      params: [-Math.PI / 2],
      qubits: [target],
    });
    nativeGates.push({
      name: 'CZ',
      params: [],
      qubits: [control, target],
    });
    nativeGates.push({
      name: 'RX',
      params: [Math.PI / 2],
      qubits: [target],
    });
    nativeGates.push({
      name: 'RZ',
      params: [Math.PI / 2],
      qubits: [target],
    });
  }

  /**
   * Emits a SWAP gate decomposed into Rigetti native gates.
   * SWAP(a, b) uses 3 CZ gates with surrounding single-qubit rotations.
   *
   * Decomposition:
   *   RX(π/2) on a, RX(π/2) on b
   *   CZ(a, b)
   *   RX(π/2) on a, RX(-π/2) on b
   *   CZ(a, b)
   *   RX(-π/2) on a, RX(π/2) on b
   *   CZ(a, b)
   */
  private emitSWAP(nativeGates: NativeGate[], a: number, b: number): void {
    // SWAP decomposition using 3 CZ gates
    nativeGates.push({ name: 'RX', params: [Math.PI / 2], qubits: [a] });
    nativeGates.push({ name: 'RX', params: [Math.PI / 2], qubits: [b] });
    nativeGates.push({ name: 'CZ', params: [], qubits: [a, b] });
    nativeGates.push({ name: 'RX', params: [Math.PI / 2], qubits: [a] });
    nativeGates.push({ name: 'RX', params: [-Math.PI / 2], qubits: [b] });
    nativeGates.push({ name: 'CZ', params: [], qubits: [a, b] });
    nativeGates.push({ name: 'RX', params: [-Math.PI / 2], qubits: [a] });
    nativeGates.push({ name: 'RX', params: [Math.PI / 2], qubits: [b] });
    nativeGates.push({ name: 'CZ', params: [], qubits: [a, b] });
  }

  /**
   * Builds a connectivity graph for the given backend.
   * For grid topology, creates a 2D grid where adjacent qubits are connected.
   */
  buildConnectivityGraph(
    qubitCount: number,
    backend: BackendConfig
  ): ConnectivityGraph {
    if (backend.connectivity.type === 'all-to-all') {
      return new AllToAllConnectivity(qubitCount);
    }

    if (backend.connectivity.type === 'grid') {
      // For Rigetti grid: approximate as a square grid
      const cols = Math.ceil(Math.sqrt(qubitCount));
      const rows = Math.ceil(qubitCount / cols);
      return new GridConnectivity(rows, cols, qubitCount);
    }

    if (backend.connectivity.type === 'custom' && backend.connectivity.edges) {
      return new CustomConnectivity(qubitCount, backend.connectivity.edges);
    }

    // Default to all-to-all if unknown
    return new AllToAllConnectivity(qubitCount);
  }

  /**
   * Calculates circuit depth using greedy layer assignment.
   * A gate can be placed in a layer if none of its qubits are already used in that layer.
   */
  calculateDepth(nativeGates: NativeGate[], _qubitCount: number): number {
    if (nativeGates.length === 0) return 0;

    // Each layer tracks which qubits are in use
    const layers: Set<number>[] = [];

    for (const gate of nativeGates) {
      // Find the first layer where all qubits of this gate are free
      let placed = false;
      for (const layer of layers) {
        const conflict = gate.qubits.some((q) => layer.has(q));
        if (!conflict) {
          for (const q of gate.qubits) {
            layer.add(q);
          }
          placed = true;
          break;
        }
      }

      if (!placed) {
        // Create a new layer
        const newLayer = new Set<number>();
        for (const q of gate.qubits) {
          newLayer.add(q);
        }
        layers.push(newLayer);
      }
    }

    return layers.length;
  }

  /**
   * Generates OpenQASM 3.0 output with native gates.
   */
  generateNativeQASM(
    nativeGates: NativeGate[],
    qubitCount: number,
    backend: BackendConfig,
    scheme: { name: string; qubitsPerBase: number; mapping: Record<string, string> }
  ): string {
    const lines: string[] = [];

    // Header
    lines.push('OPENQASM 3.0;');
    lines.push('include "stdgates.inc";');
    lines.push('');

    // Metadata comments
    lines.push(`// Backend: ${backend.name} (${backend.id})`);
    lines.push(`// Native gates: ${backend.nativeGates.join(', ')}`);
    lines.push(`// Encoding scheme: ${scheme.name}`);
    lines.push(`// Qubits per base: ${scheme.qubitsPerBase}`);
    lines.push(`// Mapping: ${JSON.stringify(scheme.mapping)}`);
    lines.push('');

    // Register declarations
    lines.push(`qubit[${qubitCount}] q;`);
    lines.push(`bit[${qubitCount}] c;`);
    lines.push('');

    // Native gate operations
    for (const gate of nativeGates) {
      lines.push(this.formatGateQASM(gate));
    }

    if (nativeGates.length > 0) {
      lines.push('');
    }

    // Measurement
    lines.push('c = measure q;');

    return lines.join('\n');
  }

  /**
   * Formats a native gate as an OpenQASM 3.0 statement.
   */
  private formatGateQASM(gate: NativeGate): string {
    const qubitsStr = gate.qubits.map((q) => `q[${q}]`).join(', ');

    if (gate.params.length > 0) {
      const paramsStr = gate.params.map((p) => this.formatAngle(p)).join(', ');
      return `${gate.name.toLowerCase()}(${paramsStr}) ${qubitsStr};`;
    }

    return `${gate.name.toLowerCase()} ${qubitsStr};`;
  }

  /**
   * Formats an angle value for QASM output.
   * Uses symbolic representation for common angles.
   */
  private formatAngle(angle: number): string {
    // Check for common symbolic angles
    const tolerance = 1e-10;

    if (Math.abs(angle) < tolerance) return '0';
    if (Math.abs(angle - Math.PI) < tolerance) return 'pi';
    if (Math.abs(angle + Math.PI) < tolerance) return '-pi';
    if (Math.abs(angle - Math.PI / 2) < tolerance) return 'pi/2';
    if (Math.abs(angle + Math.PI / 2) < tolerance) return '-pi/2';
    if (Math.abs(angle - Math.PI / 4) < tolerance) return 'pi/4';
    if (Math.abs(angle + Math.PI / 4) < tolerance) return '-pi/4';

    // Fall back to numeric representation
    return angle.toFixed(6);
  }
}

// ─── Connectivity Graph Implementations ──────────────────────────────────────

/**
 * Interface for qubit connectivity graphs.
 */
interface ConnectivityGraph {
  areConnected(a: number, b: number): boolean;
  findShortestPath(from: number, to: number): number[];
}

/**
 * All-to-all connectivity (e.g., IonQ trapped-ion).
 * Every qubit pair is directly connected.
 */
class AllToAllConnectivity implements ConnectivityGraph {
  constructor(private qubitCount: number) {}

  areConnected(_a: number, _b: number): boolean {
    return true;
  }

  findShortestPath(from: number, to: number): number[] {
    return [from, to];
  }
}

/**
 * Grid connectivity (e.g., Rigetti superconducting).
 * Qubits are arranged in a 2D grid; adjacent means horizontally or vertically neighboring.
 */
class GridConnectivity implements ConnectivityGraph {
  private adjacency: Map<number, Set<number>>;

  constructor(
    private rows: number,
    private cols: number,
    private qubitCount: number
  ) {
    this.adjacency = new Map();
    this.buildGrid();
  }

  private buildGrid(): void {
    for (let i = 0; i < this.qubitCount; i++) {
      this.adjacency.set(i, new Set());
    }

    for (let i = 0; i < this.qubitCount; i++) {
      const row = Math.floor(i / this.cols);
      const col = i % this.cols;

      // Right neighbor
      if (col + 1 < this.cols) {
        const right = row * this.cols + (col + 1);
        if (right < this.qubitCount) {
          this.adjacency.get(i)!.add(right);
          this.adjacency.get(right)!.add(i);
        }
      }

      // Bottom neighbor
      if (row + 1 < this.rows) {
        const bottom = (row + 1) * this.cols + col;
        if (bottom < this.qubitCount) {
          this.adjacency.get(i)!.add(bottom);
          this.adjacency.get(bottom)!.add(i);
        }
      }
    }
  }

  areConnected(a: number, b: number): boolean {
    return this.adjacency.get(a)?.has(b) ?? false;
  }

  /**
   * BFS shortest path between two qubits in the grid.
   */
  findShortestPath(from: number, to: number): number[] {
    if (from === to) return [from];

    const visited = new Set<number>();
    const parent = new Map<number, number>();
    const queue: number[] = [from];
    visited.add(from);

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current === to) {
        // Reconstruct path
        const path: number[] = [];
        let node: number | undefined = to;
        while (node !== undefined) {
          path.unshift(node);
          node = parent.get(node);
        }
        return path;
      }

      const neighbors = this.adjacency.get(current);
      if (neighbors) {
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            parent.set(neighbor, current);
            queue.push(neighbor);
          }
        }
      }
    }

    // No path found
    return [];
  }
}

/**
 * Custom connectivity defined by explicit edge list.
 */
class CustomConnectivity implements ConnectivityGraph {
  private adjacency: Map<number, Set<number>>;

  constructor(qubitCount: number, edges: [number, number][]) {
    this.adjacency = new Map();
    for (let i = 0; i < qubitCount; i++) {
      this.adjacency.set(i, new Set());
    }
    for (const [a, b] of edges) {
      this.adjacency.get(a)?.add(b);
      this.adjacency.get(b)?.add(a);
    }
  }

  areConnected(a: number, b: number): boolean {
    return this.adjacency.get(a)?.has(b) ?? false;
  }

  findShortestPath(from: number, to: number): number[] {
    if (from === to) return [from];

    const visited = new Set<number>();
    const parent = new Map<number, number>();
    const queue: number[] = [from];
    visited.add(from);

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current === to) {
        const path: number[] = [];
        let node: number | undefined = to;
        while (node !== undefined) {
          path.unshift(node);
          node = parent.get(node);
        }
        return path;
      }

      const neighbors = this.adjacency.get(current);
      if (neighbors) {
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            parent.set(neighbor, current);
            queue.push(neighbor);
          }
        }
      }
    }

    return [];
  }
}

// Export connectivity classes for testing
export { AllToAllConnectivity, GridConnectivity, CustomConnectivity };
export type { ConnectivityGraph, ParsedGate, NativeGate };
