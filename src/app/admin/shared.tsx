import type { ReactNode } from 'react'
import { Navigate, NavLink, Outlet } from 'react-router'
import { Dialog } from '../coach/components'
import { useRuntime } from '../coach/runtime'
import styles from '../coach/coach.module.css'
import layout from '../accounts/accounts.module.css'
import type { AdminAction } from './actions'

export function ActionStatus({
  action,
  reload,
}: Readonly<{ action: AdminAction; reload: () => void }>) {
  return (
    <>
      {action.error && (
        <div role="alert" className={styles.banner}>
          <p>{action.error}</p>
          {action.code === 'VERSION_CONFLICT' && (
            <button type="button" onClick={reload}>
              Reload current values
            </button>
          )}
        </div>
      )}
      {action.notice && (
        <p role="status" className={styles.banner}>
          {action.notice}
        </p>
      )}
      {action.unknown && (
        <div className={styles.banner}>
          <p>
            {action.unknown.label} outcome unknown. Request{' '}
            {action.unknown.requestId}. Other actions are paused.
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              disabled={action.busy}
              onClick={() => void action.check()}
            >
              Check committed result
            </button>
            <button type="button" onClick={action.discard}>
              Discard pending request
            </button>
          </div>
        </div>
      )}
    </>
  )
}

// Cancel takes initial focus, so a stray Enter never confirms.
export function ActionDialog({
  title,
  confirmLabel,
  children,
  close,
  confirm,
  danger = false,
}: Readonly<{
  title: string
  confirmLabel: string
  children: ReactNode
  close: () => void
  confirm: (form: FormData) => void
  danger?: boolean
}>) {
  return (
    <Dialog title={title} close={close}>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          close()
          confirm(form)
        }}
      >
        {children}
        <div className={styles.actions}>
          <button type="button" data-safe-focus onClick={close}>
            Cancel
          </button>
          <button className={danger ? styles.danger : styles.primary}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
export function ReasonField({ id }: Readonly<{ id: string }>) {
  return (
    <div>
      <label htmlFor={id}>Reason</label>
      <textarea id={id} name="reason" required maxLength={2000} rows={3} />
    </div>
  )
}
export function AdminLayout() {
  const runtime = useRuntime()
  if (!runtime.access || !runtime.dataClient)
    return <Navigate to="/login" replace />
  if (runtime.access.role !== 'admin')
    return (
      <Navigate
        to={runtime.access.role === 'player' ? '/account' : '/coach'}
        replace
      />
    )
  return (
    <div className={layout.workspace}>
      <nav aria-label="Admin sections" className={layout.sections}>
        <NavLink to="/admin/accounts">Accounts</NavLink>
        <NavLink to="/admin/campaigns">Campaigns</NavLink>
        {runtime.configuration.appEnv === 'local' && (
          <NavLink to="/admin/setup">Setup workspace</NavLink>
        )}
      </nav>
      <Outlet />
    </div>
  )
}
export function LoadState({
  state,
  retry,
  children,
}: Readonly<{
  state: 'loading' | 'ready' | 'error'
  retry: () => void
  children: ReactNode
}>) {
  if (state === 'loading') return <p role="status">Loading…</p>
  if (state === 'error')
    return (
      <div role="alert" className={styles.banner}>
        <p>These records could not be loaded.</p>
        <button type="button" onClick={retry}>
          Retry
        </button>
      </div>
    )
  return children
}
