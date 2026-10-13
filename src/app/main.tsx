import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './coach/App'
import './styles.css'
import { setupProof } from './accounts/setup'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App setupProof={setupProof} />
  </StrictMode>,
)
