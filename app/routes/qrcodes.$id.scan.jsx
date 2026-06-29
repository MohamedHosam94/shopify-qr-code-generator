import { redirect } from "react-router";
import invariant from "tiny-invariant";
import { isbot } from "isbot";

import { unauthenticated } from "../shopify.server";
import {
  getDestinationUrl,
  incrementQRCodeScansWithAnalytics,
  parseUserAgent,
} from "../models/QRCode.server";

export const loader = async ({ request, params }) => {
  // [START validate]
  invariant(params.id, "Could not find QR code destination");

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  invariant(shop, "Missing shop parameter");

  const { admin } = await unauthenticated.admin(shop);
  // [END validate]

  // [START fetch]
  const response = await admin.graphql(
    `
      query GetQRCodeScan($handle: MetaobjectHandleInput!) {
        metaobjectByHandle(handle: $handle) {
          id
          product: field(key: "product") {
            reference {
              ... on Product { handle }
            }
          }
          productVariant: field(key: "product_variant") {
            reference {
              ... on ProductVariant { legacyResourceId }
            }
          }
          destination: field(key: "destination") { jsonValue }
          scans: field(key: "scans") { jsonValue }
          analytics: field(key: "analytics") { jsonValue }
        }
      }
    `,
    {
      variables: {
        handle: { type: "$app:qrcode", handle: params.id },
      },
    },
  );

  const { data } = await response.json();
  const metaobject = data?.metaobjectByHandle;
  invariant(metaobject, "Could not find QR code destination");
  // [END fetch]

  // [START increment]
  const userAgent = request.headers.get("user-agent") || "";
  const isBotUser = isbot(userAgent);

  if (!isBotUser) {
    let analytics = { os: {}, browser: {}, history: [] };
    if (metaobject.analytics?.jsonValue) {
      try {
        analytics = JSON.parse(metaobject.analytics.jsonValue);
      } catch (e) {
        console.error("Failed to parse analytics JSON", e);
      }
    }

    if (!analytics.os) analytics.os = {};
    if (!analytics.browser) analytics.browser = {};
    if (!analytics.history) analytics.history = [];

    const { os, browser } = parseUserAgent(userAgent);
    analytics.os[os] = (analytics.os[os] || 0) + 1;
    analytics.browser[browser] = (analytics.browser[browser] || 0) + 1;

    analytics.history.unshift({
      timestamp: new Date().toISOString(),
      os,
      browser,
    });

    if (analytics.history.length > 10) {
      analytics.history = analytics.history.slice(0, 10);
    }

    const currentScans = metaobject.scans?.jsonValue ?? 0;
    await incrementQRCodeScansWithAnalytics(metaobject.id, currentScans, analytics, admin.graphql);
  }
  // [END increment]

  // [START redirect]
  const qrCode = {
    destination: metaobject.destination?.jsonValue,
    productHandle: metaobject.product?.reference?.handle,
    productVariantLegacyId: metaobject.productVariant?.reference?.legacyResourceId,
  };

  return redirect(getDestinationUrl(qrCode, shop));
  // [END redirect]
};
