/**
 * Audit Logger for the Quantum Genomics Pipeline.
 * Logs all data access, job submissions, and result retrievals
 * with timestamps and researcher identity.
 *
 * Requirements: 10.4
 */

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface AuditEntry {
  timestamp: Date;
  researcherId: string;
  action: string;
  resource: string;
  outcome: 'success' | 'denied' | 'error';
  details?: Record<string, unknown>;
}

export interface AuditLogSink {
  write(entry: string): void;
}

/**
 * AuditLogger records structured audit entries for all pipeline operations.
 * Entries include timestamp, researcher identity, action, resource, and outcome.
 */
export class AuditLogger {
  private sink: AuditLogSink;
  private entries: AuditEntry[] = [];

  constructor(sink?: AuditLogSink) {
    this.sink = sink ?? { write: () => {} };
  }

  /**
   * Logs an audit entry. The entry is stored in memory and written to the sink
   * as structured JSON.
   */
  log(entry: AuditEntry): void {
    this.entries.push(entry);
    const serialized = JSON.stringify({
      timestamp: entry.timestamp.toISOString(),
      researcherId: entry.researcherId,
      action: entry.action,
      resource: entry.resource,
      outcome: entry.outcome,
      details: entry.details,
    });
    this.sink.write(serialized);
  }

  /**
   * Returns all logged entries (useful for testing and querying).
   */
  getEntries(): AuditEntry[] {
    return [...this.entries];
  }

  /**
   * Returns entries filtered by researcher ID.
   */
  getEntriesByResearcher(researcherId: string): AuditEntry[] {
    return this.entries.filter((e) => e.researcherId === researcherId);
  }

  /**
   * Returns entries filtered by action.
   */
  getEntriesByAction(action: string): AuditEntry[] {
    return this.entries.filter((e) => e.action === action);
  }

  /**
   * Returns entries filtered by outcome.
   */
  getEntriesByOutcome(outcome: 'success' | 'denied' | 'error'): AuditEntry[] {
    return this.entries.filter((e) => e.outcome === outcome);
  }

  /**
   * Clears all stored entries.
   */
  clear(): void {
    this.entries = [];
  }
}
