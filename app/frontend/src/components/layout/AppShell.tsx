import React from 'react'

type Props = {
  left: React.ReactNode
  center: React.ReactNode
  right: React.ReactNode
}

export default function AppShell({ left, center, right }: Props) {
  return (
    <div className="app-shell">
      <div className="left-panel">{left}</div>
      <div className="center-panel">{center}</div>
      <div className="right-panel">{right}</div>
    </div>
  )
}
