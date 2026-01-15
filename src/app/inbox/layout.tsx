import { AppShell } from '@/components/layout';

export default function InboxLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
