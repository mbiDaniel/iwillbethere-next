import { config } from "dotenv";
config();

import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().default("postgresql://postgres:postgres@localhost:5432/iwillbethere"),
  BETTER_AUTH_SECRET: z.string().min(16, "BETTER_AUTH_SECRET must be at least 16 characters").default("dev-secret-super-long-better-auth-secret-key-32chars"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
  R2_ACCOUNT_ID: z.string().default("test-account-id"),
  R2_ACCESS_KEY_ID: z.string().default("test-access-key-id"),
  R2_SECRET_ACCESS_KEY: z.string().default("test-secret-access-key"),
  R2_BUCKET_PRIVATE: z.string().default("iwillbethere-private"),
  R2_BUCKET_PUBLIC: z.string().default("iwillbethere-public"),
  R2_PUBLIC_BASE_URL: z.string().default("http://localhost:3000/api/public/assets"),
  EMAIL_PROVIDER: z.enum(["console", "resend"]).default("console"),
  RESEND_API_KEY: z.string().optional(),
  DAILY_ANALYTICS_SECRET: z.string().default("daily-analytics-salt-secret-key-rotating"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type Env = z.infer<typeof envSchema>;

let parsedEnv: Env | null = null;

export function getEnv(): Env {
  if (parsedEnv) return parsedEnv;

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("❌ Invalid environment variables:", result.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables");
  }

  parsedEnv = result.data;
  return parsedEnv;
}

export const env = getEnv();
