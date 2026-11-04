# api

## 0.2.0

### Minor Changes

- 9806106: Adopt the published @hemia/payments 0.12.0 and resolve a Console connection once during API configuration initialization. Share the resolved configuration with the SDK, checkout return URLs and license snapshots while preserving existing authorization, MFA, CSRF and callbacks.
  
  Support the four-variable Console delivery and retain explicit PAYMENTS_CONNECTION as a separate configuration source. Reject incomplete or mixed sources and keep Billing credentials out of the worker profile. Update the read-only connection check, examples and adoption documentation. No database migration is required.

## 0.1.3

### Patch Changes

- 2aacc6a: Complete the production Legal connection and document the authenticated snapshot reconciliation required when switching Billing authorities.

## 0.1.2

No changes in this release.

## 0.1.1

### Patch Changes

- 4858bab: Publish tested API/worker and web images to the private registry and deploy digest-pinned Balanz releases with Docker Compose while preserving the current DEV domains.
