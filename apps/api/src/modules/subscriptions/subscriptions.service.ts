import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import {
  Subscription,
  SubscriptionStatus,
} from './entities/subscription.entity';

@Injectable()
export class SubscriptionsService {
  createPending(
    manager: EntityManager,
    organizationId: string,
    subscriptionType: string,
  ): Promise<Subscription> {
    const repository = manager.getRepository(Subscription);
    return repository.save(
      repository.create({
        organizationId,
        subscriptionType,
        status: SubscriptionStatus.PENDING,
      }),
    );
  }
}
