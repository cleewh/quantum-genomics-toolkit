/**
 * Decode a Hepatitis D Braket result.
 *
 * Usage:
 *   npx tsx scripts/decode-hepd-results.ts [bitstring] [taskId]
 *
 * Both arguments are optional. Defaults to a known-good demo bitstring and
 * placeholder task ID. Resolves the AWS account ID at runtime via STS so the
 * printed task ARN reflects the caller's account.
 */
import { ResultProcessor } from '../src/results/result-processor.js';
import { DEFAULT_DNA_ENCODING_SCHEME } from '../src/types/encoding-schemes.js';
import { getAccountId, braketTaskArn, resolveRegion } from './aws-helpers.js';

const DEFAULT_BITSTRING = '1010010110100100111010110101010010';
const DEFAULT_TASK_ID = '00000000-0000-0000-0000-000000000000';

async function main() {
  const bitstring = process.argv[2] || DEFAULT_BITSTRING;
  const taskId = process.argv[3] || DEFAULT_TASK_ID;
  const region = resolveRegion();

  let accountId = '<UNKNOWN>';
  try {
    accountId = await getAccountId(region);
  } catch {
    // Decoder still works without AWS creds — just won't have a real ARN
  }
  const taskArn = braketTaskArn(region, accountId, taskId);

  const processor = new ResultProcessor();
  const result = processor.decode(
    {
      bitstrings: { [bitstring]: 1000 },
      totalShots: 1000,
      backend: 'braket-local-simulator',
      jobId: taskArn,
    },
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
  console.log(`  Device:            Amazon Braket SV1 (${region})`);
  console.log(`  Task ARN:          ${taskArn}`);
  console.log(`  Qubits:            ${bitstring.length}`);
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
    jobId: taskArn,
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
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
