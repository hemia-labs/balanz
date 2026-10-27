import { notFound } from "next/navigation";
import { BillingCheckoutReturn } from "@/features/billing/billing-checkout-return";

export default async function BillingCheckoutCancelPage({
  searchParams,
}: {
  searchParams: Promise<{ attemptId?: string }>;
}) {
  const { attemptId } = await searchParams;
  if (
    !attemptId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      attemptId,
    )
  )
    notFound();
  return <BillingCheckoutReturn key={attemptId} attemptId={attemptId} cancelled />;
}
