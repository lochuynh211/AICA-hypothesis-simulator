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
  const data = await response.json()
  if (
    typeof data?.status !== 'string' ||
    typeof data?.service !== 'string' ||
    typeof data?.version !== 'string'
  ) {
    throw new Error('Unexpected health response shape')
  }
  return data as HealthStatus
}
