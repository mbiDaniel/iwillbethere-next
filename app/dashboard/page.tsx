import { Dashboard } from "@/components/dashboard";
import { requireUser } from "@/lib/auth";
import { getUserEvents } from "@/lib/data/events";
import { redirect } from "next/navigation";

export default async function Page() {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect("/login?redirect=/dashboard");
  }

  const events = await getUserEvents(user.id);
  return <Dashboard initialEvents={events} />;
}
