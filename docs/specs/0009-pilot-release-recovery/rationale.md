# 0009. Pilot release and recovery — rationale

## Context

The SFDA coach application already runs locally against real Supabase, with synthetic preview hosting and a verification harness that separates advisory checks from release readiness. Scope feature 11 asks for a controlled hosted pilot: real account delivery, database access, optional voice on the public origin, and recorded evidence for what is automated versus manually verified. There is no hosted staging environment. Production is the only live target, so release work must fail closed, name every gate, and define rollback without pretending local results prove hosted behaviour.

Earlier conversations highlighted a gap between a hosted demo with manual preparation feedback and conversational voice on the same public URL. Specification 0008 defines full production voice activation under the GA harness, but the Worker currently authorizes voice only for local verification runs. Feature 11 must therefore own the hosted release envelope, including a narrower **demo voice activation** tier that is explicit, time bounded, and cheaper in evidence than full pilot enablement, without replacing consent, deletion, or real player data rules deferred to feature 12 and scope decisions.

## Options considered

### Option 1: Single production profile (full GA only)

One hosted configuration. Voice turns on only when every 0003 enable phase gate passes, including devices, speech corpus signoff, and real data policy.

**Pros**:
- Simple mental model.
- No second activation path to maintain.

**Cons**:
- Blocks a public URL voice demo for months.
- Confuses “deploy the app” with “approve the pilot.”

### Option 2: Preview hosting for voice demos

Use the fixture preview Worker profile for external demos.

**Pros**:
- No production secrets on demos.

**Cons**:
- Preview cannot perform real Auth, database, or voice (0001). Unsuitable for the requested public pilot.

### Option 3: Layered activation on one production target (recommended)

Keep one production Supabase project and one production Worker. Define three **activation layers** on that target: **hosted live** (manual feedback, voice off), **demo voice** (conversational preparation for provisioned synthetic coaches, reduced evidence, hard expiry), and **pilot enable** (real roster and full 0003 enable gates). Manual promotion steps, recorded manifests, and recovery actions apply to all layers.

**Pros**:
- Matches tracer bullet reality: prove hosting first, then demo voice, then real pilot.
- Aligns with existing `predeployReady` versus `activationReady` in 0003.
- Gives a named home for the missing production voice Worker path under demo rules.

**Cons**:
- Operators must understand layers and not confuse demo voice with pilot approval.
- More configuration and evidence files to maintain.

### Option 4: Separate Supabase and Worker stacks for demo versus pilot

Duplicate infrastructure for demos.

**Pros**:
- Strong isolation.

**Cons**:
- Violates 0001 single production data environment intent.
- Higher cost and drift risk for a small pilot.

## Rationale

Option 3 fits the confirmed architecture (one production database, one Worker, manual migrations, harness gates) and the product ask for a public URL while voice evidence is still incomplete. Demo voice is a **deliberately reduced activation** with synthetic subjects, existing quotas, mandatory expiry, and no claim of real player eligibility. Full pilot enablement remains the only path to real roster data and relaxed voice evidence requirements already encoded in 0003 and 0008.

Recovery is treated as first class: disable flags and redeploy before destructive database actions, preserve journals and submitted feedback, and document operator steps because automatic rollback scripts are out of scope.

## References

(basis: specification 0001 delivery and verification policy, specification 0003 readiness phases and pilot profile, specification 0006 production account controls and SMTP placement, specification 0008 production activation versus local verification, project scope feature 11 intent, and prior engineering discussion on hosted tiers B and D.)
