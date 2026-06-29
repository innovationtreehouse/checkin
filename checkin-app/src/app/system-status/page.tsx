import { redirect } from "next/navigation";

export default function SystemStatusIndex() {
  redirect("/system-status/health");
}
