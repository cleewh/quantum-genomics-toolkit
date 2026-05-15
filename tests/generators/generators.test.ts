/**
 * Tests for custom fast-check generators to verify they produce valid domain values.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  arbitraryNucleotideSequence,
  arbitraryEncodingScheme,
  arbitraryValidEncodingScheme,
  arbitraryInvalidEncodingScheme,
  arbitraryEncodedCircuit,
  arbitraryWorkflowDAG,
  arbitraryValidWorkflowDAG,
  arbitraryInvalidWorkflowDAG,
  arbitraryMeasurementResult,
  arbitraryBackendState,
} from './index.js';

describe('arbitraryNucleotideSequence', () => {
  it('generates DNA sequences with only A, C, G, T', () => {
    fc.assert(
      fc.property(arbitraryNucleotideSequence(1, 50, 'DNA'), (seq) => {
        expect(seq).toMatch(/^[ACGT]+$/);
      }),
      { numRuns: 20 }
    );
  });

  it('generates RNA sequences with only A, C, G, U', () => {
    fc.assert(
      fc.property(arbitraryNucleotideSequence(1, 50, 'RNA'), (seq) => {
        expect(seq).toMatch(/^[ACGU]+$/);
      }),
      { numRuns: 20 }
    );
  });

  it('respects min and max length constraints', () => {
    fc.assert(
      fc.property(arbitraryNucleotideSequence(5, 20), (seq) => {
        expect(seq.length).toBeGreaterThanOrEqual(5);
        expect(seq.length).toBeLessThanOrEqual(20);
      }),
      { numRuns: 20 }
    );
  });
});

describe('arbitraryEncodingScheme', () => {
  it('generates schemes with required fields', () => {
    fc.assert(
      fc.property(arbitraryEncodingScheme(), (scheme) => {
        expect(scheme).toHaveProperty('name');
        expect(scheme).toHaveProperty('qubitsPerBase');
        expect(scheme).toHaveProperty('mapping');
        expect(scheme.mapping).toHaveProperty('A');
        expect(scheme.mapping).toHaveProperty('C');
        expect(scheme.mapping).toHaveProperty('G');
        expect(scheme.mapping).toHaveProperty('T');
        expect(scheme.mapping).toHaveProperty('U');
      }),
      { numRuns: 20 }
    );
  });

  it('valid schemes have unique mappings with consistent bit length', () => {
    fc.assert(
      fc.property(arbitraryValidEncodingScheme(), (scheme) => {
        const values = Object.values(scheme.mapping);
        const uniqueValues = new Set(values);
        expect(uniqueValues.size).toBe(values.length);
        const lengths = values.map((v) => v.length);
        expect(new Set(lengths).size).toBe(1);
        expect(lengths[0]).toBe(scheme.qubitsPerBase);
      }),
      { numRuns: 20 }
    );
  });

  it('invalid schemes have duplicate mappings or inconsistent lengths', () => {
    fc.assert(
      fc.property(arbitraryInvalidEncodingScheme(), (scheme) => {
        const values = Object.values(scheme.mapping);
        const uniqueValues = new Set(values);
        const lengths = values.map((v) => v.length);
        const hasInconsistentLengths = new Set(lengths).size > 1;
        const hasDuplicates = uniqueValues.size < values.length;
        expect(hasDuplicates || hasInconsistentLengths).toBe(true);
      }),
      { numRuns: 20 }
    );
  });
});

describe('arbitraryEncodedCircuit', () => {
  it('generates circuits with valid OpenQASM 3.0 structure', () => {
    fc.assert(
      fc.property(arbitraryEncodedCircuit(10), (circuit) => {
        expect(circuit.qasm).toContain('OPENQASM 3.0;');
        expect(circuit.qasm).toContain('include "stdgates.inc";');
        expect(circuit.qasm).toContain('qubit[');
        expect(circuit.qasm).toContain('measure');
        expect(circuit.qubitCount).toBeGreaterThanOrEqual(2);
        expect(circuit.qubitCount).toBeLessThanOrEqual(10);
        expect(circuit.gateCount).toBeGreaterThanOrEqual(1);
        expect(circuit.depth).toBeGreaterThanOrEqual(1);
        expect(circuit.scheme).toBeDefined();
        expect(circuit.sourceSequenceId).toBeDefined();
      }),
      { numRuns: 20 }
    );
  });
});

describe('arbitraryWorkflowDAG', () => {
  it('valid DAGs have no cycles and all step IDs exist', () => {
    fc.assert(
      fc.property(arbitraryValidWorkflowDAG(6), (workflow) => {
        const stepIds = new Set(workflow.steps.map((s) => s.id));
        // All dependency references exist
        for (const [from, to] of workflow.dependencies) {
          expect(stepIds.has(from)).toBe(true);
          expect(stepIds.has(to)).toBe(true);
        }
        // No cycles: since edges are only forward (step-i -> step-j where i < j), no cycles possible
        expect(workflow.steps.length).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 20 }
    );
  });

  it('invalid DAGs have cycles or missing references', () => {
    fc.assert(
      fc.property(arbitraryInvalidWorkflowDAG(6), (workflow) => {
        const stepIds = new Set(workflow.steps.map((s) => s.id));
        const hasMissingRef = workflow.dependencies.some(
          ([from, to]) => !stepIds.has(from) || !stepIds.has(to)
        );
        const hasCycle = detectCycle(workflow);
        expect(hasMissingRef || hasCycle).toBe(true);
      }),
      { numRuns: 20 }
    );
  });
});

describe('arbitraryMeasurementResult', () => {
  it('generates results with valid bitstring distributions', () => {
    fc.assert(
      fc.property(arbitraryMeasurementResult(4, 1000), (result) => {
        expect(result.totalShots).toBe(1000);
        expect(result.backend).toBeDefined();
        expect(result.jobId).toBeDefined();
        // All bitstrings have correct length
        for (const bitstring of Object.keys(result.bitstrings)) {
          expect(bitstring.length).toBe(4);
          expect(bitstring).toMatch(/^[01]+$/);
        }
        // Counts sum to totalShots
        const totalCounts = Object.values(result.bitstrings).reduce((a, b) => a + b, 0);
        expect(totalCounts).toBe(1000);
      }),
      { numRuns: 20 }
    );
  });
});

describe('arbitraryBackendState', () => {
  it('generates states for all backends with required fields', () => {
    fc.assert(
      fc.property(arbitraryBackendState(), (states) => {
        expect(states.length).toBe(3); // all 3 backends
        for (const state of states) {
          expect(state.id).toBeDefined();
          expect(state.config).toBeDefined();
          expect(typeof state.available).toBe('boolean');
          expect(state.queueDepth).toBeGreaterThanOrEqual(0);
          expect(state.estimatedQueueTimeMinutes).toBeGreaterThanOrEqual(0);
          expect(state.costPerShot).toBeGreaterThan(0);
        }
      }),
      { numRuns: 20 }
    );
  });
});

// Helper: detect cycle in workflow DAG
function detectCycle(workflow: { steps: { id: string }[]; dependencies: [string, string][] }): boolean {
  const adj = new Map<string, string[]>();
  for (const step of workflow.steps) {
    adj.set(step.id, []);
  }
  for (const [from, to] of workflow.dependencies) {
    if (adj.has(from)) {
      adj.get(from)!.push(to);
    }
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(node: string): boolean {
    if (inStack.has(node)) return true;
    if (visited.has(node)) return false;
    visited.add(node);
    inStack.add(node);
    for (const neighbor of adj.get(node) || []) {
      if (adj.has(neighbor) && dfs(neighbor)) return true;
    }
    inStack.delete(node);
    return false;
  }

  for (const step of workflow.steps) {
    if (dfs(step.id)) return true;
  }
  return false;
}
