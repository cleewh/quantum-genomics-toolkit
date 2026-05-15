# Implementation Plan: Quantum Genomics Toolkit

## Overview

This plan implements the Quantum Genomics Toolkit as an extension to the existing Quantum Genomics Encoding Pipeline. The implementation proceeds bottom-up: shared utilities and data models first, then core algorithm components (Cost Estimator, Genome Analyzer, SWAP Test, Grover Search, Noise Benchmarker), followed by the CLI layer, and finally the CDK infrastructure stack. Each component builds on the previous, with property-based tests validating correctness properties from the design document.

## Tasks

- [x] 1. Set up toolkit project structure and shared data models
  - [x] 1.1 Create toolkit directory structure and extended backend configuration
    - Create `src/toolkit/` directory with subdirectories: `cost-estimator/`, `genome-analyzer/`, `swap-test/`, `grover-search/`, `noise-benchmarker/`, `cli/`, `validators/`
    - Create `src/toolkit/types.ts` with all shared interfaces: `ExtendedBackendId`, `ExtendedBackendConfig`, `EXTENDED_BACKENDS` constant, `QubitRequirement`, `QUBIT_REQUIREMENTS`, `ToolkitError`, `CostEstimate`, `CostBreakdown`, `CostableOperation`
    - Create `src/toolkit/index.ts` barrel export
    - _Requirements: 1.2, 2.6, 3.6, 7.5, 8.1_

  - [x] 1.2 Implement per-operation qubit limit enforcer
    - Create `src/toolkit/qubit-limits.ts` with a `QubitLimitEnforcer` class
    - Implement `enforce(operation, sequenceLength, backend)` that checks if the qubit requirement exceeds backend capacity
    - Implement `getMaxSequenceLength(operation, backend)` that returns the maximum allowed sequence length
    - Support all three operations: encode (2N), swap-test (4N+1), grover-search (2N+⌈log₂N⌉)
    - _Requirements: 1.2, 2.6, 2.7, 3.6, 7.5_

  - [ ]* 1.3 Write property tests for qubit limit enforcer
    - **Property 2: Per-Operation Qubit Limit Enforcement**
    - **Validates: Requirements 1.2, 2.6, 2.7, 3.6, 7.5**

  - [x] 1.4 Implement FASTA validator for toolkit
    - Create `src/toolkit/validators/fasta-validator.ts`
    - Implement file extension validation (.fa, .fasta only)
    - Implement format validation (header line starting with ">", valid sequence lines)
    - Implement ambiguous code detection (N, R, Y, etc.) with position reporting
    - Implement per-backend sequence length validation using QubitLimitEnforcer
    - Return structured `FastaValidationResult` with detailed error information
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ]* 1.5 Write property tests for FASTA validator
    - **Property 18: FASTA Validation Rejects Invalid Input**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4**

- [x] 2. Implement Cost Estimator
  - [x] 2.1 Create Cost Estimator component
    - Create `src/toolkit/cost-estimator/cost-estimator.ts`
    - Implement `estimate(operation: CostableOperation): CostEstimate` using pricing model: QPU = (costPerTask × circuitCount) + (costPerShot × shots × circuitCount); Simulator = costPerMinute × estimatedMinutes
    - Implement `formatEstimate(estimate: CostEstimate): string` that includes shots, backend name, and estimated execution time
    - Implement `isFreeBackend(backend: BackendId): boolean`
    - Create `src/toolkit/cost-estimator/index.ts` barrel export
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [ ]* 2.2 Write property tests for Cost Estimator
    - **Property 15: Cost Estimation Matches Pricing Model**
    - **Property 16: Free Backend Always Reports Zero Cost**
    - **Property 17: Cost Display Contains Required Fields**
    - **Validates: Requirements 8.1, 8.3, 8.4, 1.6, 2.10, 3.10**

- [x] 3. Implement Genome Analyzer
  - [x] 3.1 Create Genome Analyzer component
    - Create `src/toolkit/genome-analyzer/genome-analyzer.ts`
    - Implement `analyze(fastaPath, config)` that orchestrates: FASTA validation → sequence parsing → qubit limit check → optional partitioning → encoding → transpilation → execution → decoding → report generation
    - Integrate with existing `SequenceValidator`, `EncodingEngine`, `QubitBudgetAnalyzer`, `GenomeCompressor`, `CircuitTranspiler`, `ResultProcessor`
    - Implement automatic partitioning when sequence exceeds backend maximum (10-nucleotide overlap)
    - Generate `GenomeAnalysisResult` with decoded sequence, per-base confidence, circuit metadata
    - Integrate `CostEstimator` for paid backend cost display before execution
    - Create `src/toolkit/genome-analyzer/index.ts` barrel export
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

  - [ ]* 3.2 Write property tests for encode/decode round-trip
    - **Property 1: Encode/Decode Round-Trip on Noiseless Simulator**
    - **Validates: Requirements 1.7, 4.9**

  - [ ]* 3.3 Write property tests for partitioning
    - **Property 3: Partitioning Produces Valid Segments**
    - **Validates: Requirements 1.3**

- [x] 4. Implement SWAP Test Comparator
  - [x] 4.1 Create SWAP Test Comparator component
    - Create `src/toolkit/swap-test/swap-test-comparator.ts`
    - Implement `compare(fastaPathA, fastaPathB, config)` that orchestrates: validate both FASTA files → check equal length → enforce qubit limits → encode both sequences → build SWAP test circuit → execute → calculate similarity
    - Implement `buildSwapTestCircuit(seqA, seqB, scheme)` that constructs the ancilla-based destructive SWAP test circuit (4N+1 qubits): H on ancilla → controlled-SWAP gates → H on ancilla → measure ancilla
    - Implement `calculateSimilarity(measurements, totalShots)` using formula: similarity = 2·P(|0⟩) - 1
    - Enforce equal-length requirement with descriptive error including both lengths
    - Integrate `CostEstimator` for paid backend cost display
    - Create `src/toolkit/swap-test/index.ts` barrel export
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10_

  - [ ]* 4.2 Write property tests for SWAP test circuit construction
    - **Property 4: SWAP Test Circuit Qubit Count**
    - **Property 6: SWAP Test Equal-Length Enforcement**
    - **Validates: Requirements 2.2, 2.4, 2.5**

  - [ ]* 4.3 Write property tests for similarity score calculation
    - **Property 5: Similarity Score Range Invariant**
    - **Property 7: Identical Sequences Produce High Similarity**
    - **Property 8: Maximally Different Sequences Produce Low Similarity**
    - **Validates: Requirements 2.3, 2.8, 2.9**

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement Grover Search Engine
  - [x] 6.1 Create Grover Search Engine component
    - Create `src/toolkit/grover-search/grover-search-engine.ts`
    - Implement `search(fastaPath, motif, config)` that orchestrates: validate FASTA → validate motif characters → enforce motif < sequence length → enforce qubit limits → encode sequence → build Grover circuit → execute → decode positions
    - Implement `buildGroverCircuit(sequence, motif, scheme)` that constructs: sequence encoding (2N qubits) + index register (⌈log₂N⌉ qubits) + Hadamard on index + Grover iterations (oracle + diffusion)
    - Implement `calculateOptimalIterations(searchSpace, expectedMatches)` using formula: round(π/4 × √(N/M))
    - Implement motif validation: accept only valid nucleotide characters, reject with error listing invalid chars and positions
    - Return empty result set with message when motif not found
    - Integrate `CostEstimator` for paid backend cost display
    - Create `src/toolkit/grover-search/index.ts` barrel export
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10_

  - [ ]* 6.2 Write property tests for Grover search validation
    - **Property 9: Motif Character Validation**
    - **Property 10: Optimal Grover Iteration Count**
    - **Property 11: Motif Length Must Be Shorter Than Sequence**
    - **Validates: Requirements 3.1, 3.2, 3.4, 3.7**

- [x] 7. Implement Noise Benchmarker
  - [x] 7.1 Create Noise Benchmarker component
    - Create `src/toolkit/noise-benchmarker/noise-benchmarker.ts`
    - Implement `run(config, onProgress?)` that iterates over all combinations of (sequenceLength × backend × shotCount), generates random sequences, encodes/decodes each, calculates fidelity, and produces the benchmark report
    - Implement `validateConfig(config)` that checks: sequence lengths within backend capacity, shot counts in [100, 10000], valid backend identifiers
    - Implement fidelity calculation: fraction of correctly decoded bases across all shots
    - Implement random nucleotide sequence generation (A, C, G, T only) for specified lengths
    - Implement progress reporting via callback with current combination and completion percentage
    - Generate recommendations: max reliable sequence length per backend where fidelity ≥ 0.7
    - Integrate `CostEstimator` for total cost estimate across all paid backend runs
    - Output report in JSON format with optional human-readable summary
    - Create `src/toolkit/noise-benchmarker/index.ts` barrel export
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10_

  - [ ]* 7.2 Write property tests for Noise Benchmarker
    - **Property 12: Benchmark Configuration Validation**
    - **Property 13: Fidelity Calculation Correctness**
    - **Property 14: Random Sequence Generation Validity**
    - **Validates: Requirements 4.2, 4.3, 4.4, 4.6**

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement CLI
  - [x] 9.1 Create CLI entry point and command structure
    - Create `src/toolkit/cli/index.ts` as the CLI entry point with Commander.js program setup
    - Configure program name (`quantum-encode`), version, description, and global options (--backend, --output, --format, --yes)
    - Add `bin` field to `package.json` pointing to the CLI entry point
    - Add `commander` to dependencies in `package.json`
    - Implement `--help` display with usage examples and `--version` display
    - Default `--backend` to `local` when not specified
    - _Requirements: 6.1, 6.7, 6.13, 6.14_

  - [x] 9.2 Implement encode command
    - Create `src/toolkit/cli/commands/encode.ts`
    - Accept FASTA file path argument and --backend option
    - Validate file exists and is readable; exit with code 1 and stderr message if not
    - Delegate to `GenomeAnalyzer.analyze()`
    - Format output as JSON or text based on --format option
    - Write to file if --output specified, otherwise stdout
    - Display cost estimate and prompt for confirmation on paid backends (skip with --yes)
    - _Requirements: 6.2, 6.8, 6.9, 6.10, 6.11, 6.12_

  - [x] 9.3 Implement compare command
    - Create `src/toolkit/cli/commands/compare.ts`
    - Accept two FASTA file path arguments and --backend option
    - Validate both files exist; exit with code 1 and stderr message if not
    - Delegate to `SwapTestComparator.compare()`
    - Format and output similarity score result
    - Display cost estimate and prompt for confirmation on paid backends (skip with --yes)
    - _Requirements: 6.3, 6.8, 6.9, 6.10, 6.11, 6.12_

  - [x] 9.4 Implement search command
    - Create `src/toolkit/cli/commands/search.ts`
    - Accept FASTA file path argument, --motif required option, and --backend option
    - Validate file exists; exit with code 1 and stderr message if not
    - Delegate to `GroverSearchEngine.search()`
    - Format and output found positions
    - Display cost estimate and prompt for confirmation on paid backends (skip with --yes)
    - _Requirements: 6.4, 6.8, 6.9, 6.10, 6.11, 6.12_

  - [x] 9.5 Implement benchmark command
    - Create `src/toolkit/cli/commands/benchmark.ts`
    - Accept --config file path OR inline options (--lengths, --backends, --shots)
    - Delegate to `NoiseBenchmarker.run()` with progress display
    - Format and output benchmark report
    - Display total cost estimate for paid backends and prompt for confirmation (skip with --yes)
    - _Requirements: 6.5, 6.10, 6.11, 6.12_

  - [x] 9.6 Implement deploy command
    - Create `src/toolkit/cli/commands/deploy.ts`
    - Accept --region, --stack-name, and --backends options
    - Invoke CDK stack deployment programmatically
    - Display deployment progress and output stack outputs (API endpoint, S3 bucket, state machine ARN)
    - _Requirements: 6.6_

  - [ ]* 9.7 Write property tests for CLI
    - **Property 19: CLI Default Backend Selection**
    - **Property 20: CLI JSON Output Validity**
    - **Validates: Requirements 6.7, 6.12**

  - [ ]* 9.8 Write unit tests for CLI commands
    - Test command parsing for all commands (encode, compare, search, benchmark, deploy)
    - Test file-not-found error handling with correct exit codes
    - Test cost confirmation flow (accept/decline)
    - Test --output file writing
    - Test --format json vs text output
    - Test --help and --version display
    - _Requirements: 6.1, 6.8, 6.11, 6.12, 6.13, 6.14_

- [x] 10. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Implement CDK Infrastructure Stack
  - [x] 11.1 Create CDK stack with API Gateway and Lambda functions
    - Create `infra/` directory at project root
    - Create `infra/lib/quantum-genomics-stack.ts` with the CDK stack class
    - Define API Gateway REST API with endpoints: POST /encode, POST /compare, POST /search, POST /benchmark
    - Define Lambda functions for each endpoint with appropriate memory (1024MB) and timeout (5 min) configurations
    - Bundle toolkit code into Lambda handlers
    - _Requirements: 5.1, 5.2_

  - [x] 11.2 Add Step Functions, S3, and Braket integration
    - Define Step Functions state machine for multi-step pipeline workflow: validate → encode → transpile → execute → decode
    - Define S3 bucket with server-side encryption (AES-256) for input files, intermediate circuits, and output results
    - Configure Braket integration for quantum job submission to simulator and QPU backends
    - _Requirements: 5.3, 5.4, 5.6_

  - [x] 11.3 Configure IAM roles, tagging, parameters, and outputs
    - Configure least-privilege IAM roles: Lambda execution role (S3 read/write, Step Functions start, Braket submit), Step Functions role (Lambda invoke, Braket access), Braket access role
    - Accept deployment parameters: AWS region, stack name, allowed backend list
    - Tag all resources with project name, environment, and cost-allocation tags
    - Define stack outputs: API Gateway endpoint URL, S3 bucket name, Step Functions state machine ARN
    - Handle deployment errors with descriptive messages including CloudFormation failure reason
    - _Requirements: 5.5, 5.7, 5.8, 5.9, 5.10_

  - [ ]* 11.4 Write CDK assertion tests
    - Test stack synthesizes without errors
    - Test API Gateway has correct endpoints (encode, compare, search, benchmark)
    - Test Lambda functions have correct memory and timeout
    - Test S3 bucket has encryption enabled
    - Test IAM roles follow least-privilege (no wildcard actions)
    - Test all resources are tagged
    - Test stack outputs are defined (API endpoint, S3 bucket, state machine ARN)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.9, 5.10_

- [x] 12. Integration wiring and final validation
  - [x] 12.1 Wire all toolkit components together with barrel exports
    - Update `src/toolkit/index.ts` to export all components: GenomeAnalyzer, SwapTestComparator, GroverSearchEngine, NoiseBenchmarker, CostEstimator, QubitLimitEnforcer, FastaValidator
    - Update `src/index.ts` to re-export toolkit module
    - Ensure CLI commands correctly import and instantiate all components
    - Verify all cross-component dependencies resolve correctly
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 6.1_

  - [ ]* 12.2 Write integration tests
    - Test full encode flow: FASTA file → GenomeAnalyzer → decoded result with confidence scores
    - Test full compare flow: two FASTA files → SwapTestComparator → similarity score
    - Test full search flow: FASTA file + motif → GroverSearchEngine → positions
    - Test full benchmark flow: config → NoiseBenchmarker → fidelity report
    - All integration tests use local simulator backend
    - _Requirements: 1.1, 2.1, 3.1, 4.1_

- [x] 13. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate the 20 universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The implementation reuses existing pipeline components (EncodingEngine, CircuitTranspiler, SequenceValidator, etc.) rather than reimplementing them
- TypeScript is used throughout, matching the existing codebase
- Testing uses vitest + fast-check, matching existing project configuration
