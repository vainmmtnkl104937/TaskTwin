export type ServiceHealthStatus = 'healthy';

export interface ServiceHealthResponse {
  service: string;
  status: ServiceHealthStatus;
}
