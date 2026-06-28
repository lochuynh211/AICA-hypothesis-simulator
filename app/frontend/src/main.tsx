import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
// Global 3-panel layout shell (grid columns, panel backgrounds, scrollbars).
// Without this import the .app-shell grid never applies and the panels stack.
import './styles/app.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
