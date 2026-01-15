import { SignUp } from '@clerk/nextjs';
import { Shield } from 'lucide-react';

export default function SignUpPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      {/* Logo */}
      <div className="flex items-center gap-2 mb-8">
        <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center">
          <Shield className="h-6 w-6 text-primary-foreground" />
        </div>
        <span className="text-2xl font-semibold text-foreground">EmergentOS</span>
      </div>
      
      {/* Clerk Sign Up Component */}
      <SignUp 
        appearance={{
          elements: {
            rootBox: 'mx-auto',
            card: 'bg-card border border-border shadow-xl',
            headerTitle: 'text-foreground',
            headerSubtitle: 'text-muted-foreground',
            socialButtonsBlockButton: 
              'bg-secondary border border-border hover:bg-secondary/80 text-foreground',
            socialButtonsBlockButtonText: 'text-foreground font-medium',
            dividerLine: 'bg-border',
            dividerText: 'text-muted-foreground',
            formFieldLabel: 'text-foreground',
            formFieldInput: 
              'bg-background border border-border text-foreground focus:ring-primary focus:border-primary',
            formButtonPrimary: 
              'bg-primary hover:bg-primary/90 text-primary-foreground',
            footerActionLink: 'text-primary hover:text-primary/80',
            identityPreviewEditButton: 'text-primary hover:text-primary/80',
          },
        }}
        routing="path"
        path="/sign-up"
        signInUrl="/sign-in"
      />
      
      {/* Footer */}
      <p className="mt-8 text-sm text-muted-foreground">
        Phase 0 — Architectural Validation
      </p>
    </div>
  );
}

