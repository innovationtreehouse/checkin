import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth-options";

const handler = NextAuth(authOptions);

// Export for App Router API routes
export { handler as GET, handler as POST };
// Re-export authOptions for backward compat with any routes that still import from here
export { authOptions };
