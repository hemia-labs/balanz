export const paymentsConnection = {
  issuer: 'http://localhost:3000',
  tokenUrl: 'http://localhost:3000/oauth/token',
  clientId: 'balanz-service',
  baseUrl: 'http://localhost:3015/api/v1',
  audience: 'billing-api',
  productCode: 'balanz_cfdi',
  successUrl: 'http://localhost:5181/success',
  cancelUrl: 'http://localhost:5181/cancel',
  allowHttpLoopback: true,
  requestTimeoutMs: 100,
};
