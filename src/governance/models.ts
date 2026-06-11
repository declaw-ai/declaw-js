/** A single enforced control within a governance pack gate. */
export interface GovernanceControl {
  /** Control identifier, e.g. "OWASP-LLM06-ExcessiveAgency". */
  control: string;
  /** Gate that enforces this control: "cmd", "network", or "content". */
  gate: string;
  /** Human-readable rule description. */
  rule: string;
  /** Remediation playbook / guidance. */
  playbook: string;
}

/** An advisory (non-enforced) item within a governance pack. */
export interface GovernanceAdvisory {
  /** Control identifier this advisory references. */
  control: string;
  /** Explanation of why this control is advisory rather than enforced. */
  reason: string;
}

/** A governance pack returned by GET /governance/packs or GET /governance/packs/:name. */
export interface GovernancePack {
  /** Pack name / slug, e.g. "owasp-llm-top10". */
  name: string;
  /** Pack version string, e.g. "v1". */
  version: string;
  /** Full framework name, e.g. "OWASP Top 10 for LLM Applications (2025)". */
  framework: string;
  /** Human-readable description of what this pack enforces. */
  description: string;
  /** Gates activated by this pack, e.g. ["cmd","network","content"]. */
  gates: string[];
  /** Enforced controls within this pack. */
  enforces: GovernanceControl[];
  /** Advisory (non-enforced) controls within this pack. */
  advisory: GovernanceAdvisory[];
  /**
   * Canonical policy reference string, e.g. "owasp-llm-top10@v1".
   * Mapped from wire field `policy_ref`.
   */
  policyRef: string;
  /** Whether this pack was seeded (built-in) vs. user-created. */
  seeded: boolean;
}

/** Parse a raw wire-format governance control into a GovernanceControl. */
function parseGovernanceControl(data: Record<string, unknown>): GovernanceControl {
  return {
    control: String(data.control ?? ''),
    gate: String(data.gate ?? ''),
    rule: String(data.rule ?? ''),
    playbook: String(data.playbook ?? ''),
  };
}

/** Parse a raw wire-format advisory entry into a GovernanceAdvisory. */
function parseGovernanceAdvisory(data: Record<string, unknown>): GovernanceAdvisory {
  return {
    control: String(data.control ?? ''),
    reason: String(data.reason ?? ''),
  };
}

/** Parse a raw wire-format pack row into a GovernancePack. */
export function parseGovernancePack(data: Record<string, unknown>): GovernancePack {
  const rawEnforces = (data.enforces as Record<string, unknown>[] | null | undefined) ?? [];
  const rawAdvisory = (data.advisory as Record<string, unknown>[] | null | undefined) ?? [];

  return {
    name: String(data.name ?? ''),
    version: String(data.version ?? ''),
    framework: String(data.framework ?? ''),
    description: String(data.description ?? ''),
    gates: (data.gates as string[] | null | undefined) ?? [],
    enforces: rawEnforces.map(parseGovernanceControl),
    advisory: rawAdvisory.map(parseGovernanceAdvisory),
    policyRef: String(data.policy_ref ?? data.policyRef ?? ''),
    seeded: Boolean(data.seeded ?? false),
  };
}
