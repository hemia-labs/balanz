export default function PublicLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <div className="min-h-screen w-full flex-1 bg-background text-foreground">{children}</div>;
}
