"use client";

import Link from "next/link";
import { ArrowUpRight, LogOut, User } from "lucide-react";
import { authClient, useSession } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export function AuthNav() {
  const { data: session, isPending } = useSession();
  const router = useRouter();

  if (isPending) {
    return <span className="hint">...</span>;
  }

  if (session?.user) {
    return (
      <div className="row">
        <Link href="/dashboard" className="login">
          <User size={15} /> {session.user.name || "Dashboard"}
        </Link>
        <button
          className="iconbtn"
          aria-label="Log out"
          title="Log out"
          onClick={async () => {
            await authClient.signOut();
            toast.success("Logged out");
            router.push("/");
            router.refresh();
          }}
        >
          <LogOut size={15} />
        </button>
      </div>
    );
  }

  return (
    <Link href="/login" className="login">
      Log in <ArrowUpRight size={15} />
    </Link>
  );
}
