import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

/**
 * Public routes that don't require authentication
 * - Landing page (/)
 * - Sign-in/Sign-up pages
 * - API routes that need external access (webhooks, Inngest)
 */
const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/inngest(.*)',      // Inngest function registration and execution
  '/api/nango/webhook(.*)', // Nango OAuth webhooks
]);

export default clerkMiddleware(async (auth, req) => {
  // If the route is not public, protect it (require authentication)
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
  ],
};
