# Requirements Document

## Introduction

The Quantum Genomics Toolkit extends the existing Quantum Genomics Encoding Pipeline with six core capabilities: single genome encoding and analysis, quantum sequence comparison (SWAP test), Grover's search for motif finding, noise benchmarking, AWS CDK deployment infrastructure, and a CLI tool. The toolkit accepts FASTA files as input, enforces per-backend and per-operation sequence length limits, provides cost estimates before QPU submission, and supports both local simulator (free) and cloud backends (paid). It builds on the existing encoding, transpilation, and execution infrastructure.

## Glossary

- **Toolkit**: The collection of capabilities extending the existing Quantum Genomics Encoding Pipeline
- **Genome_Analyzer**: The component that encodes a single genome into a quantum circuit, executes it, and decodes the results with confidence scoring
- **SWAP_Test_Comparator**: The component that encodes two sequences and measures their quantum similarity using a SWAP test circuit
- **Grover_Search_Engine**: The component that uses Grover's algorithm to locate a DNA motif within an encoded sequence
- **Noise_Benchmarker**: The component that systematically tests encoding fidelity across sequence lengths, gate counts, and backends to produce a quantum readiness report
- **CDK_Stack**: The AWS CDK infrastructure-as-code that deploys the pipeline as a managed service (API Gateway, Lambda, Step Functions, S3, Braket)
- **CLI**: The command-line interface that packages all pipeline and toolkit capabilities as an npx-executable tool
- **SWAP_Test**: A quantum circuit technique that measures the overlap (similarity) between two quantum states without fully decoding them
- **Grover_Oracle**: A quantum circuit component that marks target states (motif positions) for amplitude amplification
- **Fidelity**: The degree to which quantum measurement results match the expected ideal output, expressed as a value between 0 and 1
- **Similarity_Score**: A value between 0 and 1 produced by the SWAP test, where 1 indicates identical sequences and 0 indicates maximally different sequences
- **Motif**: A short DNA subsequence pattern (e.g., "GGCC") to search for within a larger sequence
- **Cost_Estimator**: The component that calculates and displays estimated costs before submitting jobs to paid quantum backends
- **Backend**: A quantum execution target — Local Simulator (34q, free), SV1 cloud simulator (unlimited, $0.075/min), DM1 noise simulator (17q, $0.075/min), IonQ Forte Enterprise (36q QPU), or Rigetti Cepheus-1 (108q QPU)

## Per-Operation Maximum Sequence Lengths

The maximum number of nucleotides per operation depends on the backend's qubit count and the qubit requirements of each algorithm:

### Available Backends

| Backend | Type | Qubits | Cost | Region |
|---------|------|--------|------|--------|
| Local Simulator | Local (free) | 34 | Free | Local machine |
| SV1 (State Vector) | Cloud simulator | Unlimited* | $0.075/min | us-east-1 |
| DM1 (Density Matrix) | Cloud simulator (noisy) | 17 | $0.075/min | us-east-1 |
| IonQ Forte Enterprise | QPU (trapped ion) | 36 | $0.30/task + $0.01/shot | us-east-1 |
| Rigetti Cepheus-1 | QPU (superconducting) | 108 | $0.30/task + $0.01/shot | us-west-1 |

*SV1 can simulate any qubit count but cost scales exponentially with qubits. Practical limit ~34 qubits for fast execution.

### Per-Operation Limits (without partitioning)

| Operation | Qubit Formula | Local (34q) | DM1 (17q) | IonQ (36q) | Rigetti (108q) | SV1 (unlimited) |
|-----------|--------------|-------------|-----------|------------|----------------|-----------------|
| Single genome encode | 2N | 17 bases | 8 bases | 18 bases | 54 bases | No limit* |
| SWAP test (per sequence) | 4N + 1 | 8 bases | 4 bases | 8 bases | 26 bases | No limit* |
| Grover's motif search | 2N + log₂(N) | 14 bases | 6 bases | 15 bases | 50 bases | No limit* |

*SV1 has no qubit limit but execution time and cost grow exponentially. Recommended max: 17 bases for fast results.

### With Partitioning (single genome encode only)

Partitioning splits sequences into overlapping segments (10-nucleotide overlap). There is no hard maximum — any length genome can be encoded. Cost and time scale linearly with segment count.

| Backend | Bases/segment | Step size | Soft limit (cost warning) |
|---------|--------------|-----------|---------------------------|
| Local Simulator | 17 | 7 | Unlimited (free) |
| SV1 | 17 | 7 | 1,700 bases (~$0.40) |
| DM1 | 8 | N/A (too small for practical partitioning) | 8 bases (no partitioning) |
| IonQ Forte | 18 | 8 | 500 bases (~$1,100 on QPU) |
| Rigetti Cepheus-1 | 54 | 44 | 500 bases (~$200 on QPU) |

Note: SWAP test and Grover's search do NOT support partitioning — they require the full sequence in a single circuit.

## Requirements

### Requirement 1: Single Genome Encoding and Analysis

**User Story:** As a researcher, I want to encode a single genome from a FASTA file into a quantum circuit, execute it, and receive a decoded result with confidence scoring, so that I can verify quantum encoding fidelity for my sequence.

#### Acceptance Criteria

1. WHEN a valid FASTA file is provided, THE Genome_Analyzer SHALL parse, encode, transpile, execute, and decode the sequence through the full pipeline
2. THE Genome_Analyzer SHALL enforce the maximum sequence length per Backend (IonQ: 18 bases, Rigetti: 54 bases, Local Simulator: 17 bases) for direct encoding
3. WHEN the input sequence exceeds the Backend maximum, THE Genome_Analyzer SHALL automatically partition the genome into overlapping segments and process each segment independently
4. WHEN execution completes, THE Genome_Analyzer SHALL produce a report containing: the decoded sequence, per-base confidence scores, average confidence, FASTA output, and circuit metadata (qubit count, gate count, depth)
5. THE Genome_Analyzer SHALL support execution on the local simulator (free), SV1 cloud simulator, DM1 noise simulator, and QPU backends (IonQ, Rigetti) when available
6. WHEN a single genome analysis is requested on a paid Backend, THE Cost_Estimator SHALL display the estimated cost before execution and require confirmation to proceed
7. FOR ALL sequences encoded and decoded on a noiseless simulator, THE Genome_Analyzer SHALL recover the original sequence with 100% fidelity (round-trip property)

### Requirement 2: Quantum Sequence Comparison via SWAP Test

**User Story:** As a researcher, I want to compare two short DNA/RNA sequences using a quantum SWAP test, so that I can quickly determine whether two viral variants are related without full decoding.

#### Acceptance Criteria

1. WHEN two valid FASTA files are provided, THE SWAP_Test_Comparator SHALL encode both sequences into quantum states using the existing Encoding_Engine
2. WHEN both sequences are encoded, THE SWAP_Test_Comparator SHALL construct a SWAP test circuit that measures the overlap between the two quantum states
3. WHEN the SWAP test circuit is executed, THE SWAP_Test_Comparator SHALL produce a Similarity_Score between 0 and 1, where 1 indicates identical sequences and 0 indicates maximally different sequences
4. THE SWAP_Test_Comparator SHALL require both input sequences to have equal length
5. IF the two input sequences have unequal lengths, THEN THE SWAP_Test_Comparator SHALL return a descriptive error indicating the length mismatch and the lengths of both sequences
6. THE SWAP_Test_Comparator SHALL enforce that each input sequence does not exceed the maximum nucleotide length for the selected Backend (IonQ: 9 bases, Rigetti: 27 bases, Local Simulator: 8 bases per sequence, since SWAP test requires 2N+1 qubits for two N-length sequences)
7. IF either input sequence exceeds the Backend maximum for SWAP test, THEN THE SWAP_Test_Comparator SHALL return an error stating the maximum allowed length for the selected Backend
8. FOR ALL pairs of identical sequences, THE SWAP_Test_Comparator SHALL produce a Similarity_Score greater than 0.9 on a noiseless simulator with at least 1000 shots
9. FOR ALL pairs of maximally different sequences (no matching bases), THE SWAP_Test_Comparator SHALL produce a Similarity_Score less than 0.5 on a noiseless simulator with at least 1000 shots
10. WHEN a SWAP test comparison is requested on a paid Backend, THE Cost_Estimator SHALL display the estimated cost before execution and require confirmation to proceed

### Requirement 3: Grover's Search for Motif Finding

**User Story:** As a researcher, I want to search for a short DNA motif within an encoded sequence using Grover's algorithm, so that I can locate pattern occurrences with quadratic speedup over classical scanning.

#### Acceptance Criteria

1. WHEN a valid FASTA file and a motif string are provided, THE Grover_Search_Engine SHALL validate that the motif contains only valid nucleotide characters (A, C, G, T for DNA; A, C, G, U for RNA)
2. IF the motif contains invalid characters, THEN THE Grover_Search_Engine SHALL return an error listing the invalid characters and their positions
3. WHEN a valid motif is provided, THE Grover_Search_Engine SHALL construct a Grover_Oracle that marks positions in the sequence where the motif occurs
4. THE Grover_Search_Engine SHALL apply the optimal number of Grover iterations (approximately π/4 × √(N/M) where N is the number of searchable positions and M is the number of matches)
5. WHEN Grover's search completes, THE Grover_Search_Engine SHALL return all positions where the motif is found within the input sequence
6. THE Grover_Search_Engine SHALL enforce that the input sequence does not exceed the maximum nucleotide length for the selected Backend
7. THE Grover_Search_Engine SHALL enforce that the motif length is shorter than the input sequence length
8. IF the motif is not found in the sequence, THEN THE Grover_Search_Engine SHALL return an empty result set with a message indicating no matches
9. FOR ALL sequences containing a known motif at known positions, THE Grover_Search_Engine SHALL identify those positions with probability greater than 0.8 on a noiseless simulator
10. WHEN a Grover's search is requested on a paid Backend, THE Cost_Estimator SHALL display the estimated cost before execution and require confirmation to proceed

### Requirement 4: Noise Benchmarking Suite

**User Story:** As a researcher, I want to systematically test encoding fidelity across different configurations, so that I can determine at what point quantum noise makes results unreliable for my use case.

#### Acceptance Criteria

1. WHEN a benchmark configuration is provided specifying sequence lengths, backends, and shot counts, THE Noise_Benchmarker SHALL execute encoding and decoding for each combination
2. THE Noise_Benchmarker SHALL accept configuration specifying one or more sequence lengths (between 2 and the Backend maximum), one or more Backend identifiers, and one or more shot counts (between 100 and 10000)
3. IF the benchmark configuration contains invalid parameters (sequence length exceeding Backend capacity, shot count out of range, unknown Backend), THEN THE Noise_Benchmarker SHALL return a descriptive error identifying each invalid parameter
4. WHEN benchmarking completes for a configuration combination, THE Noise_Benchmarker SHALL calculate the Fidelity as the fraction of correctly decoded bases across all shots
5. WHEN all benchmark runs complete, THE Noise_Benchmarker SHALL produce a report containing: Fidelity per combination, gate count per circuit, circuit depth per circuit, and a recommended maximum sequence length per Backend where Fidelity remains above 0.7
6. THE Noise_Benchmarker SHALL generate random nucleotide sequences of the specified lengths for benchmarking (not requiring user-provided FASTA files for the benchmark itself)
7. WHILE a benchmark suite is executing, THE Noise_Benchmarker SHALL report progress indicating the current combination being tested and the percentage of total combinations completed
8. WHEN a benchmark suite includes paid Backends, THE Cost_Estimator SHALL display the total estimated cost for all paid Backend runs before execution and require confirmation to proceed
9. FOR ALL benchmark runs on a noiseless simulator, THE Noise_Benchmarker SHALL report Fidelity of 1.0 (perfect reconstruction)
10. THE Noise_Benchmarker SHALL output the report in JSON format with an optional human-readable summary

### Requirement 5: AWS CDK Deployment Infrastructure

**User Story:** As a researcher, I want to deploy the quantum genomics pipeline as a managed service using infrastructure-as-code, so that I can run my own instance with a REST API.

#### Acceptance Criteria

1. THE CDK_Stack SHALL define an API Gateway REST API with endpoints for each pipeline operation (encode, compare, search, benchmark)
2. THE CDK_Stack SHALL define Lambda functions as compute handlers for each API endpoint with appropriate memory and timeout configurations
3. THE CDK_Stack SHALL define a Step Functions state machine to orchestrate multi-step pipeline workflows (validate → encode → transpile → execute → decode)
4. THE CDK_Stack SHALL define an S3 bucket for storing input files, intermediate circuits, and output results with server-side encryption enabled
5. THE CDK_Stack SHALL configure IAM roles with least-privilege permissions for each component (Lambda execution role, Step Functions role, Braket access role)
6. THE CDK_Stack SHALL define Braket integration for quantum job submission to both simulator and QPU backends
7. IF the CDK stack deployment fails, THEN THE CDK_Stack SHALL provide a descriptive error message including the CloudFormation failure reason and affected resource
8. THE CDK_Stack SHALL accept deployment parameters for: AWS region, stack name, and allowed Backend list
9. THE CDK_Stack SHALL tag all created resources with project name, environment, and cost-allocation tags
10. THE CDK_Stack SHALL output the API Gateway endpoint URL, S3 bucket name, and Step Functions state machine ARN after successful deployment

### Requirement 6: Command-Line Interface

**User Story:** As a researcher, I want to use the quantum genomics pipeline from the command line, so that I can integrate it into scripts and workflows without writing code.

#### Acceptance Criteria

1. THE CLI SHALL be executable via `npx quantum-encode` without requiring global installation
2. THE CLI SHALL provide an `encode` command that accepts a FASTA file path and a `--backend` option, and outputs the encoded quantum circuit
3. THE CLI SHALL provide a `compare` command that accepts two FASTA file paths and a `--backend` option, and outputs the Similarity_Score
4. THE CLI SHALL provide a `search` command that accepts a FASTA file path, a `--motif` option, and a `--backend` option, and outputs the positions where the motif is found
5. THE CLI SHALL provide a `benchmark` command that accepts a configuration file path or inline options (--lengths, --backends, --shots), and outputs the fidelity report
6. THE CLI SHALL provide a `deploy` command that invokes the CDK stack deployment with options for region, stack name, and backend list
7. WHEN the `--backend` option is not specified, THE CLI SHALL default to the local simulator backend
8. IF a specified FASTA file does not exist or is not readable, THEN THE CLI SHALL exit with a non-zero exit code and print an error message to stderr indicating the file path and the problem
9. IF a specified sequence exceeds the maximum length for the selected Backend, THEN THE CLI SHALL exit with a non-zero exit code and print an error message to stderr stating the maximum allowed length
10. WHEN a command targets a paid Backend, THE CLI SHALL display the estimated cost and prompt for confirmation before proceeding (skippable with a `--yes` flag)
11. THE CLI SHALL support a `--output` option to write results to a file instead of stdout
12. THE CLI SHALL support a `--format` option accepting "json" or "text" for output formatting, defaulting to "text"
13. THE CLI SHALL display a help message with usage examples when invoked with `--help` or with no arguments
14. THE CLI SHALL display version information when invoked with `--version`

### Requirement 7: FASTA File Input Validation

**User Story:** As a researcher, I want clear validation of my FASTA input files across all toolkit commands, so that I receive actionable error messages when input is malformed.

#### Acceptance Criteria

1. THE Toolkit SHALL accept only FASTA format files (with .fa or .fasta extensions) as sequence input across all commands
2. WHEN a FASTA file is provided, THE Toolkit SHALL validate that the file conforms to FASTA format (header line starting with ">", followed by sequence lines containing only valid nucleotide characters)
3. IF a non-FASTA file is provided (wrong extension or invalid format), THEN THE Toolkit SHALL return a descriptive error stating that only FASTA files are accepted and describing the format violation
4. IF a FASTA file contains ambiguous nucleotide codes (N, R, Y, etc.), THEN THE Toolkit SHALL return an error listing the unsupported characters and their positions
5. THE Toolkit SHALL enforce the maximum sequence length per Backend before attempting any quantum operation (IonQ: 18 bases, Rigetti: 54 bases, Local Simulator: 17 bases for standard encoding; reduced limits for SWAP test)

### Requirement 8: Cost Estimation and Confirmation

**User Story:** As a researcher, I want to see cost estimates before any paid quantum execution, so that I can make informed decisions about resource usage.

#### Acceptance Criteria

1. WHEN a quantum operation targets a paid Backend (IonQ Forte Enterprise or Rigetti Cepheus-1), THE Cost_Estimator SHALL calculate and display the estimated cost based on the number of shots and circuit complexity
2. THE Cost_Estimator SHALL display the cost estimate before job submission and require explicit confirmation to proceed
3. WHEN the local simulator Backend is selected, THE Cost_Estimator SHALL indicate that execution is free of charge
4. THE Cost_Estimator SHALL include the number of shots, selected Backend, and estimated execution time in the cost display
5. IF the user declines the cost confirmation, THEN THE Toolkit SHALL cancel the operation without submitting any quantum job

