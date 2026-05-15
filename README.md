# Quantum Genomics Toolkit

Encode, compare, and search DNA/RNA sequences using quantum circuits on AWS. Built on Amazon Braket with support for IonQ and Rigetti quantum processors.

## What it does

This toolkit encodes nucleotide sequences (A, C, G, T/U) into quantum circuit representations and executes them on quantum hardware or simulators. It implements the same class of experiment performed by the Wellcome Sanger Institute when they loaded the Hepatitis D virus genome onto IBM's quantum computer — but running on AWS infrastructure.

### Capabilities

| Feature | Description | Command |
|---------|-------------|---------|
| **Encode** | Encode a FASTA genome into quantum circuits, execute, and decode | `quantum-encode encode genome.fasta` |
| **Compare** | Measure similarity between two sequences using quantum SWAP test | `quantum-encode compare a.fasta b.fasta` |
| **Search** | Find DNA motifs using Grover's algorithm (quadratic speedup) | `quantum-encode search genome.fasta --motif GGCC` |
| **Benchmark** | Test encoding fidelity across configurations | `quantum-encode benchmark --lengths 2,4,8,12` |
| **Deploy** | Deploy as a managed AWS service (API Gateway + Lambda + Braket) | `quantum-encode deploy` |

### Supported Backends

| Backend | Type | Qubits | Cost | Max bases (encode) |
|---------|------|--------|------|-------------------|
| Local Simulator | Local | 34 | Free | 17 |
| SV1 | Cloud simulator | 34* | ~$0.075/min | 17 |
| DM1 | Cloud simulator (noisy) | 17 | ~$0.075/min | 8 |
| IonQ Forte | QPU (trapped ion) | 36 | $0.30 + $0.01/shot | 18 |
| Rigetti Cepheus-1 | QPU (superconducting) | 108 | $0.30 + $0.01/shot | 54 |

*SV1 can simulate more qubits but cost scales with complexity.

For sequences exceeding backend limits, automatic partitioning splits the genome into overlapping segments.

## Quick Start

```bash
# Install dependencies
npm install

# Encode a genome (free, runs locally)
npx tsx src/toolkit/cli/index.ts encode your-genome.fasta

# Encode on AWS SV1 simulator (~$0.01)
npx tsx src/toolkit/cli/index.ts encode your-genome.fasta --backend sv1 --yes

# Compare two sequences
npx tsx src/toolkit/cli/index.ts compare variant1.fasta variant2.fasta

# Search for a motif
npx tsx src/toolkit/cli/index.ts search genome.fasta --motif GGCC

# Run noise benchmark
npx tsx src/toolkit/cli/index.ts benchmark --lengths 2,4,8,12 --backends local

# Output as JSON
npx tsx src/toolkit/cli/index.ts encode genome.fasta --format json --output results.json
```

## CLI Options

```
Global Options:
  --backend <name>    Backend: local, sv1, dm1, ionq, rigetti (default: local)
  --region <region>   AWS region override (defaults to AWS_REGION or ~/.aws/config)
  --output <file>     Write output to file instead of stdout
  --format <type>     Output format: json or text (default: text)
  --yes               Skip cost confirmation for paid backends
  --version           Display version
  --help              Display help
```

## Per-Operation Limits

Different quantum algorithms require different numbers of qubits:

| Operation | Formula | Local (34q) | IonQ (36q) | Rigetti (108q) |
|-----------|---------|-------------|------------|----------------|
| Encode | 2N | 17 bases | 18 bases | 54 bases |
| SWAP test (per seq) | 4N+1 | 8 bases | 8 bases | 26 bases |
| Grover search | 2N+⌈log₂N⌉ | 14 bases | 15 bases | 50 bases |

Sequences exceeding the encode limit are automatically partitioned. SWAP test and Grover search require the full sequence in one circuit.

## Architecture

```
FASTA file → Parse → Encode (2 qubits/base) → Transpile → Execute → Decode → Report
                                                   ↓
                                          Amazon Braket (SV1/DM1/IonQ/Rigetti)
```

### Encoding Scheme

Each nucleotide maps to a 2-qubit computational basis state:
- A → |00⟩
- C → |01⟩
- G → |10⟩
- T/U → |11⟩

The circuit applies X gates to flip qubits from |0⟩ to |1⟩ where needed.

### Components

- **SequenceValidator** — Parses FASTA/FASTQ/GenBank files
- **EncodingEngine** — Maps nucleotides to quantum circuits (OpenQASM 3.0)
- **CircuitTranspiler** — Adapts circuits to IonQ (GPi/GPi2/MS) or Rigetti (RX/RZ/CZ) native gates
- **GenomeCompressor** — Partitions large genomes with overlapping segments
- **ResultProcessor** — Decodes measurements with majority-vote confidence scoring
- **CostEstimator** — Calculates costs before paid execution
- **SwapTestComparator** — Quantum sequence similarity measurement
- **GroverSearchEngine** — Motif finding with quadratic speedup
- **NoiseBenchmarker** — Systematic fidelity testing

## AWS Setup

### Prerequisites

- Node.js 18+
- AWS credentials configured (`aws configure` or environment variables)
- Amazon Braket service role (auto-created on first use or via console)

### Region Configuration

The toolkit uses standard AWS SDK region resolution:
1. `--region` flag (explicit override)
2. `AWS_REGION` environment variable
3. `~/.aws/config` profile region
4. Falls back to `us-east-1`

### Braket Service Role

If you get a service role error on first run:
```bash
aws iam create-service-linked-role --aws-service-name braket.amazonaws.com
```

## Deploy as a Service

The `infra/` directory contains an AWS CDK stack that deploys the pipeline as a managed service:

```bash
cd infra
npm install
cdk deploy --context region=us-east-1 --context stackName=quantum-genomics
```

This creates:
- API Gateway REST API (POST /encode, /compare, /search, /benchmark)
- Lambda functions for each endpoint
- Step Functions state machine (validate → encode → transpile → execute → decode)
- S3 bucket with encryption for pipeline data
- IAM roles with least-privilege permissions

## Testing

```bash
# Run all tests (522 tests)
npm test

# Run specific test suites
npx vitest run tests/toolkit/          # Toolkit tests (232)
npx vitest run tests/encoding/         # Encoding engine tests (69)
npx vitest run tests/transpiler/       # Transpiler tests (42)
npx vitest run tests/orchestrator/     # Orchestrator tests (66)
```

## Proven Results

Successfully tested on AWS:

| Test | Backend | Region | Result |
|------|---------|--------|--------|
| "ACGT" (4 bases) | SV1 | us-east-1 | ✓ 100% fidelity, 2.4s |
| Hep D fragment (17 bases) | SV1 | us-east-1 | ✓ 100% fidelity, ~3 min |
| Hep D fragment (8 bases, noisy) | DM1 | us-east-1 | ✓ 96.8% correct shots, decoded perfectly |
| Hep D fragment (8 bases) | SV1 | us-west-2 | ✓ 100% fidelity, 2.4s |
| Hep D fragment (84 bases, partitioned) | Local | — | ✓ 11 segments, round-trip PASS |

## Cost Guide

| Use case | Backend | Estimated cost |
|----------|---------|---------------|
| Development/testing | Local | Free |
| Validation (noiseless) | SV1 | ~$0.01 per run |
| Noise characterization | DM1 | ~$0.01 per run |
| Real QPU (small genome) | IonQ | ~$10.30 per run |
| Full Hep D genome (1,700 bases) | SV1 | ~$0.40 |
| Full Hep D genome (1,700 bases) | IonQ | ~$2,183 |

## License

MIT
