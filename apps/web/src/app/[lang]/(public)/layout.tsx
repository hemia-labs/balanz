import { ThemeToggle } from "@/components/theme-toggle";

export default function PublicLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="relative min-h-screen w-full flex-1 bg-background text-foreground">
      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle />
      </div>
      {children}
    </div>
  );
}
