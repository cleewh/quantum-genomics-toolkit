/**
 * Shared CLI utilities: file reading, output formatting, backend mapping.
 */

import { readFileSync, writeFileSync, existsSync, accessSync, constants } from 'fs';
import { ExtendedBackendId, EXTENDED_BACKENDS } from '../types.js';

// ─── Backend Name Mapping ────────────────────────────────────────────────────

/**
 * Maps short CLI backend names to ExtendedBackendId values.
 */
export const BACKEND_NAME_MAP: Record<string, ExtendedBackendId> = {
  'local': 'braket-local-simulator',
  'sv1': 'braket-sv1',
  'dm1': 'braket-dm1',
  'ionq': 'ionq-forte-enterprise',
  'rigetti': 'rigetti-cepheus-1',
};

/**
 * Resolves a CLI backend name to an ExtendedBackendId.
 * Accepts both short names (e.g., 'local') and full IDs (e.g., 'braket-local-simulator').
 */
export function resolveBackend(name: string): ExtendedBackendId {
  const lower = name.toLowerCase();
  if (BACKEND_NAME_MAP[lower]) {
    return BACKEND_NAME_MAP[lower];
  }
  // Check if it's already a valid full backend ID
  if (lower in EXTENDED_BACKENDS) {
    return lower as ExtendedBackendId;
  }
  const validNames = Object.keys(BACKEND_NAME_MAP).join(', ');
  throw new Error(`Unknown backend '${name}'. Valid backends: ${validNames}`);
}

// ─── File Utilities ──────────────────────────────────────────────────────────

/**
 * Reads a file and returns its content as a string.
 * Throws with a descriptive error if the file doesn't exist or isn't readable.
 */
export function readFastaFile(filePath: string): string {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  try {
    accessSync(filePath, constants.R_OK);
  } catch {
    throw new Error(`File not readable: ${filePath}`);
  }
  return readFileSync(filePath, 'utf-8');
}

/**
 * Extracts the filename from a file path.
 */
export function getFilename(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
}

// ─── Output Formatting ───────────────────────────────────────────────────────

export type OutputFormat = 'json' | 'text';

/**
 * Formats a result object based on the specified format.
 */
export function formatOutput(data: unknown, format: OutputFormat): string {
  if (format === 'json') {
    return JSON.stringify(data, null, 2);
  }
  // Text format: render as human-readable key-value pairs
  return formatAsText(data);
}

/**
 * Renders an object as human-readable text.
 */
function formatAsText(data: unknown, indent: number = 0): string {
  if (data === null || data === undefined) {
    return 'null';
  }
  if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
    return String(data);
  }
  if (Array.isArray(data)) {
    if (data.length === 0) return '(none)';
    return data.map((item, i) => `${' '.repeat(indent)}  ${i + 1}. ${formatAsText(item, indent + 2)}`).join('\n');
  }
  if (typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>);
    return entries
      .map(([key, value]) => {
        const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          return `${' '.repeat(indent)}${label}:\n${formatAsText(value, indent + 2)}`;
        }
        if (Array.isArray(value)) {
          return `${' '.repeat(indent)}${label}:\n${formatAsText(value, indent + 2)}`;
        }
        return `${' '.repeat(indent)}${label}: ${value}`;
      })
      .join('\n');
  }
  return String(data);
}

// ─── Output Writing ──────────────────────────────────────────────────────────

/**
 * Writes output to a file or stdout.
 */
export function writeOutput(content: string, outputPath?: string): void {
  if (outputPath) {
    writeFileSync(outputPath, content, 'utf-8');
  } else {
    process.stdout.write(content + '\n');
  }
}

// ─── Cost Confirmation ───────────────────────────────────────────────────────

/**
 * Checks if a backend is a paid backend (not free).
 */
export function isPaidBackend(backend: ExtendedBackendId): boolean {
  const config = EXTENDED_BACKENDS[backend];
  return config.costModel !== 'free';
}

/**
 * Gets the effective AWS region using standard SDK resolution order:
 * 1. Explicit --region flag (if provided)
 * 2. AWS_REGION environment variable
 * 3. AWS_DEFAULT_REGION environment variable
 * 4. Falls back to 'us-east-1' only if nothing else is configured
 */
export function getEffectiveRegion(backend: ExtendedBackendId, userRegion?: string): string {
  const config = EXTENDED_BACKENDS[backend];
  if (config.region === 'local') {
    return 'local';
  }
  return userRegion
    ?? process.env.AWS_REGION
    ?? process.env.AWS_DEFAULT_REGION
    ?? 'us-east-1';
}
