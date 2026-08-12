import { SetMetadata } from '@nestjs/common';

export type ThrottleScope =
  | 'login'
  | 'registration'
  | 'pairing_create'
  | 'pairing_poll'
  | 'runner_standard'
  | 'runner_claim'
  | 'runner_progress';

export const THROTTLE_SCOPE_METADATA = 'tasktwin:throttle-scope';

export const ScopedThrottle = (
  scope: ThrottleScope,
): MethodDecorator & ClassDecorator =>
  SetMetadata(THROTTLE_SCOPE_METADATA, scope);
