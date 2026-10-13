import { randomBytes, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { mailCapture } from './mail.ts'

const options = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
}

const localAuth = () => {
  const url = process.env.SFDA_TEST_SUPABASE_URL
  const adminKey = process.env.SFDA_TEST_SUPABASE_ADMIN_KEY
  if (
    !url ||
    !['http://127.0.0.1:54321', 'http://localhost:54321'].includes(url) ||
    !adminKey
  )
    throw new Error('A verified local Auth compatibility target is required.')
  return createClient(url, adminKey, options)
}

const checked = (error: { code?: string } | null) => {
  if (error)
    throw new Error(
      `Local Auth compatibility failed (${error.code ?? 'UNKNOWN'}).`,
    )
}

describe('first feedback path Auth compatibility (spec 0005, AC-2, AC-3, AC-13)', () => {
  it('preserves the planned UUID and trusted marker for an unconfirmed account without a password', async () => {
    const operator = localAuth()
    const plannedId = randomUUID()
    const operationId = randomUUID()
    const email = `synthetic-${randomUUID()}@example.invalid`
    let createdId: string | undefined
    try {
      const { data, error } = await operator.auth.admin.createUser({
        id: plannedId,
        email,
        email_confirm: false,
        app_metadata: { sfda_setup_operation_id: operationId },
      })
      checked(error)
      if (!data.user)
        throw new Error('Local Auth returned no created identity.')
      createdId = data.user.id
      // Boolean assertions keep generated identifiers and provider objects out of failures.
      expect(
        data.user.id === plannedId,
        'Auth must honor the planned UUID',
      ).toBe(true)
      expect(
        data.user.app_metadata.sfda_setup_operation_id === operationId,
        'Auth must preserve the trusted operation marker',
      ).toBe(true)
      expect(
        Boolean(data.user.email_confirmed_at),
        'Auth must leave the email unconfirmed',
      ).toBe(false)
      const observed = await operator.auth.admin.getUserById(plannedId)
      checked(observed.error)
      expect(observed.data.user?.id === plannedId).toBe(true)
      expect(
        observed.data.user?.app_metadata.sfda_setup_operation_id ===
          operationId,
      ).toBe(true)
    } finally {
      if (createdId) {
        const observed = await operator.auth.admin.getUserById(createdId)
        if (
          observed.data.user?.app_metadata.sfda_setup_operation_id ===
          operationId
        )
          checked((await operator.auth.admin.deleteUser(createdId)).error)
      }
    }
  })

  it('invites the existing unconfirmed account and preserves its identity on replacement', async () => {
    const operator = localAuth()
    const mail = mailCapture()
    const plannedId = randomUUID()
    const operationId = randomUUID()
    const email = `synthetic-${randomUUID()}@example.invalid`
    let created = false
    try {
      const result = await operator.auth.admin.createUser({
        id: plannedId,
        email,
        email_confirm: false,
        app_metadata: { sfda_setup_operation_id: operationId },
      })
      checked(result.error)
      created = result.data.user?.id === plannedId
      expect(created).toBe(true)
      for (const generation of [1, 2]) {
        const redirect = new URL('http://127.0.0.1:5173/auth/setup')
        redirect.searchParams.set('operationId', operationId)
        redirect.searchParams.set('generation', String(generation))
        redirect.searchParams.set('setupCapability', 'A'.repeat(43))
        const invitation = await operator.auth.admin.inviteUserByEmail(email, {
          redirectTo: redirect.href,
        })
        checked(invitation.error)
        expect(
          invitation.data.user?.id === plannedId,
          'Invitation must return the existing planned UUID',
        ).toBe(true)
        expect(
          invitation.data.user?.app_metadata.sfda_setup_operation_id ===
            operationId,
          'Invitation must preserve the trusted marker',
        ).toBe(true)
      }
    } finally {
      try {
        await mail.clear(await mail.list(email))
      } finally {
        if (created)
          checked((await operator.auth.admin.deleteUser(plannedId)).error)
      }
    }
  })

  it('captures usable invite and recovery proofs with exact setup redirects and separate password login', async () => {
    const operator = localAuth()
    const mail = mailCapture()
    const url = process.env.SFDA_TEST_SUPABASE_URL
    const publicKey = process.env.SFDA_TEST_SUPABASE_PUBLIC_KEY
    if (!url || !publicKey)
      throw new Error('Local public Auth configuration is required.')
    const client = () => createClient(url, publicKey, options)
    const plannedId = randomUUID()
    const operationId = randomUUID()
    const email = `synthetic-${randomUUID()}@example.invalid`
    const password = ` ${randomUUID()} `
    let created = false
    const proofs: ReturnType<typeof client>[] = []
    try {
      const createdAccount = await operator.auth.admin.createUser({
        id: plannedId,
        email,
        email_confirm: false,
        app_metadata: { sfda_setup_operation_id: operationId },
      })
      checked(createdAccount.error)
      created = createdAccount.data.user?.id === plannedId
      expect(created).toBe(true)
      expect(
        (await mail.list(email)).length,
        'Account creation must not send mail',
      ).toBe(0)
      for (const type of ['invite', 'recovery'] as const) {
        const generation = type === 'invite' ? '1' : '2'
        const linkOperationId = type === 'invite' ? operationId : randomUUID()
        const capability = randomBytes(32).toString('base64url')
        const redirect = new URL('http://127.0.0.1:5173/auth/setup')
        redirect.searchParams.set('operationId', linkOperationId)
        redirect.searchParams.set('generation', generation)
        redirect.searchParams.set('setupCapability', capability)
        const existingMail = await mail.list(email)
        const sender = client()
        const sent =
          type === 'invite'
            ? await operator.auth.admin.inviteUserByEmail(email, {
                redirectTo: redirect.href,
              })
            : await sender.auth.resetPasswordForEmail(email, {
                redirectTo: redirect.href,
              })
        checked(sent.error)
        const messages = await mail.list(email)
        const messageId = messages.find((id) => !existingMail.includes(id))
        if (!messageId)
          throw new Error('The setup email did not reach local capture.')
        const captured = await mail.link(messageId)
        expect(
          captured.origin === redirect.origin,
          'Setup origin must be preserved',
        ).toBe(true)
        expect(
          captured.pathname === redirect.pathname,
          'Setup path must be preserved',
        ).toBe(true)
        expect(
          captured.searchParams.get('operationId') === linkOperationId,
          'Link operation must be preserved',
        ).toBe(true)
        expect(
          captured.searchParams.get('generation') === generation,
          'Link generation must be preserved',
        ).toBe(true)
        expect(
          captured.searchParams.get('setupCapability') === capability,
          'Link capability must be preserved',
        ).toBe(true)
        expect(
          captured.searchParams.get('type') === type,
          'Proof type must match',
        ).toBe(true)
        expect(
          captured.hash.length,
          'Setup must not contain a bearer fragment',
        ).toBe(0)
        const tokenHash = captured.searchParams.get('token_hash')
        if (!tokenHash)
          throw new Error('The setup email did not include a token hash.')
        const proofClient = client()
        proofs.push(proofClient)
        const verified = await proofClient.auth.verifyOtp({
          token_hash: tokenHash,
          type,
        })
        checked(verified.error)
        expect(
          verified.data.user?.id === plannedId,
          'Proof must verify the planned account',
        ).toBe(true)
        expect(
          Boolean(verified.data.session),
          'Proof must establish a temporary session',
        ).toBe(true)
        if (type === 'recovery') {
          checked((await proofClient.auth.updateUser({ password })).error)
          const login = client()
          proofs.push(login)
          const signedIn = await login.auth.signInWithPassword({
            email,
            password,
          })
          checked(signedIn.error)
          expect(
            signedIn.data.user?.id === plannedId,
            'A separate client must log in normally',
          ).toBe(true)
        }
        const consumed = await client().auth.verifyOtp({
          token_hash: tokenHash,
          type,
        })
        expect(
          Boolean(consumed.error),
          'A consumed proof must be rejected',
        ).toBe(true)
      }
    } finally {
      for (const proof of proofs) await proof.auth.signOut({ scope: 'local' })
      try {
        await mail.clear(await mail.list(email))
      } finally {
        if (created)
          checked((await operator.auth.admin.deleteUser(plannedId)).error)
      }
    }
  })
})
