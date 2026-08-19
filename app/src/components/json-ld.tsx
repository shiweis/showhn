import { headers } from "next/headers";
import { serializeJsonForHtml } from "@/lib/json-ld";

export async function JsonLd({ data }: { data: unknown }) {
  const nonce = (await headers()).get("x-nonce") || undefined;
  return (
    <script
      nonce={nonce}
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonForHtml(data) }}
    />
  );
}
