import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { dark } from '@clerk/themes';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';

export const metadata: Metadata = {
  title: 'EmergentOS | Secure Agent-Native OS for the C-Suite',
  description: 'Personal OS for Leaders - Data Sovereignty, Strategic Intelligence, Time Optimization',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider
      appearance={{
        baseTheme: dark,
        variables: {
          colorPrimary: '#4ECDC4',
          colorBackground: '#0D1117',
          colorInputBackground: '#161B22',
          colorInputText: '#E6EDF3',
          colorTextOnPrimaryBackground: '#0D1117',
          borderRadius: '0.625rem',
        },
        elements: {
          formButtonPrimary: 
            'bg-primary hover:bg-primary/90 text-primary-foreground',
          card: 'bg-card border border-border',
          headerTitle: 'text-foreground',
          headerSubtitle: 'text-muted-foreground',
          socialButtonsBlockButton: 
            'bg-secondary border border-border hover:bg-secondary/80 text-foreground',
          formFieldLabel: 'text-foreground',
          formFieldInput: 
            'bg-input border border-border text-foreground',
          footerActionLink: 'text-primary hover:text-primary/80',
        },
      }}
    >
      <html 
        lang="en" 
        className={`dark ${GeistSans.variable} ${GeistMono.variable}`}
        suppressHydrationWarning
      >
        <body className="min-h-screen bg-background font-sans antialiased">
          {children}
          <Toaster 
            position="bottom-right"
            toastOptions={{
              classNames: {
                toast: 'bg-card border-border',
                title: 'text-foreground',
                description: 'text-muted-foreground',
              },
            }}
          />
        </body>
      </html>
    </ClerkProvider>
  );
}
