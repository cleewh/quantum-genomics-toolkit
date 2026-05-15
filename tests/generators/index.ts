/**
 * Custom fast-check generators for Quantum Genomics Encoding Pipeline domain types.
 *
 * These generators produce values conforming to the types defined in src/types/index.ts
 * and are used by all property-based tests throughout the project.
 */

import fc from 'fast-check';
import type {
  Nucleotide,
  EncodingScheme,
  EncodedCircuit,
  WorkflowDefinition,
  WorkflowStep,
  MeasurementResult,
  BackendId,
  BackendConfig,
  JobConfig,
} from '../../src/types/index.js';
import { BACKENDS } from '../../src/types/backends.js';

// ─── Nucleotide Sequence Generators ──────────────────────────────────────────

const DNA_BASES: Nucleotide[] = ['A', 'C', 'G', 'T'];
const RNA_BASES: Nucleotide[] = ['A', 'C', 'G', 'U'];

/**
 * Generates a random valid nucleotide sequence string.
 *
 * @param minLen - Minimum sequence length (default: 1)
 * @param maxLen - Maximum sequence length (default: 100)
 * @param type - Sequence type: 'DNA' uses A/C/G/T, 'RNA' uses A/C/G/U (default: 'DNA')
 */
export function arbitraryNucleotideSequence(
  minLen: number = 1,
  maxLen: number = 100,
  type: 'DNA' | 'RNA' = 'DNA'
): fc.Arbitrary<string> {
  const bases = type === 'RNA' ? RNA_BASES : DNA_BASES;
  return fc
    .array(fc.constantFrom(...bases), { minLength: minLen, maxLength: maxLen })
    .map((arr) => arr.join(''));
}

// ─── Encoding Scheme Generators ──────────────────────────────────────────────

/**
 * Generates a random encoding scheme (valid or invalid).
 *
 * Valid schemes have unique mappings with consistent bit length.
 * Invalid schemes may have duplicate mappings or inconsistent bit lengths.
 *
 * @param qubitsPerBase - Number of qubits per base (default: random 1-4)
 */
export function arbitraryEncodingScheme(
  qubitsPerBase?: number
): fc.Arbitrary<EncodingScheme> {
  return fc.oneof(
    { weight: 3, arbitrary: arbitraryValidEncodingScheme(qubitsPerBase) },
    { weight: 1, arbitrary: arbitraryInvalidEncodingScheme() }
  );
}

/**
 * Generates a valid encoding scheme with unique mappings and consistent bit length.
 */
export function arbitraryValidEncodingScheme(
  qubitsPerBase?: number
): fc.Arbitrary<EncodingScheme> {
  // Need at least 3 bits to get 5 unique bitstrings (2^3 = 8 >= 5)
  const qubitsArb = qubitsPerBase !== undefined
    ? fc.constant(qubitsPerBase)
    : fc.integer({ min: 3, max: 4 });

  return qubitsArb.chain((qpb) => {
    const bitLength = qpb;
    const maxPossible = 2 ** bitLength;

    // If we can't fit 5 unique bitstrings, use a deterministic assignment
    if (maxPossible < 5) {
      return fc.string({ minLength: 1, maxLength: 20 }).map((name) => {
        // For small bit lengths, just assign sequentially (with wrapping)
        const allBitstrings: string[] = [];
        for (let i = 0; i < maxPossible; i++) {
          allBitstrings.push(i.toString(2).padStart(bitLength, '0'));
        }
        const mapping: Record<Nucleotide, string> = {
          A: allBitstrings[0 % maxPossible],
          C: allBitstrings[1 % maxPossible],
          G: allBitstrings[2 % maxPossible],
          T: allBitstrings[3 % maxPossible],
          U: allBitstrings[4 % maxPossible],
        };
        return {
          name: `scheme-${name}`,
          qubitsPerBase: qpb,
          mapping,
        };
      });
    }

    // Generate 5 unique bitstrings of the correct length (for A, C, G, T, U)
    return fc
      .uniqueArray(
        fc.stringOf(fc.constantFrom('0', '1'), { minLength: bitLength, maxLength: bitLength }),
        { minLength: 5, maxLength: 5 }
      )
      .chain((bitstrings) => {
        return fc.string({ minLength: 1, maxLength: 20 }).map((name) => {
          const mapping: Record<Nucleotide, string> = {
            A: bitstrings[0],
            C: bitstrings[1],
            G: bitstrings[2],
            T: bitstrings[3],
            U: bitstrings[4],
          };
          return {
            name: `scheme-${name}`,
            qubitsPerBase: qpb,
            mapping,
          };
        });
      });
  });
}

/**
 * Generates an invalid encoding scheme (duplicate mappings or inconsistent bit length).
 */
export function arbitraryInvalidEncodingScheme(): fc.Arbitrary<EncodingScheme> {
  return fc.oneof(
    // Duplicate mappings: two nucleotides map to the same bitstring
    fc.integer({ min: 1, max: 3 }).chain((qpb) => {
      const bitLength = qpb;
      return fc
        .stringOf(fc.constantFrom('0', '1'), { minLength: bitLength, maxLength: bitLength })
        .chain((duplicateBit) => {
          return fc
            .array(
              fc.stringOf(fc.constantFrom('0', '1'), { minLength: bitLength, maxLength: bitLength }),
              { minLength: 3, maxLength: 3 }
            )
            .map((otherBits) => {
              const mapping: Record<Nucleotide, string> = {
                A: duplicateBit,
                C: duplicateBit, // intentional duplicate
                G: otherBits[0],
                T: otherBits[1],
                U: otherBits[2],
              };
              return {
                name: 'invalid-duplicate',
                qubitsPerBase: qpb,
                mapping,
              };
            });
        });
    }),
    // Inconsistent bit length: mappings have different lengths
    fc.integer({ min: 2, max: 4 }).map((qpb) => {
      const mapping: Record<Nucleotide, string> = {
        A: '0'.repeat(qpb),
        C: '1'.repeat(qpb),
        G: '01'.repeat(qpb), // longer than expected
        T: '10'.repeat(Math.max(1, qpb - 1)), // shorter than expected
        U: '11'.repeat(qpb),
      };
      return {
        name: 'invalid-inconsistent-length',
        qubitsPerBase: qpb,
        mapping,
      };
    })
  );
}

// ─── Encoded Circuit Generators ──────────────────────────────────────────────

/**
 * Generates a random quantum circuit with valid OpenQASM 3.0 representation.
 *
 * @param maxQubits - Maximum number of qubits in the circuit (default: 20)
 */
export function arbitraryEncodedCircuit(
  maxQubits: number = 20
): fc.Arbitrary<EncodedCircuit> {
  return fc
    .integer({ min: 2, max: maxQubits })
    .chain((qubitCount) => {
      return fc
        .integer({ min: 1, max: Math.max(1, qubitCount * 2) })
        .chain((gateCount) => {
          return generateCircuitGates(qubitCount, gateCount).chain((gates) => {
            const qasm = buildOpenQASM(qubitCount, gates);
            const depth = estimateDepth(qubitCount, gates);

            return arbitraryValidEncodingScheme(2).chain((scheme) => {
              return fc.string({ minLength: 3, maxLength: 10 }).map((seqId) => ({
                qasm,
                qubitCount,
                gateCount: gates.length,
                depth,
                scheme,
                sourceSequenceId: `seq-${seqId}`,
              }));
            });
          });
        });
    });
}

interface GateOp {
  name: string;
  qubits: number[];
  params?: number[];
}

function generateCircuitGates(
  qubitCount: number,
  gateCount: number
): fc.Arbitrary<GateOp[]> {
  const singleQubitGate = fc
    .integer({ min: 0, max: qubitCount - 1 })
    .chain((qubit) => {
      return fc.constantFrom('x', 'h', 'z', 's', 't').map((name) => ({
        name,
        qubits: [qubit],
      }));
    });

  const twoQubitGate = qubitCount >= 2
    ? fc
        .integer({ min: 0, max: qubitCount - 1 })
        .chain((q1) => {
          return fc
            .integer({ min: 0, max: qubitCount - 2 })
            .map((q2raw) => {
              const q2 = q2raw >= q1 ? q2raw + 1 : q2raw;
              return { name: 'cx', qubits: [q1, q2] };
            });
        })
    : singleQubitGate;

  const gateArb = fc.oneof(
    { weight: 3, arbitrary: singleQubitGate },
    { weight: 1, arbitrary: twoQubitGate }
  );

  return fc.array(gateArb, { minLength: gateCount, maxLength: gateCount });
}

function buildOpenQASM(qubitCount: number, gates: GateOp[]): string {
  const lines: string[] = [
    'OPENQASM 3.0;',
    'include "stdgates.inc";',
    `qubit[${qubitCount}] q;`,
    `bit[${qubitCount}] c;`,
    '',
  ];

  for (const gate of gates) {
    if (gate.qubits.length === 1) {
      lines.push(`${gate.name} q[${gate.qubits[0]}];`);
    } else {
      lines.push(`${gate.name} q[${gate.qubits[0]}], q[${gate.qubits[1]}];`);
    }
  }

  lines.push('');
  lines.push(`c = measure q;`);

  return lines.join('\n');
}

function estimateDepth(qubitCount: number, gates: GateOp[]): number {
  const qubitDepths = new Array(qubitCount).fill(0);
  for (const gate of gates) {
    const maxDepth = Math.max(...gate.qubits.map((q) => qubitDepths[q]));
    for (const q of gate.qubits) {
      qubitDepths[q] = maxDepth + 1;
    }
  }
  return Math.max(...qubitDepths, 1);
}

// ─── Workflow DAG Generators ─────────────────────────────────────────────────

/**
 * Generates a random workflow DAG (valid or invalid).
 *
 * Valid DAGs have no cycles and all referenced step IDs exist.
 * Invalid DAGs may contain cycles or reference non-existent step IDs.
 *
 * @param maxSteps - Maximum number of steps in the workflow (default: 8)
 */
export function arbitraryWorkflowDAG(
  maxSteps: number = 8
): fc.Arbitrary<WorkflowDefinition> {
  return fc.oneof(
    { weight: 3, arbitrary: arbitraryValidWorkflowDAG(maxSteps) },
    { weight: 1, arbitrary: arbitraryInvalidWorkflowDAG(maxSteps) }
  );
}

/**
 * Generates a valid workflow DAG with no cycles and all step IDs existing.
 */
export function arbitraryValidWorkflowDAG(
  maxSteps: number = 8
): fc.Arbitrary<WorkflowDefinition> {
  return fc
    .integer({ min: 1, max: maxSteps })
    .chain((stepCount) => {
      const stepIds = Array.from({ length: stepCount }, (_, i) => `step-${i}`);

      return fc
        .array(
          fc.constantFrom('quantum' as const, 'classical' as const),
          { minLength: stepCount, maxLength: stepCount }
        )
        .chain((types) => {
          // Generate valid DAG edges (only forward edges to prevent cycles)
          const possibleEdges: [string, string][] = [];
          for (let i = 0; i < stepCount; i++) {
            for (let j = i + 1; j < stepCount; j++) {
              possibleEdges.push([stepIds[i], stepIds[j]]);
            }
          }

          return fc
            .subarray(possibleEdges, { minLength: 0, maxLength: possibleEdges.length })
            .chain((dependencies) => {
              return fc.string({ minLength: 3, maxLength: 15 }).map((name) => {
                const steps: WorkflowStep[] = stepIds.map((id, idx) => ({
                  id,
                  type: types[idx],
                  config: {
                    shots: 1000,
                    backend: 'braket-local-simulator' as BackendId,
                    priority: 'normal' as const,
                    maxRetries: 3,
                    timeoutMinutes: 30,
                  },
                  outputS3Path: `s3://bucket/workflows/test/intermediate/${id}/`,
                }));

                return {
                  name: `workflow-${name}`,
                  steps,
                  dependencies,
                };
              });
            });
        });
    });
}

/**
 * Generates an invalid workflow DAG (with cycles or missing step references).
 */
export function arbitraryInvalidWorkflowDAG(
  maxSteps: number = 8
): fc.Arbitrary<WorkflowDefinition> {
  return fc.oneof(
    // Cyclic DAG
    fc.integer({ min: 2, max: maxSteps }).chain((stepCount) => {
      const stepIds = Array.from({ length: stepCount }, (_, i) => `step-${i}`);

      return fc.string({ minLength: 3, maxLength: 15 }).map((name) => {
        const steps: WorkflowStep[] = stepIds.map((id) => ({
          id,
          type: 'quantum' as const,
          config: {
            shots: 1000,
            backend: 'braket-local-simulator' as BackendId,
            priority: 'normal' as const,
            maxRetries: 3,
            timeoutMinutes: 30,
          },
          outputS3Path: `s3://bucket/workflows/test/intermediate/${id}/`,
        }));

        // Create a cycle: last step depends on first, first depends on last
        const dependencies: [string, string][] = [
          [stepIds[0], stepIds[stepCount - 1]],
          [stepIds[stepCount - 1], stepIds[0]], // creates cycle
        ];

        return {
          name: `workflow-cyclic-${name}`,
          steps,
          dependencies,
        };
      });
    }),
    // Missing step references
    fc.integer({ min: 2, max: maxSteps }).chain((stepCount) => {
      const stepIds = Array.from({ length: stepCount }, (_, i) => `step-${i}`);

      return fc.string({ minLength: 3, maxLength: 15 }).map((name) => {
        const steps: WorkflowStep[] = stepIds.map((id) => ({
          id,
          type: 'classical' as const,
          config: {},
          outputS3Path: `s3://bucket/workflows/test/intermediate/${id}/`,
        }));

        // Reference a non-existent step
        const dependencies: [string, string][] = [
          [stepIds[0], 'non-existent-step'],
        ];

        return {
          name: `workflow-missing-ref-${name}`,
          steps,
          dependencies,
        };
      });
    })
  );
}

// ─── Measurement Result Generators ───────────────────────────────────────────

/**
 * Generates a random measurement result with valid bitstring distributions.
 *
 * @param qubitCount - Number of qubits (determines bitstring length, default: random 2-20)
 * @param shots - Total number of measurement shots (default: random 100-10000)
 */
export function arbitraryMeasurementResult(
  qubitCount?: number,
  shots?: number
): fc.Arbitrary<MeasurementResult> {
  const qubitArb = qubitCount !== undefined
    ? fc.constant(qubitCount)
    : fc.integer({ min: 2, max: 20 });

  const shotsArb = shots !== undefined
    ? fc.constant(shots)
    : fc.integer({ min: 100, max: 10000 });

  return qubitArb.chain((qc) => {
    return shotsArb.chain((totalShots) => {
      // Generate a distribution of bitstrings that sum to totalShots
      return fc
        .integer({ min: 1, max: Math.min(2 ** qc, 20) })
        .chain((numDistinctBitstrings) => {
          return fc
            .array(
              fc.stringOf(fc.constantFrom('0', '1'), { minLength: qc, maxLength: qc }),
              { minLength: numDistinctBitstrings, maxLength: numDistinctBitstrings }
            )
            .chain((bitstrings) => {
              // Distribute shots across bitstrings
              return distributeShotsArbitrary(bitstrings.length, totalShots).chain(
                (counts) => {
                  return fc.constantFrom(
                    'ionq-forte-enterprise' as BackendId,
                    'rigetti-cepheus-1' as BackendId,
                    'braket-local-simulator' as BackendId
                  ).chain((backend) => {
                    return fc.string({ minLength: 5, maxLength: 15 }).map((jobId) => {
                      const bitstringMap: Record<string, number> = {};
                      for (let i = 0; i < bitstrings.length; i++) {
                        const key = bitstrings[i];
                        bitstringMap[key] = (bitstringMap[key] || 0) + counts[i];
                      }
                      return {
                        bitstrings: bitstringMap,
                        totalShots,
                        backend,
                        jobId: `job-${jobId}`,
                      };
                    });
                  });
                }
              );
            });
        });
    });
  });
}

/**
 * Distributes a total count across n buckets randomly.
 */
function distributeShotsArbitrary(
  buckets: number,
  total: number
): fc.Arbitrary<number[]> {
  if (buckets === 1) {
    return fc.constant([total]);
  }

  return fc
    .array(fc.integer({ min: 1, max: Math.max(1, total) }), {
      minLength: buckets,
      maxLength: buckets,
    })
    .map((raw) => {
      const sum = raw.reduce((a, b) => a + b, 0);
      const normalized = raw.map((v) => Math.max(1, Math.round((v / sum) * total)));
      // Adjust last bucket to ensure exact total
      const currentSum = normalized.reduce((a, b) => a + b, 0);
      normalized[normalized.length - 1] += total - currentSum;
      return normalized;
    });
}

// ─── Backend State Generators ────────────────────────────────────────────────

export interface BackendState {
  id: BackendId;
  config: BackendConfig;
  available: boolean;
  queueDepth: number;
  estimatedQueueTimeMinutes: number;
  costPerShot: number;
}

/**
 * Generates random backend availability and queue states.
 *
 * @param backends - List of backend IDs to generate states for (default: all backends)
 */
export function arbitraryBackendState(
  backends?: BackendId[]
): fc.Arbitrary<BackendState[]> {
  const backendIds = backends || (Object.keys(BACKENDS) as BackendId[]);

  return fc.tuple(
    ...backendIds.map((id) =>
      fc.record({
        id: fc.constant(id),
        config: fc.constant(BACKENDS[id]),
        available: fc.boolean(),
        queueDepth: fc.integer({ min: 0, max: 100 }),
        estimatedQueueTimeMinutes: fc.integer({ min: 0, max: 1440 }),
        costPerShot: fc.double({ min: 0.001, max: 1.0, noNaN: true, noDefaultInfinity: true }),
      })
    )
  ) as fc.Arbitrary<BackendState[]>;
}
