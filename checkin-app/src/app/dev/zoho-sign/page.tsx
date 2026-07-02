import { notFound } from "next/navigation";
import { config } from "@/lib/config";
import DevZohoSignClient from "./DevZohoSignClient";

export const dynamic = "force-dynamic";

/**
 * Dev-only stand-in for the Zoho embedded signing ceremony (see
 * docs/designs/ZOHO_SIGN_DEV_MOCK.md §4a). Reached two ways: the mock provider's
 * getEmbeddedSignUrl redirects the applicant here with ?rid=<zohoEnvelopeId>, and
 * the "Debug: Sign" dev nav item links here with no rid (a start/resume entry).
 * 404s the moment the mock isn't active (always in prod) so it can never surface
 * for real.
 */
export default async function DevZohoSignPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    if (!config.zohoMockActive()) notFound();
    const { rid } = await searchParams;
    return <DevZohoSignClient rid={typeof rid === "string" ? rid : null} />;
}
