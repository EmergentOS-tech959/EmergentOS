'use client';

import { SignInButton, SignedIn, SignedOut, UserButton } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Shield, Zap, Lock, ArrowRight } from 'lucide-react';

export default function LandingPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <Shield className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-semibold text-foreground">EmergentOS</span>
          </div>
          
          <div className="flex items-center gap-4">
            <SignedOut>
              <SignInButton mode="modal">
                <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
                  Sign In
                </Button>
              </SignInButton>
              <SignInButton mode="modal">
                <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                  Get Started
                </Button>
              </SignInButton>
            </SignedOut>
            <SignedIn>
              <Button 
                onClick={() => router.push('/dashboard')}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Go to Dashboard
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <UserButton 
                afterSignOutUrl="/"
                appearance={{
                  elements: {
                    avatarBox: 'h-9 w-9',
                  },
                }}
              />
            </SignedIn>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="container mx-auto px-6">
        <section className="py-24 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 mb-8">
            <Zap className="h-4 w-4 text-primary" />
            <span className="text-sm text-primary font-medium">Phase 0 — Architectural Validation</span>
          </div>
          
          <h1 className="text-5xl md:text-6xl font-bold text-foreground mb-6 tracking-tight">
            Executive Decision
            <br />
            <span className="text-primary">Intelligence Platform</span>
          </h1>
          
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-12">
            Synthesize your Gmail, Calendar, and Drive into strategic briefings.
            This validation sprint tests the security-first data pipeline.
          </p>

          <div className="flex items-center justify-center gap-4">
            <SignedOut>
              <SignInButton mode="modal">
                <Button size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90 glow-primary">
                  <Lock className="mr-2 h-5 w-5" />
                  Sign in with Google
                </Button>
              </SignInButton>
            </SignedOut>
            <SignedIn>
              <Button 
                size="lg" 
                onClick={() => router.push('/dashboard')}
                className="bg-primary text-primary-foreground hover:bg-primary/90 glow-primary"
              >
                Go to Dashboard
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </SignedIn>
          </div>
        </section>

        {/* Feature Cards */}
        <section className="py-16 grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          <FeatureCard
            icon={<Shield className="h-6 w-6 text-primary" />}
            title="Zero-Knowledge Security"
            description="DLP scanning before any data touches the LLM. Your data stays yours."
          />
          <FeatureCard
            icon={<Zap className="h-6 w-6 text-primary" />}
            title="Inngest Orchestration"
            description="Event-driven workflows with built-in observability and retry logic."
          />
          <FeatureCard
            icon={<Lock className="h-6 w-6 text-primary" />}
            title="Blocking Security Gate"
            description="Testing the latency feel of synchronous DLP verification."
          />
        </section>

        {/* Architecture Preview */}
        <section className="py-16 text-center">
          <h2 className="text-2xl font-semibold text-foreground mb-8">Data Flow Architecture</h2>
          <div className="inline-flex items-center gap-2 flex-wrap justify-center text-sm font-mono bg-card border border-border rounded-lg px-6 py-4">
            <span className="text-muted-foreground">Google</span>
            <ArrowRight className="h-4 w-4 text-primary" />
            <span className="text-foreground">Clerk Auth</span>
            <ArrowRight className="h-4 w-4 text-primary" />
            <span className="text-foreground">Nango OAuth</span>
            <ArrowRight className="h-4 w-4 text-primary" />
            <span className="text-foreground">Inngest</span>
            <ArrowRight className="h-4 w-4 text-primary" />
            <span className="text-primary font-semibold">[2s DLP Gate]</span>
            <ArrowRight className="h-4 w-4 text-primary" />
            <span className="text-foreground">Supabase</span>
            <ArrowRight className="h-4 w-4 text-primary" />
            <span className="text-muted-foreground">UI</span>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-8 mt-16">
        <div className="container mx-auto px-6 text-center text-sm text-muted-foreground">
          <p>EmergentOS Phase 0 — Architectural Validation Sprint</p>
          <p className="mt-2">Built with Next.js, Clerk, Nango, Inngest, and Supabase</p>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ 
  icon, 
  title, 
  description 
}: { 
  icon: React.ReactNode; 
  title: string; 
  description: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-6 card-hover">
      <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-muted-foreground text-sm">{description}</p>
    </div>
  );
}
