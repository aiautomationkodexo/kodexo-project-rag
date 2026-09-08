import { redirect } from "next/navigation";

/**
 * The app's front door.
 *
 * Was `/projects` — a list with no context. The dashboard answers "what is the
 * state of things" before asking the user to pick a page, which is the whole
 * reason it exists.
 */
export default function Home() {
  redirect("/dashboard");
}
