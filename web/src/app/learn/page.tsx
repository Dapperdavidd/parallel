import { redirect } from "next/navigation";

/**
 * The documentation used to be one long /learn page. It is now a section under
 * /docs, so keep the old address working for anything that already links to it.
 */
export default function LearnPage() {
  redirect("/docs");
}
