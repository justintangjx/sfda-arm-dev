import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  advance,
  checked,
  createCampaign,
  createCompetition,
  createFixture,
  feedback,
  object,
  read,
  rpc,
  rejected,
  type Fixture,
} from './fixture.ts'
import { ownerQuery, localSql } from './sql.ts'

const fingerprint = 'a'.repeat(64)
const voiceConfig = {
  fingerprint,
  agentId: 'agent_test',
  agentVersionId: 'ver_test',
  credentialRule: 'terminal_consumes',
  captureRule: 'mute_stops_capture',
  dispatchToIssuanceSeconds: 20,
  redemptionSeconds: 60,
  limits: {
    callCapSeconds: 300,
    finishSeconds: 20,
    coachDaily: 20,
    sfdaDaily: 100,
  },
} as const

const projection = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected projection object.')
  return value as Record<string, unknown>
}

const sessionOf = (value: Record<string, unknown>) => {
  const session = value.session
  if (!session || typeof session !== 'object' || Array.isArray(session))
    throw new Error('Expected session in projection.')
  return session as Record<string, unknown>
}

const serviceRpc = async (
  fixture: Fixture,
  name: string,
  inputs: Record<string, unknown>,
) => {
  const { data, error } = await fixture.operator.rpc(name, inputs)
  checked(error)
  return object(data)
}

describe('voice sessions', () => {
  let fixture: Fixture
  let campaignId: string
  let playerId: string

  beforeAll(async () => {
    fixture = await createFixture()
    playerId = fixture.player.id
    campaignId = await createCampaign(
      fixture,
      await createCompetition(fixture.admin),
    )
    await advance(fixture.admin, campaignId, 1, 'preparation')
  })

  it('reserves, claims, connects, accepts a proposal, files, and closes', async () => {
    const startRequestId = randomUUID()
    const reserved = projection(
      await read(fixture.coach, 'reserve_voice_session', {
        start_request_id: startRequestId,
        campaign_id: campaignId,
        player_id: playerId,
      }),
    )
    expect(reserved.fresh).toBe(true)
    const session = sessionOf(reserved)
    const sessionId = session.id as string

    const replay = projection(
      await read(fixture.coach, 'reserve_voice_session', {
        start_request_id: startRequestId,
        campaign_id: campaignId,
        player_id: playerId,
      }),
    )
    expect(replay.fresh).toBe(false)

    const claimed = projection(
      await serviceRpc(fixture, 'claim_voice_session', {
        session_id: sessionId,
        actor_id: fixture.coach.id,
        config: voiceConfig,
        authorisation: {
          kind: 'production_activation',
          evidenceId: 'act-test',
          until: new Date(Date.now() + 3_600_000).toISOString(),
        },
      }),
    )
    const dispatchId = claimed.dispatchId as string
    expect(sessionOf(claimed).status).toBe('authorising')

    const armed = projection(
      await serviceRpc(fixture, 'arm_voice_dispatch', {
        session_id: sessionId,
        actor_id: fixture.coach.id,
        dispatch_id: dispatchId,
        config: voiceConfig,
      }),
    )
    expect(armed.dispatchRemainingMs).toBeTypeOf('number')

    const issued = projection(
      await serviceRpc(fixture, 'record_voice_issuance', {
        session_id: sessionId,
        actor_id: fixture.coach.id,
        dispatch_id: dispatchId,
        observation: {
          outcome: 'issued',
          conversationId: 'conv_test_1',
          unexpected: false,
        },
      }),
    )
    expect(issued.deliverToken).toBe(true)

    const versionAfterIssuance = sessionOf(issued).version as number
    const connected = projection(
      await serviceRpc(fixture, 'record_voice_connection', {
        session_id: sessionId,
        actor_id: fixture.coach.id,
        expected_version: versionAfterIssuance,
        sdk_conversation_id: 'conv_test_1',
        observation: {
          kind: 'observed',
          conversationId: 'conv_test_1',
          agentId: 'agent_test',
          versionId: 'ver_test',
          status: 'in-progress',
        },
        config: voiceConfig,
      }),
    )
    expect(sessionOf(connected).status).toBe('active')

    const versionAfterConnect = sessionOf(connected).version as number
    const finishing = projection(
      await serviceRpc(fixture, 'begin_voice_finish', {
        session_id: sessionId,
        actor_id: fixture.coach.id,
        expected_version: versionAfterConnect,
        config: voiceConfig,
      }),
    )
    expect(sessionOf(finishing).status).toBe('finishing')

    const proposalId = randomUUID()
    const accepted = projection(
      await serviceRpc(fixture, 'accept_voice_proposal', {
        session_id: sessionId,
        actor_id: fixture.coach.id,
        proposal_id: proposalId,
      }),
    )
    expect(sessionOf(accepted).status).toBe('proposal_ready')

    const ended = projection(
      await serviceRpc(fixture, 'end_voice_session', {
        session_id: sessionId,
        actor_id: fixture.coach.id,
        reason: 'finished',
      }),
    )
    expect(sessionOf(ended).localOutcome).toBe('finished')

    const submitted = await rpc(fixture.coach, 'submit_feedback', {
      ...feedback(campaignId, playerId, 'preparation', {
        content: {
          observations: 'Voice filed observation.',
          strengths: null,
          development_focus: null,
          observed_on: '2026-01-01',
        },
      }),
      voice_session_ids: [sessionId],
    })
    expect(submitted.outcome).toBe('committed')

    const terminal = projection(
      await serviceRpc(fixture, 'observe_voice_provider', {
        session_id: sessionId,
        actor_id: fixture.coach.id,
        observation: {
          kind: 'observed',
          conversationId: 'conv_test_1',
          agentId: 'agent_test',
          versionId: 'ver_test',
          status: 'done',
          durationSeconds: 12,
        },
        config: voiceConfig,
      }),
    )
    expect(sessionOf(terminal).providerState).toBe('terminal')
  })

  const reserve = async (requestId = randomUUID()) =>
    sessionOf(
      projection(
        await read(fixture.coach, 'reserve_voice_session', {
          start_request_id: requestId,
          campaign_id: campaignId,
          player_id: playerId,
        }),
      ),
    )
  const end = (id: string, reason = 'cancelled') =>
    serviceRpc(fixture, 'end_voice_session', {
      session_id: id,
      actor_id: fixture.coach.id,
      reason,
    })
  const claim = (id: string, config: unknown = voiceConfig) =>
    serviceRpc(fixture, 'claim_voice_session', {
      session_id: id,
      actor_id: fixture.coach.id,
      config,
      authorisation: {
        kind: 'production_activation',
        evidenceId: 'act-test',
        until: new Date(Date.now() + 3_600_000).toISOString(),
      },
    })
  const expire = (id: string, assignments: string) =>
    ownerQuery([
      { text: 'set local session_replication_role = replica' },
      {
        text: `update public.voice_sessions set ${assignments} where id = $1`,
        values: [id],
      },
    ])
  const reconcile = (id: string) =>
    serviceRpc(fixture, 'reconcile_voice_session', {
      session_id: id,
      observation: { kind: 'unavailable' },
      config: null,
    })

  it('withholds internal metadata on caller RPCs and direct column reads', async () => {
    const session = await reserve()
    expect(session.worker).toBeUndefined()
    const result = await fixture.coach.client
      .from('voice_sessions')
      .select('dispatch_id,provider_conversation_id')
    expect(result.error?.code).toBe('42501')
    const validated = await read(fixture.coach, 'validate_voice_binding', {
      session_id: session.id,
    })
    expect(sessionOf(validated).worker).toBeUndefined()
    await end(String(session.id))
  })

  it('serializes competing starts, replays exactly once and blocks manual filing during an open call', async () => {
    const requestId = randomUUID()
    const results = await Promise.all([reserve(requestId), reserve(requestId)])
    expect(results[0].id).toBe(results[1].id)
    const busy = await read(fixture.coach, 'reserve_voice_session', {
      start_request_id: randomUUID(),
      campaign_id: campaignId,
      player_id: playerId,
    })
    expect(busy.refusal).toBe('VOICE_BUSY')
    await rejected(
      fixture.coach,
      'save_feedback_draft',
      feedback(campaignId, playerId, 'preparation'),
      'VOICE_BUSY',
    )
    await end(String(results[0].id))
  })

  it('requires proven capture and current configuration before arming', async () => {
    const first = await reserve()
    const refused = await claim(String(first.id), {
      ...voiceConfig,
      captureRule: 'unproven',
    })
    expect(refused.refusal).toBe('VOICE_UNAVAILABLE')
    expect(sessionOf(refused).endedAt).toBeTypeOf('string')
    const second = await reserve()
    const claimed = await claim(String(second.id))
    const armed = await serviceRpc(fixture, 'arm_voice_dispatch', {
      session_id: second.id,
      actor_id: fixture.coach.id,
      dispatch_id: claimed.dispatchId,
      config: null,
    })
    expect(armed.refusal).toBe('VOICE_UNAVAILABLE')
    expect(sessionOf(armed).providerState).toBe('not_issued')
    await end(String(second.id))
  })

  it('commits expiry even when the current configuration changed', async () => {
    const session = await reserve()
    const claimed = await claim(String(session.id))
    await expire(
      String(session.id),
      "dispatch_until = current_timestamp - interval '1 second'",
    )
    const result = await serviceRpc(fixture, 'arm_voice_dispatch', {
      session_id: session.id,
      actor_id: fixture.coach.id,
      dispatch_id: claimed.dispatchId,
      config: { ...voiceConfig, fingerprint: 'b'.repeat(64) },
    })
    expect(result.refusal).toBe('CONFIG_CHANGED')
    expect(sessionOf(result).localOutcome).toBe('timed_out')
    expect(sessionOf(result).endedAt).toBeTypeOf('string')
  })

  it('keeps a dispatched unknown outcome outstanding until its proven bound', async () => {
    const session = await reserve()
    const claimed = await claim(String(session.id))
    await serviceRpc(fixture, 'arm_voice_dispatch', {
      session_id: session.id,
      actor_id: fixture.coach.id,
      dispatch_id: claimed.dispatchId,
      config: voiceConfig,
    })
    const unknown = await serviceRpc(fixture, 'record_voice_issuance', {
      session_id: session.id,
      actor_id: fixture.coach.id,
      dispatch_id: claimed.dispatchId,
      observation: { outcome: 'unknown', unexpected: false },
    })
    expect(sessionOf(unknown).status).toBe('uncertain')
    expect(sessionOf(unknown).endedAt).toBeNull()
    await end(String(session.id))
    expect(sessionOf(await reconcile(String(session.id))).status).toBe(
      'uncertain',
    )
    await expire(
      String(session.id),
      "hold_until = current_timestamp - interval '1 second'",
    )
    expect(sessionOf(await reconcile(String(session.id))).status).toBe(
      'cancelled',
    )
  })

  it('reconciles closure from the frozen credential contract when live config is absent', async () => {
    const session = await reserve()
    const claimed = await claim(String(session.id))
    await serviceRpc(fixture, 'arm_voice_dispatch', {
      session_id: session.id,
      actor_id: fixture.coach.id,
      dispatch_id: claimed.dispatchId,
      config: voiceConfig,
    })
    await serviceRpc(fixture, 'record_voice_issuance', {
      session_id: session.id,
      actor_id: fixture.coach.id,
      dispatch_id: claimed.dispatchId,
      observation: {
        outcome: 'issued',
        conversationId: 'conv_frozen',
        unexpected: false,
      },
    })
    await end(String(session.id))
    const closed = await serviceRpc(fixture, 'reconcile_voice_session', {
      session_id: session.id,
      config: null,
      observation: {
        kind: 'observed',
        conversationId: 'conv_frozen',
        agentId: 'agent_test',
        versionId: 'ver_test',
        status: 'done',
        durationSeconds: 10,
      },
    })
    expect(sessionOf(closed).status).toBe('cancelled')
    expect(sessionOf(closed).proposalEligible).toBe(false)
    expect(sessionOf(closed).endedAt).toBeTypeOf('string')
  })

  it('returns NOT_FOUND for missing voice metadata during a new write', async () => {
    await rejected(
      fixture.coach,
      'save_feedback_draft',
      {
        ...feedback(campaignId, playerId, 'preparation'),
        voice_session_ids: [randomUUID()],
      },
      'NOT_FOUND',
    )
  })

  it('enforces the twentieth coach reservation and the global hundredth reservation using database Singapore time', async () => {
    const base = await reserve()
    await end(String(base.id))
    const archive = () =>
      ownerQuery([
        { text: 'set local session_replication_role = replica' },
        {
          text: "update public.voice_sessions set created_at = current_timestamp - interval '2 days' where coach_id = $1",
          values: [fixture.coach.id],
        },
      ])
    const populate = (global: boolean) =>
      ownerQuery([
        { text: 'set local session_replication_role = replica' },
        {
          text: `insert into public.voice_sessions(start_request_id,coach_id,campaign_id,competition_id,player_id,kind,campaign_version,caller_version,coach_membership_version,player_membership_version,reservation_until,local_outcome,local_ended_at,proposal_revoked_at,ended_at)
        select gen_random_uuid(),s.coach_id,s.campaign_id,s.competition_id,s.player_id,s.kind,s.campaign_version,s.caller_version,s.coach_membership_version,s.player_membership_version,current_timestamp + interval '30 seconds','cancelled',current_timestamp,current_timestamp,current_timestamp
        from public.voice_sessions s cross join generate_series(1,${global ? "greatest(0,100 - (select count(*)::integer from public.voice_sessions where created_at >= ((current_timestamp at time zone 'Asia/Singapore')::date::timestamp at time zone 'Asia/Singapore')))" : '20'}) where s.id = $1`,
          values: [base.id],
        },
      ])
    const start = (identity = fixture.coach) =>
      read(identity, 'reserve_voice_session', {
        start_request_id: randomUUID(),
        campaign_id: campaignId,
        player_id: playerId,
      })
    try {
      await archive()
      await populate(false)
      const coachLimit = await start()
      expect(coachLimit.refusal).toBe('QUOTA_EXCEEDED')
      const midnight = localSql(
        "select to_json(((current_timestamp at time zone 'Asia/Singapore')::date + 1)::timestamp at time zone 'Asia/Singapore')",
      )
      expect(Date.parse(String(coachLimit.quotaResetAt))).toBe(
        Date.parse(String(midnight)),
      )
      await archive()
      await rpc(fixture.admin, 'set_campaign_coach', {
        campaign_id: campaignId,
        coach_id: fixture.other.id,
        active: true,
        expected_version: null,
        reason: 'Synthetic quota evidence',
      })
      await populate(true)
      const globalLimit = await start(fixture.other)
      expect(globalLimit.refusal).toBe('QUOTA_EXCEEDED')
    } finally {
      await archive()
    }
    const nextDay = await reserve()
    await end(String(nextDay.id))
  })

  it('serializes disabling against capture and still permits owner cancellation', async () => {
    const session = await reserve()
    const person = await read(fixture.coach, 'get_my_access', {})
    const [claimed] = await Promise.all([
      fixture.operator.rpc('claim_voice_session', {
        session_id: session.id,
        actor_id: fixture.coach.id,
        config: voiceConfig,
        authorisation: {
          kind: 'production_activation',
          evidenceId: 'act-test',
          until: new Date(Date.now() + 3_600_000).toISOString(),
        },
      }),
      rpc(fixture.admin, 'set_profile_access', {
        profile_id: fixture.coach.id,
        enabled: false,
        expected_version: person.version,
        reason: 'Synthetic concurrent revocation',
      }),
    ])
    try {
      expect(claimed.error?.message ?? null).toBeOneOf([null, 'FORBIDDEN'])
      const cancelled = await end(String(session.id))
      expect(sessionOf(cancelled).localOutcome).toBe('cancelled')
      expect(sessionOf(cancelled).revoked).toBe(true)
    } finally {
      await rpc(fixture.admin, 'set_profile_access', {
        profile_id: fixture.coach.id,
        enabled: true,
        expected_version: Number(person.version) + 1,
        reason: 'Synthetic restoration',
      })
    }
    const validated = await read(fixture.coach, 'validate_voice_binding', {
      session_id: session.id,
    })
    expect(validated.refusal).toBe('CONTEXT_CHANGED')
  })

  it('deletes only safely closed metadata after thirty days', async () => {
    const session = await reserve()
    await end(String(session.id))
    checked(
      (
        await fixture.operator.rpc('delete_ended_voice_sessions', {
          batch_size: 1000,
        })
      ).error,
    )
    const before = await fixture.coach.client
      .from('voice_sessions')
      .select('id')
      .eq('id', session.id)
    expect(before.data).toHaveLength(1)
    await expire(
      String(session.id),
      "ended_at = current_timestamp - interval '31 days'",
    )
    checked(
      (
        await fixture.operator.rpc('delete_ended_voice_sessions', {
          batch_size: 1000,
        })
      ).error,
    )
    const after = await fixture.coach.client
      .from('voice_sessions')
      .select('id')
      .eq('id', session.id)
    expect(after.data).toHaveLength(0)
    expect(
      localSql(
        "select json_build_object('exists', to_regclass('public.voice_sessions') is not null, 'rls', (select relrowsecurity from pg_class where oid = 'public.voice_sessions'::regclass))",
      ),
    ).toEqual({ exists: true, rls: true })
  })
})
