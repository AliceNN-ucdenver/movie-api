---
name: audit-emit-event
description: Append one hash-chained audit event to okrs/<id>/audit/events/<run-id>.jsonl. Returns the new chain head.
version: 0.1.0
purity: pure-data
runtime: research-runner
command: npx @maintainabilityai/research-runner@~0.1.64 skill-audit-emit-event
---

# Audit Emit Event Skill

Hash-chained, append-only audit log writer; one JSONL event per line per run. Every event is Ed25519-sealed (Knight's Seal v1, B27).

## When to call this skill (post-Bug-V/Y)

Audit-event ownership in the current contract (Bug V / Codex round-6 + Bug W / round-7 + Bug Y / round-9):

| Event kind | Emitter (kind→origin map) | When |
|---|---|---|
| `skill_call` | **Runtime** (auto-emit inside `runSkill()` — `origin: runtime`) | Every skill invocation. Agent does nothing. **The public CLI Zod enum REJECTS this kind** — agents calling `runSkill('audit-emit-event', { eventKind: 'skill_call' })` get `{ok: false, reason: 'bad-input'}`. Only the internal `runSkill()` auto-emit path can produce it. |
| `llm_call` | **Runtime** (when wired — `origin: runtime`) | Every model call. Agent does nothing. **Also rejected by the public CLI enum** — same reason as `skill_call`. |
| `self_review` | **AGENT — you, via this skill** (`origin: agent`) | At the end of each persona-prompt section (Architect / Security / Code-Architect / Code-Security) while your per-epoch private key is still in scope. The runner signs it. |
| `self_review_exhausted` | **AGENT — you, via this skill** (`origin: agent`) | When the auto-revise loop hits MAX_AUTO_ROUNDS without convergence. |
| `gap_loop` | **AGENT — you, via this skill** (`origin: agent`) | WHY-phase coverage-gap iteration semantic marker (market-research-agent step 8b). Pre-Bug-Y this rode on `skill_call` with `payload.skill: 'gap-loop'`; that path is closed because `skill_call` is now runtime-only. Use this dedicated kind instead. The `count-skill-calls` action still counts the legacy shape as a fallback for older chains. |
| `review_received` / `review_emitted` | (reserved — `origin: agent`) | The separate reviewer-agent dispatch was retired in B24; nothing emits these today. Reserved for future use; would be agent-signed if revived. |
| `artifact_written` | **Workflow** (deterministic, from `git diff` — `origin: workflow`) | Post-PR commit. Agent does nothing. **The workflow now re-derives sha + bytes from the current PR HEAD and rejects mismatches with `forged artifact_written event detected`** (Bug Y) — an attacker can no longer pre-emit a forged `artifact_written` with a fake sha and have the workflow's emit step silently skip past it. |
| `state_transition` | **Workflow** (from PR labels — `origin: workflow`) | Label flip / phase advance. Agent does nothing. |
| `human_gate` | **Workflow** (from PR reviewer state — `origin: workflow`) | HumanGate transition. Agent does nothing. |

**You DO call this skill — for `self_review`, `self_review_exhausted`, and `gap_loop` events** (and the reserved review-* kinds if they're revived). Everything else is owned by the runtime or the workflow.

### Bug Y trust contract — the kind→origin map

The runner maintains a single source of truth (`EVENT_KIND_ORIGIN` in `packages/research-runner/src/runner/skills.ts`) that pins every event kind to exactly one legitimate emitter: **runtime**, **agent**, or **workflow**. Two enforcement points:

1. **`payload.emitted_by` is set by the runner from the map, NOT from your input.** Pre-Bug-Y an agent could pass `payload.emitted_by: 'workflow'` to fake workflow attribution; post-Y the runner overrides whatever you supplied. Don't bother setting it — you can't lie about it.
2. **The verifier rejects events where `event_kind` and `emitted_by` don't match the map** with `origin-kind-mismatch-line-N`. Hand-rolled JSONL with mismatched attribution fails `audit-verify-chain` and the run is marked degraded.

Why this matters: pre-Bug-V the agent could pretend to be the workflow by writing `emitted_by:'workflow'` on an unsigned `self_review` event, and the chain validated. Bug V fixed the allowlist; Bug Y closes the parallel hole on the input side — even legitimate emitters can't accidentally (or intentionally) misattribute the kind they're emitting.

### Other use cases

- **Legacy / no-session-context runtimes** — if `OKR_ID` / `RUN_ID` / `INTENT_THREAD_UUID` / `PHASE` env vars are absent the runner skips auto-emission. In that fallback mode the internal `emitAuditEvent(input, { internal: true })` path is used (the public CLI still rejects runtime kinds).

For `skill_call` / `llm_call` (runtime-owned) / `artifact_written` / `state_transition` / `human_gate` (workflow-owned): do nothing — the runner + workflow already handle them, and the CLI will refuse if you try.

## Inputs (stdin JSON)

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `okrId` | `string` | yes | — | Which OKR's audit log to append to. |
| `runId` | `string` | yes | — | Stable per agent run (e.g. `RES-2026-05-19-abc123`). **Run IDs that start with `IMPL-` (e.g. `IMPL-2026-05-27-celeb-api-abc123`) route writes to the TARGET REPO's `.maintainability/audit/{events,keys}/...` instead of the mesh's `okrs/<id>/audit/...`** — see Codex-r3 Bug 1 routing notes below. The prefix check is string-based so the verifier resolves to the same place. |
| `eventKind` | `"self_review" \| "self_review_exhausted" \| "gap_loop" \| "review_received" \| "review_emitted" \| "artifact_written" \| "state_transition" \| "human_gate"` | yes | — | Public CLI enum. **`skill_call` and `llm_call` are deliberately absent** (Bug Y) — they are runtime-owned and only the internal `runSkill()` auto-emit path can produce them. Passing either via the CLI returns `{ok: false, reason: 'bad-input'}`. See §7.5 for the full kind→origin map. |
| `payload` | `Record<string, unknown>` | yes | — | Event-kind-specific data. Must not contain secrets. For `self_review`, include `{round, persona, score, severity, prompt_pack}` at minimum. |
| `phase` | `"why" \| "how" \| "what" \| "implementation"` | yes | — | OKR phase this event belongs to (v4 §11.1.6). **`implementation` is the Tier 2 hand-off phase** for the per-repo `implementation-agent` (Codex-r3 Bug 1). Pair with an `IMPL-*` runId to land evidence in the target repo. |
| `intentThreadUuid` | `string` | yes | — | The OKR's `meta.intentThreadUuid`. |

## Outputs (stdout JSON)

| Field | Type | Description |
|---|---|---|
| `ok` | `boolean` | False only on file-lock failure after 3 retries. |
| `chainHead` | `string` | The new chain-root SHA-256 (the appended event's `event_hash`). |
| `eventId` | `integer` | Monotonic position in the run's JSONL. |

## Invocation

```sh
echo '{"okrId":"...", "runId":"...", "eventKind":"skill_call", "payload":{"skill":"tavily-search","duration_ms":420}, "phase":"why", "intentThreadUuid":"..."}' \
  | npx @maintainabilityai/research-runner@~0.1.64 skill-audit-emit-event
```

## Implementation

Wraps `packages/research-runner/src/runner/audit-emitter.ts`. The on-disk envelope schema is defined by `packages/research-runner/src/schemas/audit-event.ts`. 3 retries with backoff on file-lock contention; on terminal failure, logs to stderr and exits non-zero — `verify-chain` (Phase E) recovers post-hoc. CLI subcommand backend lands in B-PR1a.

### Codex-r3 Bug 1 — implementation-phase path routing

`audit-emit-event` resolves its on-disk path from the `runId` prefix:

| `runId` prefix | Events JSONL | Keys directory |
|---|---|---|
| `IMPL-*` (implementation phase — runs INSIDE the target repo) | `$REPO_PATH/.maintainability/audit/events/<runId>.jsonl` | `$REPO_PATH/.maintainability/audit/keys/` |
| Everything else (`RES-*`, `PRD-*`, `WHAT-*`, etc.) | `$MESH_PATH/okrs/<okrId>/audit/events/<runId>.jsonl` | `$MESH_PATH/okrs/<okrId>/audit/keys/` |

`$REPO_PATH` defaults to `process.cwd()` so when the runner is invoked from the target repo's working directory the env var is optional (the implementation-agent is dispatched via custom-agent assignment, so its session cwd already IS the target repo — no workflow `cd` step is involved). The env var is the explicit override for tests + alternate harnesses where the runner isn't already rooted at the target repo. `$MESH_PATH` defaults to `process.cwd()` too — different default, same fallback rule.

`audit-verify-chain` uses the same prefix-based resolver so the writer and verifier always land in the same place. Symmetry is mandatory — a mismatch would either write evidence to one place and verify from another (false negative) or refuse to verify a legitimate chain (false positive).

The private Ed25519 keys still go to tmpdir (mode 0600) regardless of phase — they never cross the on-disk boundary into either the mesh or the target repo. Only the public keys land beside the JSONL.

## Error contract

`{ok: false, reason: 'audit-write-failed-after-retries'}` is the only failure surface. Agent continues per §5.5.3 (audit failure is non-blocking; chain integrity is checked post-run).
