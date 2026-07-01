import { redirect } from "next/navigation";

// Attendance inbox moved to its own subtab path; bare /my-programs lands there.
export default function MyProgramsIndex() {
  redirect("/my-programs/attendance");
}
