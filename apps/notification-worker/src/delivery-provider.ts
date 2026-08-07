export type NotificationDeliveryFailure = {
  outcome: 'retryable' | 'permanent';
  safeErrorCode: string;
};

export type NotificationDeliveryResult =
  | { outcome: 'delivered' }
  | NotificationDeliveryFailure;

export interface NotificationDeliveryProvider {
  readonly channel: 'IN_APP';
  deliver(messageId: string, workerId: string): Promise<NotificationDeliveryResult>;
}
