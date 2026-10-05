import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import billingIdentityConfig from '../../config/billing-identity.config';
import { BillingIdentityService } from './billing-identity.service';

@Module({
  imports: [ConfigModule.forFeature(billingIdentityConfig)],
  providers: [BillingIdentityService],
  exports: [BillingIdentityService],
})
export class BillingModule {}
