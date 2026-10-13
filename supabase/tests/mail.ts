// Test only. Reads the verified local mail capture without printing message content.
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Local mail capture returned an invalid object.')
  return value as Record<string, unknown>
}

export const mailCapture = () => {
  const url = process.env.SFDA_TEST_SUPABASE_MAIL_URL
  if (
    !url ||
    !['http://127.0.0.1:54324', 'http://localhost:54324'].includes(url)
  )
    throw new Error(
      'Verified local mail capture is required for Auth compatibility.',
    )
  const request = async (
    path: string,
    init: RequestInit = {},
    readJson = true,
  ): Promise<unknown> => {
    let status: number | undefined
    try {
      const response = await fetch(`${url}${path}`, {
        ...init,
        signal: AbortSignal.timeout(5000),
      })
      status = response.status
      if (!response.ok) throw new Error('Mail request rejected.')
      return !readJson || response.status === 204 ? null : await response.json()
    } catch {
      throw new Error(
        `Local mail capture request failed (${init.method ?? 'GET'}, ${status ?? 'unavailable'}).`,
      )
    }
  }
  const list = async (email: string) => {
    const result = object(
      await request(
        `/api/v1/search?${new URLSearchParams({ query: `to:${email}` })}`,
      ),
    )
    if (!Array.isArray(result.messages))
      throw new Error('Local mail capture returned no message list.')
    return result.messages.map((item: unknown) => {
      const id = object(item).ID
      if (typeof id !== 'string' || !/^[a-zA-Z0-9-]+$/.test(id))
        throw new Error(
          'Local mail capture returned an invalid message identity.',
        )
      return id
    })
  }
  const link = async (id: string) => {
    const html = object(await request(`/api/v1/message/${id}`)).HTML
    if (typeof html !== 'string')
      throw new Error('Local setup email has no HTML.')
    const href = /href="([^"]+)"/.exec(html)?.[1]
    if (!href) throw new Error('Local setup email has no link.')
    try {
      return new URL(href.replaceAll('&amp;', '&'))
    } catch {
      throw new Error('Local setup email has an invalid link.')
    }
  }
  const clear = async (ids: readonly string[]) => {
    if (ids.length)
      await request(
        '/api/v1/messages',
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ IDs: [...new Set(ids)] }),
        },
        false,
      )
  }
  return { list, link, clear }
}
