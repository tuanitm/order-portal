import { redirect } from "next/navigation";

/** /customer — where customers land after login; the storefront itself lives at the locale root. */
export default async function CustomerHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`/${locale}`);
}
