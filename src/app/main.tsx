import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './coach/App'
import './styles.css'
import { passwordLink } from './accounts/link'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App passwordLink={passwordLink} />
  </StrictMode>,
)
