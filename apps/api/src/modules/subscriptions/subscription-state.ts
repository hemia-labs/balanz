import { SubscriptionStatus } from './entities/subscription.entity';

export function canTransitionSubscription(
  from: SubscriptionStatus,
  to: SubscriptionStatus,
): boolean {
  return (
    from === SubscriptionStatus.PENDING && to === SubscriptionStatus.TRIALING
  );
}
