---
name: knowledge-code
description: Per-repo grounding for the code-design-agent. Three modes per A12.v1.1 targetCodeRepoStatus — brownfield (clone + classify), greenfield (scaffolding hints, no clone), refuse (not-connected / unreachable).
version: 0.2.0
purity: pure-data
runtime: research-runner
command: npx @maintainabilityai/research-runner@~0.1.64 skill-knowledge-code
---

# Knowledge Code Skill

The code-design-agent (Phase D / WHAT) calls this **once per
`target_code_repos[]` entry** to ground its design. The Skill is the
single decision point for brownfield-vs-greenfield: response `mode`
drives every downstream per-repo subsection in `code-design.md`.

Three response shapes, gated by A12.v1.1's `targetCodeRepoStatus`:

| Input `repoStatus` | Response `mode` | Behavior |
|---|---|---|
| `connected` | `brownfield` | `git clone --depth=1` → classify (top-dirs / languages / manifests / entrypoints) |
| `create` | `greenfield` | No clone — return scaffolding hints + reference-repos (if any) |
| `not-connected` | (refuse) | `{ ok: false, reason: 'repo-not-connected' }` + remediation |
| `unreachable` | (refuse) | `{ ok: false, reason: 'repo-unreachable' }` + remediation |

The refuse modes are **defense-in-depth**: the `code-design-agent.yml`
workflow's dispatch precondition already blocks dispatch when any repo
is `not-connected` or `unreachable`, but if the agent retries against
ambiguous status the Skill itself stops cleanly.

## Inputs (stdin JSON)

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `okrId` | `string` | yes | — | OKR id; threaded into audit metadata so the chain links the call to the right run. |
| `repoUrl` | `string` | yes | — | Full URL `https://github.com/<org>/<repo>`. |
| `repoStatus` | `'connected' \| 'not-connected' \| 'create' \| 'unreachable'` | yes | — | Read from `okr.yaml.objectiveAlignment.targetCodeRepoStatus[<url>]`. |
| `ref` | `string` | no | `HEAD` | Branch or tag (brownfield only). |
| `maxFiles` | `integer` | no | 200 | Cap on the file-walk depth (brownfield only). |

## Outputs (stdout JSON) — brownfield mode

```json
{
  "ok": true,
  "mode": "brownfield",
  "repo": { "owner": "...", "name": "...", "ref": "...", "sha": "..." },
  "structure": {
    "topDirs": ["src", "test", "docs"],
    "languages": { "typescript": 142, "javascript": 8 },
    "packageManifests": ["package.json", "package-lock.json"],
    "files": [
      { "path": "src/index.ts", "lang": "typescript", "role": "source" },
      { "path": "src/api/users.ts", "lang": "typescript", "role": "source" },
      { "path": "src/api/__tests__/users.test.ts", "lang": "typescript", "role": "test" },
      { "path": "src/routes/v1/orders.ts", "lang": "typescript", "role": "route" },
      { "path": "package.json", "lang": "unknown", "role": "config" }
    ],
    "tests": ["src/api/__tests__/users.test.ts"],
    "routes": ["src/routes/v1/orders.ts"],
    "modules": [{ "name": "api", "fileCount": 12 }, { "name": "state", "fileCount": 4 }]
  },
  "entryPoints": [
    { "path": "src/index.ts", "kind": "api", "framework": "express" }
  ],
  "auditMetadata": {
    "phase": "what", "repo": "...", "mode": "brownfield", "sha": "...",
    "file_count": 150, "primary_language": "typescript",
    "test_count": 38, "route_count": 7, "module_count": 5,
    "inventory_paths": ["src/api/users.ts", "src/api/__tests__/users.test.ts", "..."]
  }
}
```

**Bug-Q phase 2 — extended inventory.** Before phase 2, brownfield
response carried only `topDirs` / `languages` / manifests, so an agent
asked for `src/state/profileStore.ts`-level paths had to hallucinate.
Phase 2 adds `files[]` (path + lang + role classification), `tests[]`,
`routes[]`, `modules[]`. The `inventory_paths` flat list in
`auditMetadata` is the workflow path-citation gate's membership set —
any brownfield path the artifact cites that isn't in this list fails
the structural verdict.

**Clone retention pairing with `knowledge-code-read`.** Brownfield
mode retains the clone in `os.tmpdir()/knowledge-code-cache/<runId>/
<owner>-<name>/` for the duration of the runner job. The companion
skill `knowledge-code-read` reads bounded file content (≤10 KB) from
this cache — call `knowledge-code` first, then `knowledge-code-read`
for each file the agent wants to ground design on.

## Outputs (stdout JSON) — greenfield mode

```json
{
  "ok": true,
  "mode": "greenfield",
  "repo": "<owner>/<name>",
  "reason": "repo-status-create",
  "referenceRepos": [],
  "scaffoldingHints": {
    "suggestedLanguage": "typescript",
    "suggestedFramework": "express",
    "seedFiles": ["README.md", "LICENSE", "package.json", "tsconfig.json", "src/index.ts", ".github/CODEOWNERS"]
  },
  "auditMetadata": { "phase": "what", "repo": "...", "mode": "greenfield", "repo_status": "create" }
}
```

## Outputs (stdout JSON) — refuse mode

```json
{
  "ok": false,
  "reason": "repo-not-connected" | "repo-unreachable",
  "repo": "<owner>/<name>",
  "remediation": "Open Looking Glass → OKR detail → Target Code Repos and pick a status...",
  "auditMetadata": { "phase": "what", "repo": "...", "mode": "refuse", "repo_status": "not-connected" }
}
```

## Invocation

```sh
echo '{"okrId":"OKR-2026Q2-IMDB-001-celeb-api","repoUrl":"https://github.com/acme/celeb-api","repoStatus":"create"}' \
  | npx -y @maintainabilityai/research-runner@~0.1.64 skill-knowledge-code
```

The agent prompt MUST use this invocation form, not Copilot's `skill_use`
tool (which only loads SKILL.md into context — it does not invoke the
runner backend that produces the actual grounding output). Same B30
discipline that prd-agent + market-research-agent honor.

## Implementation

Per-mode logic:

- **Brownfield:** `git clone --depth=1 --filter=blob:limit=10m` into a
  process-scoped tmpdir, walk + classify, parse `package.json` (or other
  detected manifest) for entrypoint hints, cleanup tmpdir on exit.
- **Greenfield:** Conservative `scaffoldingHints` (TypeScript + Express
  + minimal seed files) — the agent can override these from BAR ADRs in
  the per-repo subsection. `referenceRepos[]` is populated by D5
  knowledge-reference-repos integration when ready (empty array in D-PR1).
- **Refuse:** Defense-in-depth `ok: false` with a remediation hint
  pointing back to the Looking Glass repo-status picker.

Tree-sitter polyglot cross-module-call extraction is **deferred to a
follow-up (D-PR1.v1.1)** — the shallow shape proves the brownfield/
greenfield contract end-to-end on the IMDB-celebs sample. The
`ObservedArchitecture` shape in `agentic-sdlc-codedesigner.md` D6 expands
into `modules[]` / `cross_module_calls[]` / `exposed_interfaces[]` /
`tests[]` once tree-sitter parsers land in the runner package.

## Error contract

| Reason | When |
|---|---|
| `bad-input` | zod validation failed (missing okrId / repoUrl / repoStatus). |
| `repo-not-connected` | `repoStatus === 'not-connected'`. |
| `repo-unreachable` | `repoStatus === 'unreachable'`. |
| `repo-url-not-github` | URL doesn't match `https://github.com/<owner>/<name>`. Phase D non-GitHub support is a future ask. |
| `clone-failed` | git clone exit-non-zero. Remediation includes the underlying git error. |
| `repo-status-create` | NOT an error — this is the greenfield `ok: true` discriminator. |

The agent treats `ok: false` as a hard stop for that repo. The dispatch
precondition gate prevents the agent from ever reaching `not-connected`
/ `unreachable` in normal flow, so refuse responses indicate either a
mid-run repo-status edit (rare) or a workflow misconfiguration.
