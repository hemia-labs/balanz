import { notFound } from "next/navigation";
import { BillingCheckoutReturn } from "@/features/billing/billing-checkout-return";

export default async function BillingCheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ attemptId?: string; token?: string; PayerID?: string; subscription_id?: string }>;
}) {
  const { attemptId, token, PayerID, subscription_id } = await searchParams;
  if (
    !attemptId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      attemptId,
    )
  )
    notFound();
  return <BillingCheckoutReturn key={attemptId} attemptId={attemptId} cancelled={false} returnedFromPayment={Boolean(token && (PayerID || subscription_id))} />;
}
