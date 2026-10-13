# 0007 implementation sketch

**Date**: 2026-10-13  
**Status**: Working contract for the in-progress build

## Usage sketch

```typescript
// Campaign discovery (Current / History, search, stage, cursor pages)
adapter.loadCampaigns(actor, { mode, text, stage }, cursor, signal)

// Campaign shell + freeze requirements
adapter.loadCampaignContext(actor, campaignId, signal)

// Roster discovery with own draft flag and preparation activity
adapter.loadRoster(actor, campaignId, rosterQuery, cursor, signal)

// Selected player workspace + filter match for outside-filter label
adapter.loadPlayerContext(actor, campaignId, playerId, rosterQuery, signal)

// Previous / Next over full filtered order
adapter.loadRosterNeighbors(actor, campaignId, playerId, rosterQuery, signal)

// History list + detail (original only; correction unavailable)
adapter.loadHistory(actor, campaignId, playerId, dateQuery, cursor, signal)
adapter.loadFeedbackEntry(actor, campaignId, playerId, feedbackId, signal)

// Existing 0002 / 0005 mutations unchanged
adapter.mutate(actor, command)
```

Browser modules:

| Module | Role |
|---|---|
| `src/app/data/coachList.ts` | RPC envelope parsing, row mappers |
| `src/app/data/coach.ts` | Live `CoachAdapter` |
| `src/app/coach/navigation.ts` | Roster query identity + pre-navigation target verification |
| `src/app/coach/screens.tsx` | Discovery UI, retained selection, guarded navigation, history |
| `supabase/migrations/20261014*_coach_workspace_*.sql` | Caller-scoped read functions |

## Synthesis decision

**Extend 0004 in place** with SQL read projections and a thin adapter layer rather than a separate workspace service or duplicated fixture/live code paths.

Rejected alternatives:

1. **Worker BFF for lists** — extra hop, conflicts with direct Supabase RPC pattern in 0002/0006.
2. **Client-side filter of downloaded rosters** — fails AC-2/AC-3 paging and privacy boundaries.

The chosen shape keeps one `CoachAdapter` contract, pushes search/paging/neighbors to SQL, and registers campaign-scoped roster query on runtime for AC-4 target checks before route commits.

## Deviations

None recorded against this sketch at introduction. Navigation verification uses `get_coach_player_context` with captured roster query identity; filter changes return `INVALID_INPUT` at the UI boundary.
