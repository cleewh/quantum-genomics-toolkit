#!/usr/bin/env node
/**
 * Quantum Genomics Toolkit CLI.
 *
 * npx-executable command-line interface wrapping all toolkit operations.
 * Usage: quantum-encode <command> [options]
 *
 * Commands:
 *   encode <fasta-file>              Encode a FASTA file into a quantum circuit
 *   compare <fasta-a> <fasta-b>      Compare two sequences using SWAP test
 *   search <fasta-file> --motif <p>  Search for a motif using Grover's algorithm
 *   benchmark                        Run noise benchmarking
 *
 * Global Options:
 *   --backend <name>   Backend to use (local, sv1, dm1, ionq, rigetti) [default: local]
 *   --output <file>    Write output to file instead of stdout
 *   --format <type>    Output format: json or text [default: text]
 *   --yes              Skip cost confirmation for paid backends
 *   --version          Display version
 *   --help             Display help
 */

import { Command } from 'commander';
import { registerEncodeCommand } from './commands/encode.js';
import { registerCompareCommand } from './commands/compare.js';
import { registerSearchCommand } from './commands/search.js';
import { registerBenchmarkCommand } from './commands/benchmark.js';
import { registerDeployCommand } from './commands/deploy.js';

const program = new Command();

program
  .name('quantum-encode')
  .version('0.1.0')
  .description('Quantum Genomics Toolkit - Encode, compare, search, and benchmark genomic sequences using quantum circuits')
  .option('--backend <name>', 'Backend to use (local, sv1, dm1, ionq, rigetti)', 'local')
  .option('--region <region>', 'AWS region override (defaults to AWS_REGION env var or ~/.aws/config)')
  .option('--output <file>', 'Write output to file instead of stdout')
  .option('--format <type>', 'Output format: json or text', 'text')
  .option('--yes', 'Skip cost confirmation for paid backends', false);

// Register commands
registerEncodeCommand(program);
registerCompareCommand(program);
registerSearchCommand(program);
registerBenchmarkCommand(program);
registerDeployCommand(program);

// Parse and execute
program.parse(process.argv);
