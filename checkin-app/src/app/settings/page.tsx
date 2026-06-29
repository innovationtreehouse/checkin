import { redirect } from "next/navigation";

// Settings has no landing of its own — first tab is the entry point.
export default function SettingsIndex() {
  redirect("/settings/membership");
}
