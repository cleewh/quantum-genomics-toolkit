import { describe, it, expect } from 'vitest';
import { DefaultQubitBudgetAnalyzer } from '../../src/budget/qubit-budget-analyzer.js';
import { ParsedSequence, EncodingScheme } from '../../src/types/index.js';
import { DEFAULT_DNA_ENCODING_SCHEME } from '../../src/types/encoding-schemes.js';

function makeSequence(nucleotides: string): ParsedSequence {
  return {
    id: 'test-seq',
    description: 'Test sequence',
    nucleotides,
    length: nucleotides.length,
    type: 'DNA',
    metadata: {},
  };
}

describe('QubitBudgetAnalyzer', () => {
  const analyzer = new DefaultQubitBudgetAnalyzer();
  const scheme = DEFAULT_DNA_ENCODING_SCHEME; // 2 qubits per base

  describe('analyze()', () => {
    it('calculates required qubits as sequence length × qubitsPerBase', () => {
      const seq = makeSequence('ACGT'); // 4 bases × 2 = 8 qubits
      const result = analyzer.analyze(seq, scheme);
      expect(result.requiredQubits).toBe(8);
    });

    it('reports correct fit for a short sequence that fits all backends', () => {
      const seq = makeSequence('ACGTACGT'); // 8 bases × 2 = 16 qubits
      const result = analyzer.analyze(seq, scheme);

      // IonQ: 36 qubits — fits
      expect(result.backendFit['ionq-forte-enterprise'].fits).toBe(true);
      expect(result.backendFit['ionq-forte-enterprise'].availableQubits).toBe(36);

      // Rigetti: 108 qubits — fits
      expect(result.backendFit['rigetti-cepheus-1'].fits).toBe(true);
      expect(result.backendFit['rigetti-cepheus-1'].availableQubits).toBe(108);

      // Braket local: 34 qubits — fits
      expect(result.backendFit['braket-local-simulator'].fits).toBe(true);
      expect(result.backendFit['braket-local-simulator'].availableQubits).toBe(34);
    });

    it('reports correct fit for a sequence that exceeds some backends', () => {
      // 20 bases × 2 = 40 qubits — exceeds IonQ (36) and simulator (34), fits Rigetti (108)
      const seq = makeSequence('ACGTACGTACGTACGTACGT');
      const result = analyzer.analyze(seq, scheme);

      expect(result.backendFit['ionq-forte-enterprise'].fits).toBe(false);
      expect(result.backendFit['rigetti-cepheus-1'].fits).toBe(true);
      expect(result.backendFit['braket-local-simulator'].fits).toBe(false);
    });

    it('reports correct fit for a sequence that exceeds all backends', () => {
      // 55 bases × 2 = 110 qubits — exceeds all (max is Rigetti at 108)
      const seq = makeSequence('A'.repeat(55));
      const result = analyzer.analyze(seq, scheme);

      expect(result.backendFit['ionq-forte-enterprise'].fits).toBe(false);
      expect(result.backendFit['rigetti-cepheus-1'].fits).toBe(false);
      expect(result.backendFit['braket-local-simulator'].fits).toBe(false);
    });

    it('calculates utilization percentage correctly', () => {
      const seq = makeSequence('ACGTACGTAC'); // 10 bases × 2 = 20 qubits
      const result = analyzer.analyze(seq, scheme);

      // IonQ: 20/36 = 55.56%
      expect(result.backendFit['ionq-forte-enterprise'].utilizationPercent).toBeCloseTo(55.56, 1);

      // Rigetti: 20/108 = 18.52%
      expect(result.backendFit['rigetti-cepheus-1'].utilizationPercent).toBeCloseTo(18.52, 1);

      // Braket local: 20/34 = 58.82%
      expect(result.backendFit['braket-local-simulator'].utilizationPercent).toBeCloseTo(58.82, 1);
    });

    it('caps utilization at 100% when sequence exceeds backend', () => {
      const seq = makeSequence('A'.repeat(55)); // 110 qubits needed
      const result = analyzer.analyze(seq, scheme);

      // All backends should cap at 100%
      expect(result.backendFit['ionq-forte-enterprise'].utilizationPercent).toBe(100);
      expect(result.backendFit['rigetti-cepheus-1'].utilizationPercent).toBe(100);
      expect(result.backendFit['braket-local-simulator'].utilizationPercent).toBe(100);
    });

    it('recommends "direct" when sequence fits at least one real backend', () => {
      const seq = makeSequence('ACGT'); // 8 qubits — fits all
      const result = analyzer.analyze(seq, scheme);
      expect(result.recommendation).toBe('direct');
    });

    it('recommends "direct" when sequence fits only Rigetti (real backend)', () => {
      // 20 bases × 2 = 40 qubits — only fits Rigetti
      const seq = makeSequence('ACGTACGTACGTACGTACGT');
      const result = analyzer.analyze(seq, scheme);
      expect(result.recommendation).toBe('direct');
    });

    it('recommends "partition" when sequence exceeds all real backends', () => {
      // 55 bases × 2 = 110 qubits — exceeds all
      const seq = makeSequence('A'.repeat(55));
      const result = analyzer.analyze(seq, scheme);
      expect(result.recommendation).toBe('partition');
    });

    it('works with a custom encoding scheme (3 qubits per base)', () => {
      const customScheme: EncodingScheme = {
        name: 'custom-3qubit',
        qubitsPerBase: 3,
        mapping: { A: '000', C: '001', G: '010', T: '011', U: '100' },
      };
      const seq = makeSequence('ACGTACGTACGT'); // 12 bases × 3 = 36 qubits
      const result = analyzer.analyze(seq, customScheme);

      expect(result.requiredQubits).toBe(36);
      // IonQ: 36 qubits — exactly fits
      expect(result.backendFit['ionq-forte-enterprise'].fits).toBe(true);
      expect(result.backendFit['ionq-forte-enterprise'].utilizationPercent).toBe(100);
    });

    it('handles single nucleotide sequence', () => {
      const seq = makeSequence('A'); // 1 base × 2 = 2 qubits
      const result = analyzer.analyze(seq, scheme);
      expect(result.requiredQubits).toBe(2);
      expect(result.recommendation).toBe('direct');
    });
  });
});
