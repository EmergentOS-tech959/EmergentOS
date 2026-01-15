import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

/**
 * Public routes that don't require authentication
 * - Landing page (/)
 * - Sign-in/Sign-up pages
 * - API webhooks (Nango and Inngest need server-to-server access)
 */
const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/nango/webhook(.*)',
  '/api/inngest(.*)',
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
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};

