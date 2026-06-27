export type HealthStatus = {
  status: string
  service: string
  version: string
}

export async function getHealth(): Promise<HealthStatus> {
  const response = await fetch('/api/health')
  if (!response.ok) {
    throw new Error(`Health check failed: ${response.status}`)
  }
  return (await response.json()) as HealthStatus
}
