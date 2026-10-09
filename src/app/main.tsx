import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route
          path="*"
          element={
            <main>
              <h1>SFDA</h1>
              <p>Your application foundation is ready.</p>
            </main>
          }
        />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
