"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Input } from "./ui/input";
import { authClient } from "@/lib/auth-client";
import { toast } from "sonner";
import { Mail, CheckCircle2 } from "lucide-react";

export function AuthForm({ signup = false }: { signup?: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectUrl = searchParams.get("redirect") || "/dashboard";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [magicLinkLoading, setMagicLinkLoading] = useState(false);
  const [error, setError] = useState("");
  const [checkEmailSent, setCheckEmailSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (signup && !name.trim()) {
      setError("Enter your name.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }

    setLoading(true);

    try {
      if (signup) {
        const res = await authClient.signUp.email({
          email,
          password,
          name,
          callbackURL: redirectUrl,
        });

        if (res.error) {
          setError(res.error.message || "Failed to create account. Try again.");
          setLoading(false);
          return;
        }

        toast.success("Account created successfully!");
        router.push(redirectUrl);
        router.refresh();
      } else {
        const res = await authClient.signIn.email({
          email,
          password,
          callbackURL: redirectUrl,
        });

        if (res.error) {
          setError(res.error.message || "Invalid email or password.");
          setLoading(false);
          return;
        }

        toast.success("Welcome back!");
        router.push(redirectUrl);
        router.refresh();
      }
    } catch (err: unknown) {
      const e = err as Error;
      setError(e.message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  const handleMagicLink = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Enter a valid email address to send a login link.");
      return;
    }

    setError("");
    setMagicLinkLoading(true);

    try {
      const res = await authClient.signIn.magicLink({
        email,
        callbackURL: redirectUrl,
      });

      if (res.error) {
        setError(res.error.message || "Failed to send login link.");
      } else {
        setCheckEmailSent(true);
        toast.success("Login link sent to your email!");
      }
    } catch (err: unknown) {
      const e = err as Error;
      setError(e.message || "An unexpected error occurred.");
    } finally {
      setMagicLinkLoading(false);
    }
  };

  if (checkEmailSent) {
    return (
      <main className="auth panel centered stack">
        <CheckCircle2 size={40} className="text-primary" />
        <h1>Check your email.</h1>
        <p className="lead">
          We sent a magic sign-in link to <strong>{email}</strong>. Click the link in the email to log in.
        </p>
        <button
          type="button"
          className="btn secondary"
          onClick={() => setCheckEmailSent(false)}
        >
          Back to sign in
        </button>
      </main>
    );
  }

  return (
    <main className="auth panel">
      <h1>{signup ? "Create an account." : "Welcome back."}</h1>
      <p className="lead">
        {signup
          ? "Create a designer workspace to personalize flyers."
          : "Sign in to manage your events and flyers."}
      </p>

      <form className="fields" noValidate onSubmit={handleSubmit}>
        {signup && (
          <label>
            Name
            <Input
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
            />
          </label>
        )}
        <label>
          Email
          <Input
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </label>
        <label>
          Password
          <Input
            name="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            autoComplete={signup ? "new-password" : "current-password"}
            required
          />
        </label>

        {error && (
          <p role="alert" className="danger">
            {error}
          </p>
        )}

        <button className="btn primary" disabled={loading || magicLinkLoading}>
          {loading ? "Please wait..." : signup ? "Sign up" : "Log in"}
        </button>

        {!signup && (
          <button
            type="button"
            className="btn secondary row spread"
            disabled={loading || magicLinkLoading}
            onClick={handleMagicLink}
          >
            <Mail size={16} />
            <span>{magicLinkLoading ? "Sending link..." : "Sign in with email link"}</span>
          </button>
        )}

        <p className="hint">
          {signup ? "Already have an account?" : "New here?"}{" "}
          <Link href={signup ? "/login" : "/signup"}>
            {signup ? "Log in" : "Sign up"}
          </Link>
        </p>
      </form>
    </main>
  );
}
