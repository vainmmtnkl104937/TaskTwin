export type ServiceHealthStatus = 'healthy' | 'unhealthy';

export interface ServiceHealthResponse {
  service: string;
  status: ServiceHealthStatus;
}
