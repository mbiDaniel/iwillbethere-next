import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { env } from "@/lib/env";
import { emailProvider } from "@/lib/email";
import { headers } from "next/headers";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: [env.BETTER_AUTH_URL],
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    async sendResetPassword({ user, url }) {
      await emailProvider.sendEmail({
        to: user.email,
        subject: "Reset your password for I Will Be There",
        html: `<p>Click here to reset your password: <a href="${url}">${url}</a></p>`,
        text: `Reset your password: ${url}`,
      });
    },
  },
  emailVerification: {
    sendOnSignUp: false,
    async sendVerificationEmail({ user, url }) {
      await emailProvider.sendEmail({
        to: user.email,
        subject: "Verify your email for I Will Be There",
        html: `<p>Click here to verify your email: <a href="${url}">${url}</a></p>`,
        text: `Verify your email: ${url}`,
      });
    },
  },
  plugins: [
    magicLink({
      async sendMagicLink({ email, url }) {
        await emailProvider.sendEmail({
          to: email,
          subject: "Your login link for I Will Be There",
          html: `<p>Click here to log in: <a href="${url}">${url}</a></p>`,
          text: `Log in: ${url}`,
        });
      },
    }),
    nextCookies(),
  ],
  rateLimit: {
    enabled: true,
    storage: "database",
  },
});

export async function getSession() {
  const reqHeaders = await headers();
  return await auth.api.getSession({
    headers: reqHeaders,
  });
}

export async function requireUser() {
  const session = await getSession();
  if (!session?.user) {
    throw new Error("Unauthorized: Authentication required");
  }
  return session.user;
}
