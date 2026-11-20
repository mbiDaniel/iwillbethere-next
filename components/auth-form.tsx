"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Input } from "./ui/input";
export function AuthForm({ signup = false }: { signup?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  return (
    <main className="auth panel">
      <h1>{signup ? "Create an account." : "Welcome back."}</h1>
      <p className="lead">
        Demo workspace. Use sample details, not a real password.
      </p>
      <form
        className="fields"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          if (signup && !String(f.get("name")).trim())
            return setError("Enter your name.");
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(f.get("email"))))
            return setError("Enter a valid email address.");
          if (String(f.get("password")).length < 8)
            return setError(
              "Use at least 8 characters for your demo password.",
            );
          // TODO: wire to backend — replace demo navigation with real authentication.
          router.push("/dashboard");
        }}
      >
        {signup && (
          <label>
            Name
            <Input name="name" autoComplete="off" required />
          </label>
        )}
        <label>
          Email
          <Input
            name="email"
            type="email"
            placeholder="you@example.com"
            required
          />
        </label>
        <label>
          Password
          <Input
            name="password"
            type="password"
            minLength={8}
            autoComplete="off"
            required
          />
        </label>
        {error && (
          <p role="alert" className="danger">
            {error}
          </p>
        )}
        <button className="btn primary">{signup ? "Sign up" : "Log in"}</button>
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
