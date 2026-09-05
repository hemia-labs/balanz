import { AcceptInvitation } from "@/features/team/accept-invitation";

export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  return <AcceptInvitation locale={lang} />;
}
