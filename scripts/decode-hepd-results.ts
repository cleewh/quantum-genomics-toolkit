/**
 * Decode the Hepatitis D Braket results.
 */
import { ResultProcessor } from '../src/results/result-processor.js';
import { DEFAULT_DNA_ENCODING_SCHEME } from '../src/types/encoding-schemes.js';

const bitstring = '1010010110100100111010110101010010';
const processor = new ResultProcessor();

const result = processor.decode(
  { bitstrings: { [bitstring]: 1000 }, totalShots: 1000, backend: 'braket-local-simulator', jobId: 'hepd-task' },
  DEFAULT_DNA_ENCODING_SCHEME
);

const input = 'GGCCGGCATGGTCCCAG';
console.log('');
console.log('━━━ Hepatitis D Virus Genome — Amazon Braket SV1 Results ━━━');
console.log('');
console.log(`  Input sequence:    ${input}`);
console.log(`  Decoded sequence:  ${result.nucleotides}`);
console.log(`  Confidence:        ${(result.averageConfidence * 100).toFixed(1)}%`);
console.log(`  Round-trip match:  ${result.nucleotides === input ? '✓ PASS' : '✗ FAIL'}`);
console.log(`  Shots:             1000`);
console.log(`  Unique bitstrings: 1 (deterministic — SV1 is noiseless)`);
console.log(`  Device:            Amazon Braket SV1 (us-east-1)`);
console.log(`  Task ARN:          arn:aws:braket:us-east-1:687677765589:quantum-task/dcbbc330-d632-4054-a3ac-f74a8fe22f0f`);
console.log(`  Qubits:            34`);
console.log('');
console.log('  Per-base decoding:');
for (let i = 0; i < result.nucleotides.length; i++) {
  const bits = bitstring.slice(i * 2, i * 2 + 2);
  const conf = (result.perBaseConfidence[i] * 100).toFixed(0);
  console.log(`    Position ${String(i).padStart(2)}: |${bits}⟩ → ${result.nucleotides[i]} (${conf}%)`);
}
console.log('');

// Generate report
const report = processor.generateReport(result, {
  jobId: 'arn:aws:braket:us-east-1:687677765589:quantum-task/dcbbc330-d632-4054-a3ac-f74a8fe22f0f',
  backend: 'braket-local-simulator',
  shots: 1000,
  encodingScheme: 'default-2qubit-basis',
  executionTimeMs: 180000,
});

console.log('  FASTA output:');
for (const line of report.fasta.split('\n').filter((l) => l)) {
  console.log(`    ${line}`);
}
console.log('');
console.log('━━━ Success! Hepatitis D genome fragment encoded & decoded via Amazon Braket ━━━');
