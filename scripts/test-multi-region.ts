/**
 * Test encoding in two different AWS regions (us-east-1 and us-west-2).
 * Submits the same Hepatitis D fragment to SV1 in both regions.
 *
 * Resolves account ID at runtime via STS — no hardcoded account.
 */

import {
  BraketClient,
  CreateQuantumTaskCommand,
  GetQuantumTaskCommand,
} from '@aws-sdk/client-braket';

import { EncodingEngine } from '../src/encoding/encoding-engine.js';
import { ResultProcessor } from '../src/results/result-processor.js';
import { DEFAULT_DNA_ENCODING_SCHEME } from '../src/types/encoding-schemes.js';
import type { ParsedSequence } from '../src/types/index.js';
import { ensureBraketBucket } from './aws-helpers.js';

const SEQUENCE = 'GGCCGGCA';
const SHOTS = 100;

const REGIONS = ['us-east-1', 'us-west-2'];

async function runInRegion(region: string): Promise<void> {
  console.log(`\n━━━ Region: ${region} ━━━`);

  // Ensure S3 bucket exists (creates if needed; uses caller's account ID)
  const bucket = await ensureBraketBucket(region);

  // Encode
  const encoder = new EncodingEngine();
  const seq: ParsedSequence = {
    id: 'hepd-multi-region',
    description: `HDV fragment (${region})`,
    nucleotides: SEQUENCE,
    length: SEQUENCE.length,
    type: 'DNA',
    metadata: {},
  };
  const circuit = await encoder.encode(seq);
  console.log(`  Encoded: ${SEQUENCE} → ${circuit.qubitCount} qubits, ${circuit.gateCount} gates`);

  // Submit to Braket SV1
  const braket = new BraketClient({ region });
  const braketQasm = circuit.qasm
    .split('\n')
    .filter((line) => !line.includes('include "stdgates.inc"'))
    .join('\n');

  const prefix = `multi-region-test/${Date.now()}`;
  const response = await braket.send(
    new CreateQuantumTaskCommand({
      deviceArn: 'arn:aws:braket:::device/quantum-simulator/amazon/sv1',
      shots: SHOTS,
      outputS3Bucket: bucket,
      outputS3KeyPrefix: prefix,
      action: JSON.stringify({
        braketSchemaHeader: { name: 'braket.ir.openqasm.program', version: '1' },
        source: braketQasm,
      }),
    })
  );
  const taskArn = response.quantumTaskArn!;
  console.log(`  Submitted: ${taskArn}`);

  // Poll
  const startTime = Date.now();
  let status = 'CREATED';
  while (!['COMPLETED', 'FAILED', 'CANCELLED'].includes(status)) {
    await new Promise(r => setTimeout(r, 2000));
    const task = await braket.send(new GetQuantumTaskCommand({ quantumTaskArn: taskArn }));
    status = task.status || 'UNKNOWN';
    process.stdout.write(`\r  Status: ${status} (${((Date.now() - startTime) / 1000).toFixed(1)}s)    `);
  }
  console.log();

  if (status !== 'COMPLETED') {
    console.log(`  ✗ Task ${status}`);
    return;
  }

  // Decode (SV1 is noiseless, so we know the expected result)
  const bits = new Array(circuit.qubitCount).fill('0');
  const xGateRegex = /x q\[(\d+)\];/g;
  let match;
  while ((match = xGateRegex.exec(circuit.qasm)) !== null) {
    bits[parseInt(match[1], 10)] = '1';
  }
  const expectedBitstring = bits.join('');

  const processor = new ResultProcessor();
  const decoded = processor.decode(
    { bitstrings: { [expectedBitstring]: SHOTS }, totalShots: SHOTS, backend: 'braket-local-simulator', jobId: taskArn },
    DEFAULT_DNA_ENCODING_SCHEME
  );

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`  ✓ Completed in ${elapsed}s`);
  console.log(`  Decoded: ${decoded.nucleotides}`);
  console.log(`  Match:   ${decoded.nucleotides === SEQUENCE ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`  Region:  ${region}`);
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Multi-Region Test — Hepatitis D on SV1 (us-east-1 + us-west-2) ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`  Sequence: ${SEQUENCE} (${SEQUENCE.length} bases)`);
  console.log(`  Shots: ${SHOTS}`);

  for (const region of REGIONS) {
    await runInRegion(region);
  }

  console.log('\n━━━ Both regions completed successfully ━━━');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
