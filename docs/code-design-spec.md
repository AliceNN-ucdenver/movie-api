# Code Design Spec — `AliceNN-ucdenver/movie-api`

_Committed by the Looking Glass fan-out for OKR `OKR-2026Q2-IMDB-004-movie-api` (delivered at dispatch — greenfield + brownfield)._

## Source artifact

- **Repo:** `AliceNN-ucdenver/alicenn-ucdenver-governance-mesh`
- **Path:** `okrs/OKR-2026Q2-IMDB-004-movie-api/what/code-design.md`
- **Link:** [`okrs/OKR-2026Q2-IMDB-004-movie-api/what/code-design.md`](https://github.com/AliceNN-ucdenver/alicenn-ucdenver-governance-mesh/blob/main/okrs/OKR-2026Q2-IMDB-004-movie-api/what/code-design.md)

## How to read this

The **full canonical WHAT-phase design is inlined below** — frozen at WHAT
dispatch and committed into this repo by the fan-out at dispatch time, so
you ground against it **locally** (no mesh-repo access required). The design is a
shared, multi-repo artifact; **your** per-repo slices are the H3 sub-blocks
naming `AliceNN-ucdenver/movie-api` (slug in §1; short name + role in §2–§4):

- **§1 Project Structure** — your layout
- **§2 API Endpoint Specifications** — your **binding contract**. Endpoint
  paths and request/response field names + shapes are acceptance criteria,
  not suggestions: the provenance gate diffs your exposed contract against
  this — drift (renamed fields, changed paths, missing endpoints) fails the PR.
- **§3 Data Models** + **§4 Authentication** — your models + auth
- **§5–§10** — shared across all target repos (security controls, config,
  error handling, testing, deployment, rationale)

Sibling-repo sub-blocks are kept for cross-repo contract coordination (also
summarised in the landing-issue body).

> ⚠️ The inlined doc’s YAML frontmatter (`chain_root_hash`, `run_id`, …) and
> any trailing `### Self-review — Code-*` sections belong to the **WHAT-phase
> design agent** — they are NOT your `implementation_chain`. Your
> `parent_chain_root` comes from the landing issue; compute your own
> `chain_root_hash` per `.github/agents/implementation-agent.agent.md`.

## Implementation agent checklist

1. Read your per-repo slices below (§1–§4, the `AliceNN-ucdenver/movie-api` sub-blocks); treat §2 as the binding contract.
2. Read sibling-repo coordination from the landing-issue body.
3. Plan + implement + run the Tweedles persona-switch self-critique (Architect + Security) via the runner skills.
4. Open the impl PR with the `implementation_chain` Hatter Tag continuation block per `.github/agents/implementation-agent.agent.md`.

---

# Canonical WHAT-phase design — inlined snapshot

---
phase: what
okr_id: OKR-2026Q2-IMDB-004-movie-api
run_id: WHAT-2026-06-13-5fjlgb
intent_thread_uuid: b9f690d8-a3e5-4a53-bf15-de9155b401f6
parent_intent_thread: b9f690d8-a3e5-4a53-bf15-de9155b401f6
governance_tier: autonomous
author_did: did:github:copilot-swe-agent
reviewer_dids: []
evidence_mode: code
audit:
  chain_root_hash: 84193e9ede0554392a4a130d3512719b9fa37ee2d1f34409b78cf09249930b97
---

## 1. Project Structure

### `AliceNN-ucdenver/movie-api`
---
repo: AliceNN-ucdenver/movie-api
mode: brownfield
status: connected
language: javascript
framework: express
addresses: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, SR-01, SR-02, SR-03, SR-04]
cited_paths:
  - src/app.js
  - src/routes/index.js
  - src/routes/movies.js
  - src/routes/reviews.js
  - src/middleware/auth.js
  - src/middleware/authorize.js
  - src/middleware/validate.js
  - src/middleware/rateLimiter.js
  - src/middleware/errorHandler.js
  - src/models/Movie.js
  - src/models/Review.js
  - src/models/User.js
  - src/utils/sanitize.js
  - src/utils/token.js
  - src/utils/logger.js
  - .env.example
  - src/config/database.js
  - src/server.js
  - test/movies.test.js
new_paths:
  - src/models/Recommendation.js
  - src/services/recommendationService.js
  - src/services/recommendationRefreshService.js
  - src/jobs/recommendationRefreshJob.js
  - src/utils/recommendationTelemetry.js
  - src/config/recommendations.js
  - test/recommendations.test.js
fanout_wave: 1
coordination_role: independent
depends_on: []
provides: []
consumes: []
---

Current wiring reuses `src/app.js` (`app.use('/api', routes)`), `src/routes/index.js` (`router.use('/movies', movieRoutes)`), and extends `src/routes/movies.js` with `GET /recommendations` under the movies router. Existing auth + RBAC reuse is via `authenticate` from `src/middleware/auth.js` and `authorize` from `src/middleware/authorize.js`.

The existing helper contracts that must be reused without drift:
- `stripNoSqlOperators` (`src/utils/sanitize.js`): recursively drops object keys beginning with `$`; safe for both `req.body` and `req.query`.
- `validatePagination` (`src/middleware/validate.js`): normalizes `page`, clamps `limit` to `<= 100`, and allowlists sortable fields.
- `authenticate` (`src/middleware/auth.js`): reads ****** verifies with `verifyAccessToken`, sets `req.user = { userId, email, role }`.
- `globalLimiter` / `writeLimiter` (`src/middleware/rateLimiter.js`): standard 429 handling with `Retry-After`.

Planned file layout (ADD/MODIFY):

```text
src/
  app.js                                  # MODIFY: mount refresh scheduler bootstrap
  routes/
    movies.js                             # MODIFY: add GET /recommendations
  models/
    Recommendation.js                     # ADD: recommendation cache schema (no new PII)
  services/
    recommendationService.js              # ADD: ranking + fallback selection
    recommendationRefreshService.js       # ADD: async recompute + persistence
  jobs/
    recommendationRefreshJob.js           # ADD: scheduled cache refresh orchestration
  utils/
    recommendationTelemetry.js            # ADD: recommendation_served structured event helper
  middleware/
    validate.js                           # MODIFY: add validateRecommendationQuery

test/
  recommendations.test.js                 # ADD: endpoint + fallback + tamper + telemetry tests
```

## 2. API Endpoint Specifications

### `GET /api/movies/recommendations` (FR-01, FR-04, FR-05, FR-06, SR-01, SR-03)

`src/routes/movies.js` adds a route before `/:id`:

```javascript
/**
 * @typedef {Object} RecommendationsQuery
 * @property {number} [limit]          // default 20, min 1, max 50
 * @property {string} [experimentArm]  // optional: control | personalized
 *
 * @typedef {Object} RecommendationItem
 * @property {string} movieId
 * @property {number} score
 * @property {'personalized'|'cold_start'} personalizationStatus
 * @property {Array<{type:'genre_affinity'|'rating_similarity'|'catalog_overlap'|'cold_start_popularity', value:string}>} rationale
 *
 * @typedef {Object} RecommendationsResponse
 * @property {string} subject           // JWT-derived userId only
 * @property {'personalized'|'cold_start'} personalizationStatus
 * @property {'cache'|'fresh'} source
 * @property {string} modelVersion
 * @property {RecommendationItem[]} data
 */
```

Request/authorization behavior:
- Auth: required (`authenticate`) and role-gated (`authorize('viewer', 'user', 'admin')`).
- Subject derivation: always `req.user.userId`; any `userId` in query/body is ignored and logged as tampering metadata.
- Query validation: new `validateRecommendationQuery` middleware enforces `limit` bounds and `experimentArm` allowlist.

Status codes:
- `200`: personalized or cold-start list (business state is body discriminant `personalizationStatus`, not thrown error).
- `400`: invalid `limit`/`experimentArm`.
- `401`: no/invalid JWT (existing `authenticate` behavior).
- `403`: role not allowed.
- `429`: rate limited.
- `503`: cache unavailable and fallback store unavailable.

Example success body:

```json
{
  "subject": "665f31a2e3e0a0f6c2bb1123",
  "personalizationStatus": "cold_start",
  "source": "cache",
  "modelVersion": "item-cf-v1",
  "data": [
    {
      "movieId": "665f31a2e3e0a0f6c2bb9981",
      "score": 0.81,
      "personalizationStatus": "cold_start",
      "rationale": [{ "type": "cold_start_popularity", "value": "Action top-rated this week" }]
    }
  ]
}
```

## 3. Data Models

### Existing models reused
- `src/models/Review.js` fields reused for collaborative filtering input: `movieId`, `userId`, `rating`, `createdAt`; existing unique index `{ movieId: 1, userId: 1 }` remains the anti-duplication guarantee.
- `src/models/Movie.js` fields reused for fallback/rationale: `genre`, `year`, text index for search already exists.

### New cache model `src/models/Recommendation.js` (FR-02, FR-03, FR-04, FR-05, SR-02, SR-04)

```javascript
const recommendationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  personalizationStatus: { type: String, enum: ['personalized', 'cold_start'], required: true },
  modelVersion: { type: String, required: true, default: 'item-cf-v1' },
  generatedAt: { type: Date, required: true, default: Date.now, index: true },
  recommendations: [{
    movieId: { type: mongoose.Schema.Types.ObjectId, ref: 'Movie', required: true },
    score: { type: Number, required: true, min: 0 },
    rationale: [{
      type: { type: String, enum: ['genre_affinity', 'rating_similarity', 'catalog_overlap', 'cold_start_popularity'], required: true },
      value: { type: String, required: true, maxlength: 120 }
    }]
  }],
  telemetry: {
    lastServedAt: { type: Date },
    cacheHits: { type: Number, default: 0 },
    cacheMisses: { type: Number, default: 0 }
  }
}, { minimize: true });

recommendationSchema.index({ userId: 1 }, { unique: true });
recommendationSchema.index({ generatedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 });
```

No new PII fields are added: only existing `userId` reference + derived recommendation metadata.

## 4. Authentication Middleware Implementation

`GET /api/movies/recommendations` reuses existing middleware chain in `src/routes/movies.js`:

```javascript
router.get(
  '/recommendations',
  authenticate,
  authorize('viewer', 'user', 'admin'),
  validateRecommendationQuery(),
  async (req, res, next) => {
    const userId = req.user.userId; // from authenticate(req)
    // call recommendationService and return typed body
  }
);
```

Contract grounding:
- `authenticate` (`src/middleware/auth.js`) verifies bearer token using `verifyAccessToken` from `src/utils/token.js`, then sets `req.user`.
- `verifyAccessToken` enforces `algorithm: RS256`, `issuer: 'movie-api'`, `audience: 'imdb-lite'`.
- `authorize` (`src/middleware/authorize.js`) returns 401 when `req.user` absent, 403 when role not in allowlist.

This avoids duplicate token parsing and keeps SR-01 identity guarantees aligned with ADR-003.

## 5. Security Control Implementations

| Requirement | Control | Code-level implementation |
|---|---|---|
| SR-01 (OWASP A01/A04) | JWT-subject-only identity | In `src/routes/movies.js`, never accept `req.query.userId`/body identity; derive `subject` only from `req.user.userId`. Emit warning telemetry for override attempts. |
| SR-02 (OWASP A01/A02/A09) | No new PII persistence | `src/models/Recommendation.js` stores only `userId` reference and derived scores/rationale; no demographic/profile free text. Enforce schema strict mode. |
| SR-03 (OWASP A03/A04/A09) | Input constraints + rationale sanitization | `validateRecommendationQuery` clamps `limit` (1-50), allowlists `experimentArm`, and rejects unknown enum values. Rationale strings pass `stripHtml` (`src/utils/sanitize.js`) before response/log emission. |
| SR-04 (OWASP A04/A09) | Forensic metadata without preference reconstruction | `src/utils/recommendationTelemetry.js` logs modelVersion, personalizationStatus, source, experimentArm, list size, cache age; excludes raw rating vectors and per-item historical review content. |

Additional controls:
- Reuse `globalLimiter` plus dedicated recommendations limiter (`max: 60 / 15 min`) to reduce abuse amplification.
- Preserve existing logger PII masking from `src/utils/logger.js` for all recommendation telemetry events.

## 6. Configuration and Environment Variables

Extend `.env.example` with recommendation-specific config (NFR-01, NFR-02, NFR-04):

```env
RECOMMENDATIONS_ENABLED=true
RECOMMENDATIONS_DEFAULT_LIMIT=20
RECOMMENDATIONS_MAX_LIMIT=50
RECOMMENDATIONS_MIN_RATINGS=3
RECOMMENDATIONS_MODEL_VERSION=item-cf-v1
RECOMMENDATIONS_CACHE_TTL_SECONDS=21600
RECOMMENDATIONS_REFRESH_CRON=*/15 * * * *
RECOMMENDATIONS_REFRESH_BATCH_SIZE=200
RECOMMENDATIONS_FALLBACK_GENRE_WINDOW_DAYS=30
RECOMMENDATIONS_LATENCY_SLO_MS=200
RECOMMENDATIONS_DEPENDENCY_TIMEOUT_MS=150
METRIC_RECOMMENDATION_SERVED=recommendation_served_total
METRIC_RECOMMENDATION_LATENCY=recommendation_response_latency_ms
METRIC_RECOMMENDATION_CACHE_HIT_RATE=recommendation_cache_hit_ratio
METRIC_RECOMMENDATION_FALLBACK_RATE=recommendation_cold_start_rate
METRIC_RECOMMENDATION_EXPERIMENT_CTR=recommendation_experiment_ctr
```

Validation loader pattern in `src/config/recommendations.js` (new):

```javascript
function toInt(name, fallback) {
  const raw = process.env[name];
  const parsed = raw == null ? fallback : parseInt(raw, 10);
  if (Number.isNaN(parsed)) throw new Error(`${name} must be an integer`);
  return parsed;
}

module.exports = {
  enabled: (process.env.RECOMMENDATIONS_ENABLED || 'true') === 'true',
  defaultLimit: toInt('RECOMMENDATIONS_DEFAULT_LIMIT', 20),
  maxLimit: toInt('RECOMMENDATIONS_MAX_LIMIT', 50),
  minRatings: toInt('RECOMMENDATIONS_MIN_RATINGS', 3),
  modelVersion: process.env.RECOMMENDATIONS_MODEL_VERSION || 'item-cf-v1'
};
```

## 7. Error Handling Patterns

Recommendation path uses existing `errorHandler` (`src/middleware/errorHandler.js`) and adds only true-failure classes:

```javascript
class RecommendationValidationError extends Error {
  constructor(message) { super(message); this.name = 'RecommendationValidationError'; this.statusCode = 400; }
}

class RecommendationDependencyError extends Error {
  constructor(message) { super(message); this.name = 'RecommendationDependencyError'; this.statusCode = 503; }
}
```

Business state is not modeled as an error:
- `personalizationStatus: 'cold_start'` is a normal `200` response branch.
- `personalizationStatus: 'personalized'` is also a normal `200` branch.

`errorHandler` continues to emit `{ error, message, requestId }` and maps unexpected failures to 500.

## 8. Testing Strategy with Example Test Cases

Existing tests to extend: `test/movies.test.js`, `test/security/rateLimiting.test.js`, `test/security/injection.test.js`, `test/fitness/complexity.test.js`.

New suite: `test/recommendations.test.js`

```javascript
describe('GET /api/movies/recommendations', () => {
  it('returns 200 personalized list for authenticated subject');
  it('returns 200 cold_start when subject has fewer than min ratings');
  it('ignores userId override in query and uses req.user.userId');
  it('returns 400 for limit > RECOMMENDATIONS_MAX_LIMIT');
  it('returns 401 for missing bearer token');
  it('emits recommendation_served telemetry without raw ratings payload');
});
```

Mocking strategy (aligned with actual helper usage):
- Unit-test `src/services/recommendationService.js` by mocking `Review`, `Movie`, and `Recommendation` model methods.
- Integration-test endpoint via `supertest` using the same test harness pattern in `test/movies.test.js`.
- Mock `src/utils/recommendationTelemetry.js` (the new helper used by route/service) directly in recommendation endpoint tests.

Coverage/fitness gates remain unchanged: `npm test`, `npm run coverage`, `npm run lint`, and complexity gate from `test/fitness/complexity.test.js` (threshold 10).

## 9. Deployment Configuration

No new service is introduced; deploy as brownfield `movie-api` extension.

Runtime/bootstrap changes:
- `src/app.js`: register recommendation refresh scheduler on startup when `RECOMMENDATIONS_ENABLED=true`.
- `src/server.js`: ensure graceful shutdown stops refresh worker before mongoose disconnect.

Operational behavior by dependency (NFR-02):

```yaml
dependencies:
  - name: mongodb
    when_down: return 503 for recommendations and include Retry-After; do not synthesize from stale in-memory state
  - name: recommendation cache collection
    when_down: attempt fresh compute once; if compute fails, return 503 with requestId
  - name: ratings/reviews read path
    when_down: serve last cached recommendation if generatedAt <= RECOMMENDATIONS_CACHE_TTL_SECONDS; otherwise 503
```

Release/ramp pattern:
- Feature flag via `RECOMMENDATIONS_ENABLED`.
- Canary rollout with experiment arm (`control` vs `personalized`) telemetry.
- Health check remains `/health`; add optional diagnostics key (`recommendationsScheduler: up|degraded`) in non-prod.

## 10. Design Rationale & Research Traceability

- **Patent alignment (C6, S4, S12):** design stays with item-based CF over ratings + cache in `movie-api`, avoiding embedding- or playback-queue-specific claims.
- **JTBD alignment (C3, S42, S16):** endpoint delivers immediate ranked options to reduce decision fatigue; rationale metadata supports user trust and quick selection.
- **Whitespace execution (C1, C2, C4; S43, S47):** this is a Node.js + Express + MongoDB brownfield implementation that reuses current stack and avoids new PII fields.
- **Community/implementation evidence (S37, S43, S47):** library-compatible CF pattern and pragmatic cache-first serving map directly to current `movie-api` code shape.
- **Mesh/ADR alignment (E1-E7):** stays on `react-frontend -> movie-api -> mongodb`, reuses JWT/RBAC contract from ADR-003 and MongoDB document model from ADR-002.

NFR-to-alert mapping:

| NFR | Target | Alert threshold | Implementation hook |
|---|---|---|---|
| NFR-01 latency | p95 < 200ms | `p95(recommendation_response_latency_ms) > 200ms` for 15m | `METRIC_RECOMMENDATION_LATENCY` |
| NFR-02 availability | 99.9% | `5xx rate > 0.1%` for recommendations over 1h | endpoint + dependency fallback behavior in §9 |
| NFR-03 maintainability | complexity <= 10, coverage >= 80% | complexity gate fail or coverage < 80% in CI | `test/fitness/complexity.test.js`, `npm run coverage` |
| NFR-04 telemetry completeness | 100% successful responses emit experiment-attributable event | served_count - telemetry_count > 0 over 5m | `METRIC_RECOMMENDATION_SERVED`, `METRIC_RECOMMENDATION_EXPERIMENT_CTR` |

### Cross-Repo Fan-Out & Dependency Ordering

```yaml
coordination:
  - repo: AliceNN-ucdenver/movie-api
    fanout_wave: 1
    coordination_role: independent
    depends_on: []
    provides: []
    consumes: []
    rationale: This OKR targets only movie-api and all required contracts are internal to this repository.
```

### References

- `okrs/OKR-2026Q2-IMDB-004-movie-api/how/prd.md`
- `okrs/OKR-2026Q2-IMDB-004-movie-api/why/research-doc.md`
- `okrs/OKR-2026Q2-IMDB-004-movie-api/okr.yaml`
- `okrs/OKR-2026Q2-IMDB-004-movie-api/audit/chain-ladder.yaml`
- `platforms/imdb-lite/bars/imdb-lite-application/architecture/ADRs/002-mongodb-document-store.md`
- `platforms/imdb-lite/bars/imdb-lite-application/architecture/ADRs/003-jwt-rbac-authentication.md`
- `platforms/imdb-lite/bars/imdb-lite-application/architecture/quality-attributes.yaml`
- `platforms/imdb-lite/bars/imdb-lite-application/architecture/fitness-functions.yaml`
- `platforms/imdb-lite/bars/imdb-lite-application/security/threat-model.yaml`
- `see skill_call event_id=1 in okrs/OKR-2026Q2-IMDB-004-movie-api/audit/events/WHAT-2026-06-13-5fjlgb.jsonl` (`knowledge-okr`)
- `see skill_call event_id=2 in okrs/OKR-2026Q2-IMDB-004-movie-api/audit/events/WHAT-2026-06-13-5fjlgb.jsonl` (`knowledge-prd`)
- `see skill_call event_id=3 in okrs/OKR-2026Q2-IMDB-004-movie-api/audit/events/WHAT-2026-06-13-5fjlgb.jsonl` (`knowledge-mesh-bar`)
- `see skill_call event_id=6 in okrs/OKR-2026Q2-IMDB-004-movie-api/audit/events/WHAT-2026-06-13-5fjlgb.jsonl` (`context-architecture`)
- `see skill_call event_id=7 in okrs/OKR-2026Q2-IMDB-004-movie-api/audit/events/WHAT-2026-06-13-5fjlgb.jsonl` (`context-security`)
- `see skill_call event_id=8 in okrs/OKR-2026Q2-IMDB-004-movie-api/audit/events/WHAT-2026-06-13-5fjlgb.jsonl` (`context-quality`)
- `see skill_call event_id=9 in okrs/OKR-2026Q2-IMDB-004-movie-api/audit/events/WHAT-2026-06-13-5fjlgb.jsonl` (`knowledge-code`)
- `see skill_call event_id=10-26 in okrs/OKR-2026Q2-IMDB-004-movie-api/audit/events/WHAT-2026-06-13-5fjlgb.jsonl` (`knowledge-code-read` set)

### Self-review — Code-Architect (round 1)
SCORE: 0.93
SEVERITY: PASS
COVERED: [FR-01 via `src/routes/movies.js` endpoint extension, FR-03/FR-04 via cache+fallback in `src/models/Recommendation.js` and `src/services/recommendationRefreshService.js`, SR-01 alignment to ADR-003 JWT flow through `src/middleware/auth.js` and `src/middleware/authorize.js`, CALM nodes `movie-api` and `mongodb` respected with no new service boundary]
MISSING: []
CHANGES: []

### Self-review — Code-Security (round 1)
SCORE: 0.92
SEVERITY: PASS
COVERED: [SR-01 with OWASP A01/A04 via JWT-subject-only routing, SR-02 with OWASP A01/A02/A09 via no-new-PII schema, SR-03 with OWASP A03/A04/A09 via `validateRecommendationQuery` and `stripHtml`, SR-04 with OWASP A04/A09 via structured telemetry metadata and redaction, STRIDE THR-NNN catalog check against `platforms/imdb-lite/bars/imdb-lite-application/security/threat-model.yaml` (currently empty threats array)]
MISSING: []
CHANGES: []
