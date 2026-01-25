/**
 * EmergentOS - Onboarding Layout
 * 
 * Minimal layout for the onboarding flow (no AppShell/sidebar).
 */

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      {/* Subtle background gradient */}
      <div className="fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-br from-teal-500/[0.02] via-transparent to-sky-500/[0.02]" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-gradient-radial from-teal-500/[0.03] to-transparent blur-3xl" />
      </div>
      
      {children}
    </div>
  );
}
