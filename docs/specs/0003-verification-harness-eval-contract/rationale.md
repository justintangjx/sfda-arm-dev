# Rationale: Verification harness and eval contract

## Context

Your small SFDA coach pilot needs enough durable context for a fresh agent to build safely. The scope requires GA verification and a Tracer Bullet build. No application scaffold or runtime exists yet. Architecture 0001 fixes the runtime, local Docker Supabase, production only hosting, manual migrations and automatic checked main deployments. Data specification 0002 fixes access, concurrency, feedback and voice proposal contracts.

You want advisory success when infrastructure or evidence is missing, while keeping production readiness strict. You accept passing deterministic retries with a flaky label. Voice quality needs your approval and a pilot coach's judgement. Your first corpus has ten text scenarios, with speech added later. Live provider work is explicitly requested, and human/live evidence expires after seven days or input changes. Those choices create a real distinction between successful command execution and safe activation.

The source repository will be public. Cases and automated checks use synthetic data, and production secrets stay outside ordinary PR jobs. Real player consent, minors, location, retention and deletion handling remain unresolved for actual rollout. Text quality alone cannot establish microphone, accent or provider audio behaviour.

## Options considered

### Option 1: Separate commands and a manual checklist

Run the chosen tools separately and collect release evidence by hand (basis: existing Vitest/Playwright and the scope's verification outcomes).

* Benefit: smallest implementation and easy direct debugging.
* Cost: agents and CI can omit requirements or confuse a fixture pass with production readiness.

### Option 2: Thin TypeScript runner and file evidence

Wrap existing tools, validate their reports and evaluate distinct readiness gates from versioned definitions (basis: your selected common command, file model and architecture 0001).

* Benefit: one reproducible contract with explicit evidence provenance and no application schema changes.
* Cost: the adapters and report validators themselves need failure testing and maintenance.

### Option 3: Supabase results store and admin dashboard

Persist cases, reports and review decisions in an application backed service (basis: an operational dashboard approach using the selected BaaS).

* Benefit: searchable shared history and an accessible reviewer interface.
* Cost: new permissions, migrations and product screens distract from the first real coach path. A dashboard still cannot replace trustworthy runner evidence.

## Rationale

Option 2 supports your fresh agent handoff without building another product. JSON reports and attempt records bridge existing runner results, while separate evidence kinds preserve what was actually exercised. Vitest and Playwright already provide structured reporters, and Playwright exposes flaky outcomes after retries. The harness defines its own aggregate exit contract rather than assuming a child runner's output is valid (basis: architecture 0001, confirmed file model, verified reporter and retry guidance).

Your advisory preference is respected through warnings and exit 0 for unavailable checks. It would be unsafe to interpret that as readiness, so you explicitly retained strict production gates. Phase separation also avoids requiring smoke evidence for a candidate that has not yet been deployed. New integration code can deploy disabled, with activation requiring actual deployed evidence (basis: your answers 9B and 13A, and architecture 0001's disabled integration boundary).

Ten text cases provide a manageable starting set. Requiring both reviewers, full essential fact preservation and nine useful cases makes the quality rule measurable. The critical integrity rule is independent of average usefulness. No speech or accent claim follows from a text transcript, a provider test label or a mocked conversation (basis: your corpus and quality choices, data specification 0002, and the verified ElevenLabs test schema).

The migration reader uses Node tooling and `pg`, with a dedicated role and fixed SELECT. `psql` was the alternative; your chosen library keeps execution in the existing TypeScript environment. TLS verification, bound values and bounded connection/query time prevent a small prerequisite check becoming an unrestricted database interface. These client settings supplement actual database grants (basis: your answer 10A and 14A, node-postgres client and TLS guidance).

Seven day expiry and relevant input fingerprints balance cost with stale evidence risk. Exact commit matching applies to deterministic release checks; stable human/live input fingerprints permit reuse across unrelated commits. Trusted reviews are necessary because public repository files can claim any result. Provider configuration binding must be proved by its actual integration before live results can pass readiness (basis: your freshness answer, evidence provenance practices and verified provider identity caveats).

## Design review record

You chose a separate critique using the same model. It completed and identified four medium severity decision completeness gaps: disabled capability selection, per attempt critical failure evidence, review approval creation and retained summary verification. You approved all four recommended fixes. The build contract now names shipped and requested activations with trusted current state, retains and reviews each evaluated attempt, puts approval references outside the immutable payload they approve, and restricts authenticated compact summaries to eligible unchanged deterministic evidence. The review found the advisory/readiness and database safety boundaries coherent. No application or provider test is claimed by this document review.

You explicitly accepted the completed specification on 6 October 2026. Document checks passed for both core files, required sections, all 14 acceptance criteria, verification and build coverage, the approved fixes and local links. Implementation, real database checks and live provider evidence remain future work.

## Source verification notes

A read only source helper checked official runner and provider documentation once. Existing architecture, scope and data sources were reused without fetching their recorded reference links again. A final source check verified node-postgres client and TLS configuration. Some extra search results were surfaced without a full page fetch; only the opened primary pages are linked below. No package, account or integration was installed or connected.

Runner documentation confirms report formats and retry outcomes, but the source pass did not verify a universal Vitest CLI exit convention. The wrapper therefore verifies structured results and child outcomes rather than relying on an undocumented assumption. Playwright browser binaries follow its selected release, so exact versions are pinned during the authorised scaffold, not invented here.

The ElevenLabs test schema describes chat history, tool calls and source medium. The inspected pages did not establish a test run endpoint's binding to an immutable agent version or prove objective audio evidence. Agent retrieval supports version related identifiers, but retrieval alone is not execution provenance. The future voice adapter must resolve this before claiming live readiness. This specification selects no unverified provider execution endpoint.

Node-postgres supports explicit TLS, parameterized values and separate connection/client/server timeout settings. Certificate requirements depend on the eventual approved production endpoint. Read permission comes from PostgreSQL grants, not the driver. Environment supplied secrets are harness policy supported by the client; they are not presented as a provider mandate.

## References

**Project sources**

* [SFDA scope](../../scope/scope.md), GA verification, Tracer Bullet delivery, synthetic data and fresh agent handoff.
* [Architecture 0001](../0001-architecture-environments/index.md), selected tools, production lock, manual migrations and disabled integration deployment.
* [Data rules 0002](../0002-fresh-data-model-access-rules/index.md), actual local access checks, feedback lifecycle and voice authority.
* Your answers on 6 October 2026, including advisory missing evidence, passing retries, ten text cases, quality review, the confirmed file model, strict readiness and deferred discovery.

**Practices**

* Evidence provenance and reproducible test inputs.
* Least privilege database roles and bounded execution.
* Distinct deployment and activation evidence.

**Official links checked during this design**

* [Vitest reporters](https://vitest.dev/guide/reporters), structured report formats.
* [Playwright CI](https://playwright.dev/docs/ci), runner setup and artifact collection.
* [Playwright retries](https://playwright.dev/docs/test-retries), attempt and flaky outcomes.
* [Playwright browsers](https://playwright.dev/docs/browsers), engines and emulated devices.
* [Playwright reporters](https://playwright.dev/docs/test-reporters), structured and HTML reports.
* [ElevenLabs test records](https://elevenlabs.io/docs/api-reference/tests/get), chat and test result schema, without a speech quality claim.
* [ElevenLabs agent retrieval](https://elevenlabs.io/docs/api-reference/agents/get), agent and version related identifiers.
* [Node PostgreSQL client](https://node-postgres.com/apis/client), query values, environment fallbacks and timeout configuration.
* [Node PostgreSQL TLS](https://node-postgres.com/features/ssl), certificate configuration and connection string interaction.

These links are human references. Later agents reuse the recorded contracts without fetching them again.
