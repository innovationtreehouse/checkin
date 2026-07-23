import { redirect } from "next/navigation";

export default function MyActivitiesIndex() {
  redirect("/my-activities/events");
}
