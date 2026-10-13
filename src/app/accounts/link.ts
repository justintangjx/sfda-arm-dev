import {
  passwordLinkKinds,
  passwordLinkPage,
  readPasswordLinkUrl,
} from '../../domain/accounts'

const capturePasswordLink = () => {
  if (typeof window === 'undefined') return undefined
  const path = window.location.pathname
  if (!passwordLinkKinds.some((kind) => passwordLinkPage(kind) === path))
    return undefined
  const link = readPasswordLinkUrl(new URL(window.location.href))
  window.history.replaceState(null, '', path)
  return link
}
// Capture before creating the router. The link exists only in this page's memory.
export const passwordLink = capturePasswordLink()
