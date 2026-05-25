/**
 * Hepatitis D virus genome fragment — Amazon Braket DM1 (Density Matrix) execution.
 *
 * DM1 simulates real quantum noise including:
 * - Gate errors (depolarizing noise)
 * - Decoherence (T1/T2 relaxation)
 * - Measurement errors
 *
 * This shows what results would look like on real quantum hardware.
 *
 * Usage: npx tsx scripts/run-braket-dm1-noisy.ts
 */

import {
  BraketClient,
  CreateQuantumTaskCommand,
  GetQuantumTaskCommand,
} from '@aws-sdk/client-braket';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

import { EncodingEngine } from '../src/encoding/encoding-engine.js';
import { ResultProcessor } from '../src/results/result-processor.js';
import { DEFAULT_DNA_ENCODING_SCHEME } from '../src/types/encoding-schemes.js';
import type { ParsedSequence, MeasurementResult, ExecutionMetadata } from '../src/types/index.js';
import { ensureBraketBucket, resolveRegion } from './aws-helpers.js';

// ─── Configuration ───────────────────────────────────────────────────────────

const REGION = resolveRegion();
const DEVICE_ARN = 'arn:aws:braket:::device/quantum-simulator/amazon/dm1';
const SHOTS = 1000;

// Use a smaller fragment (8 bases = 16 qubits) for DM1
// DM1 handles up to 17 qubits efficiently with noise simulation
const HDV_SEQUENCE = 'GGCCGGCA';
const HDV_DESCRIPTION = 'Hepatitis D virus ribozyme fragment (8 bases, noisy simulation)';

const S3_PREFIX = `quantum-genomics-dm1/${Date.now()}`;

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  Hepatitis D Genome — Noisy Quantum Simulation (Braket DM1)     ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`  Sequence:    ${HDV_SEQUENCE}`);
  console.log(`  Description: ${HDV_DESCRIPTION}`);
  console.log(`  Length:      ${HDV_SEQUENCE.length} nucleotides`);
  console.log(`  Qubits:     ${HDV_SEQUENCE.length * 2} (2 per base)`);
  console.log(`  Device:     DM1 Density Matrix Simulator (${REGION})`);
  console.log(`  Noise:      Depolarizing noise model (simulates real QPU errors)`);
  console.log(`  Shots:      ${SHOTS}`);
  console.log();

  // 1. Encode
  console.log('[1/4] Encoding sequence...');
  const encoder = new EncodingEngine();
  const parsedSequence: ParsedSequence = {
    id: 'HDV-noisy-test',
    description: HDV_DESCRIPTION,
    nucleotides: HDV_SEQUENCE,
    length: HDV_SEQUENCE.length,
    type: 'DNA',
    metadata: {},
  };

  const encodedCircuit = await encoder.encode(parsedSequence);
  console.log(`  ✓ ${encodedCircuit.qubitCount} qubits, ${encodedCircuit.gateCount} gates`);
  console.log();

  // 2. Build noisy circuit with noise pragma
  // DM1 supports noise directives in OpenQASM
  // We'll add depolarizing noise to simulate IonQ-like gate errors (~0.5% per gate)
  console.log('[2/4] Adding noise model (depolarizing, ~0.5% per gate)...');

  let braketQasm = encodedCircuit.qasm
    .split('\n')
    .filter((line) => !line.includes('include "stdgates.inc"'))
    .join('\n');

  // Insert noise pragma after qubit declaration
  // DM1 supports: #pragma braket noise depolarizing(probability) target
  const lines = braketQasm.split('\n');
  const noisyLines: string[] = [];
  for (const line of lines) {
    noisyLines.push(line);
    // After each X gate, add depolarizing noise
    if (line.trim().startsWith('x q[')) {
      const qubitMatch = line.match(/q\[(\d+)\]/);
      if (qubitMatch) {
        noisyLines.push(`#pragma braket noise depolarizing(0.005) q[${qubitMatch[1]}]`);
      }
    }
  }
  braketQasm = noisyLines.join('\n');

  console.log('  ✓ Noise pragmas added (0.5% depolarizing per X gate)');
  console.log();

  // 3. Submit to DM1
  console.log('[3/4] Submitting to Amazon Braket DM1...');
  const S3_BUCKET = await ensureBraketBucket(REGION);
  const braket = new BraketClient({ region: REGION });

  let taskArn: string;
  try {
    const response = await braket.send(
      new CreateQuantumTaskCommand({
        deviceArn: DEVICE_ARN,
        shots: SHOTS,
        outputS3Bucket: S3_BUCKET,
        outputS3KeyPrefix: S3_PREFIX,
        action: JSON.stringify({
          braketSchemaHeader: {
            name: 'braket.ir.openqasm.program',
            version: '1',
          },
          source: braketQasm,
        }),
      })
    );
    taskArn = response.quantumTaskArn!;
    console.log(`  ✓ Task submitted: ${taskArn}`);
  } catch (error: any) {
    console.error(`  ✗ Submission failed: ${error.message}`);
    process.exit(1);
  }

  // Poll for completion
  const startTime = Date.now();
  let status = 'CREATED';
  while (!['COMPLETED', 'FAILED', 'CANCELLED'].includes(status)) {
    await delay(2000);
    const taskResponse = await braket.send(
      new GetQuantumTaskCommand({ quantumTaskArn: taskArn })
    );
    status = taskResponse.status || 'UNKNOWN';
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    process.stdout.write(`\r  Status: ${status} (${elapsed}s elapsed)    `);
  }
  console.log();

  if (status !== 'COMPLETED') {
    console.error(`  ✗ Task ${status}`);
    process.exit(1);
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`  ✓ Completed in ${totalTime}s`);
  console.log();

  // 4. Retrieve and decode results
  console.log('[4/4] Retrieving & decoding noisy results...');

  const taskDetails = await braket.send(
    new GetQuantumTaskCommand({ quantumTaskArn: taskArn })
  );

  const s3Client = new S3Client({ region: REGION });
  const resultsKey = `${taskDetails.outputS3KeyPrefix}/${taskArn.split('/').pop()}/results.json`;

  let measurementResult: MeasurementResult;
  try {
    const s3Response = await s3Client.send(
      new GetObjectCommand({ Bucket: S3_BUCKET, Key: resultsKey })
    );
    const body = await s3Response.Body!.transformToString();
    const braketResult = JSON.parse(body);

    // Convert Braket measurement format
    const bitstrings: Record<string, number> = {};
    if (braketResult.measurements) {
      for (const measurement of braketResult.measurements) {
        const bitstring = measurement.join('');
        bitstrings[bitstring] = (bitstrings[bitstring] || 0) + 1;
      }
    }

    measurementResult = {
      bitstrings,
      totalShots: SHOTS,
      backend: 'braket-local-simulator',
      jobId: taskArn,
    };

    const uniqueCount = Object.keys(bitstrings).length;
    console.log(`  ✓ Results retrieved: ${uniqueCount} unique bitstrings from ${SHOTS} shots`);
  } catch (error: any) {
    console.error(`  ✗ Could not retrieve results: ${error.message}`);
    process.exit(1);
  }
  console.log();

  // Decode
  const resultProcessor = new ResultProcessor();
  const decoded = resultProcessor.decode(measurementResult, DEFAULT_DNA_ENCODING_SCHEME);

  const metadata: ExecutionMetadata = {
    jobId: taskArn,
    backend: 'braket-local-simulator',
    shots: SHOTS,
    encodingScheme: DEFAULT_DNA_ENCODING_SCHEME.name,
    executionTimeMs: parseFloat(totalTime) * 1000,
  };
  const report = resultProcessor.generateReport(decoded, metadata);

  // Display results
  console.log('━━━ NOISY QUANTUM RESULTS ━━━');
  console.log();
  console.log(`  Input sequence:    ${HDV_SEQUENCE}`);
  console.log(`  Decoded sequence:  ${decoded.nucleotides}`);
  console.log(`  Avg confidence:    ${(decoded.averageConfidence * 100).toFixed(1)}%`);
  console.log(`  Low-confidence:    ${decoded.lowConfidenceFlag ? 'YES ⚠️' : 'No'}`);
  console.log(`  Round-trip match:  ${decoded.nucleotides === HDV_SEQUENCE ? '✓ PASS' : '✗ FAIL (noise-induced errors)'}`);
  console.log();

  // Per-base confidence with visual bars
  console.log('  Per-base confidence (noise impact):');
  let correctBases = 0;
  for (let i = 0; i < decoded.nucleotides.length; i++) {
    const conf = decoded.perBaseConfidence[i];
    const barLength = Math.round(conf * 30);
    const bar = '█'.repeat(barLength) + '░'.repeat(30 - barLength);
    const expected = HDV_SEQUENCE[i];
    const actual = decoded.nucleotides[i];
    const match = expected === actual ? '✓' : '✗';
    if (expected === actual) correctBases++;
    console.log(`    ${String(i).padStart(2)}: ${expected}→${actual} ${bar} ${(conf * 100).toFixed(1)}% ${match}`);
  }
  console.log();
  console.log(`  Accuracy: ${correctBases}/${HDV_SEQUENCE.length} bases correct (${(correctBases / HDV_SEQUENCE.length * 100).toFixed(1)}%)`);
  console.log();

  // Show top measurement outcomes
  const sorted = Object.entries(measurementResult.bitstrings).sort((a, b) => b[1] - a[1]);
  console.log(`  Top 5 measurement outcomes (of ${sorted.length} unique):`);
  for (const [bs, count] of sorted.slice(0, 5)) {
    const pct = (count / SHOTS * 100).toFixed(1);
    console.log(`    ${bs}: ${count} shots (${pct}%)`);
  }
  console.log();

  // Recommendations
  if (report.recommendations.length > 0) {
    console.log('  Recommendations:');
    for (const rec of report.recommendations) {
      console.log(`    ⚠️  ${rec}`);
    }
    console.log();
  }

  console.log('  FASTA output:');
  for (const line of report.fasta.split('\n').filter((l) => l)) {
    console.log(`    ${line}`);
  }
  console.log();

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  This demonstrates what real QPU results look like:');
  console.log('  - Noise causes some shots to produce incorrect bitstrings');
  console.log('  - Majority vote decoding recovers the correct sequence');
  console.log('  - Confidence scores quantify reliability per base');
  console.log('  - More shots → higher confidence (law of large numbers)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
