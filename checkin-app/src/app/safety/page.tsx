import { redirect } from "next/navigation";

export default function SafetyIndex() {
  // Tabs live in the layout; the hub redirects to the first tab.
  redirect("/safety/emergency-contacts");
}
