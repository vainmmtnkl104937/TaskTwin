import { ControlPlaneOriginSchema } from '@tasktwin/runner-protocol';

export function validateControlPlaneOrigin(value: string): string {
  let origin: string;
  try {
    origin = new URL(value).origin;
  } catch {
    throw new Error('Control Plane origin is invalid.');
  }
  const parsed = ControlPlaneOriginSchema.safeParse(origin);
  if (!parsed.success) {
    throw new Error('HTTPS is required outside local development.');
  }
  if (value !== origin && value !== `${origin}/`) {
    throw new Error('Control Plane origin is invalid.');
  }
  return parsed.data;
}
