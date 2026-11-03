---
"api": minor
---

Adopt the published @hemia/payments 0.12.0 and resolve a Console connection once during API configuration initialization. Share the resolved configuration with the SDK, checkout return URLs and license snapshots while preserving existing authorization, MFA, CSRF and callbacks.

Support the four-variable Console delivery and retain explicit PAYMENTS_CONNECTION as a separate configuration source. Reject incomplete or mixed sources and keep Billing credentials out of the worker profile. Update the read-only connection check, examples and adoption documentation. No database migration is required.
