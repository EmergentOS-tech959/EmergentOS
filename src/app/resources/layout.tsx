import { AppShell } from '@/components/layout';

export default function ResourcesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
