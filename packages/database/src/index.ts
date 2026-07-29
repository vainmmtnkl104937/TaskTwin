export { createDatabaseClient } from './database-client.js';
export { getRequiredDatabaseUrl } from './database-url.js';
export {
  OrganizationRole,
  PrismaClient,
  RecordingSessionStatus,
} from './generated/prisma/client.js';
export { DuplicateEmailError } from './identity/identity-errors.js';
export { IdentityRepository } from './identity/identity.repository.js';
export type {
  AuthenticationUserRecord,
  CreateRegistrationInput,
  CreateRegistrationResult,
  OrganizationMembershipRecord,
  OrganizationRecord,
  SafeUserRecord,
  WorkspaceRecord,
} from './identity/identity-records.js';
export { normalizeEmail } from './identity/normalize-email.js';
export { createCanonicalJsonDigest } from './recording/canonical-json.js';
export {
  RecordingRepositoryError,
  type RecordingRepositoryErrorCode,
} from './recording/recording-errors.js';
export type {
  CompleteRecordingSessionResult,
  CreateRecordingSessionResult,
  IngestRecordingBatchResult,
  OrganizationAccessRecord,
  RecordingSessionMetadataRecord,
} from './recording/recording-records.js';
export { RecordingRepository } from './recording/recording.repository.js';
export {
  WorkflowVersionRepository,
  type PersistedWorkflowVersion,
} from './workflow-version.repository.js';
