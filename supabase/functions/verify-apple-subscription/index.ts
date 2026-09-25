import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SignJWT, importPKCS8, decodeJwt } from "npm:jose@6";

const APPLE_ISSUER_ID = Deno.env.get("APPLE_ISSUER_ID")!;
const APPLE_KEY_ID = Deno.env.get("APPLE_KEY_ID")!;
const APPLE_PRIVATE_KEY = Deno.env.get("APPLE_PRIVATE_KEY")!;
const APPLE_BUNDLE_ID = Deno.env.get("APPLE_BUNDLE_ID")!;
const APPLE_PRODUCT_ID = Deno.env.get("APPLE_PRODUCT_ID")!;

function decodeJwsPayload(jws: string) {
  return decodeJwt(jws);
}

async function createAppleApiToken() {
  const privateKeyPem = APPLE_PRIVATE_KEY.replace(/\\n/g, "\n").trim();
  console.log("APPLE DEBUG: about to import private key");
  let privateKey;
  try {
    privateKey = await importPKCS8(privateKeyPem, "ES256");
    console.log("APPLE DEBUG: private key imported successfully");
  } catch (error) {
    throw new Error(`PRIVATE_KEY_IMPORT_FAILED: ${error instanceof Error ? error.message : String(error)}`);
  }
  const now = Math.floor(Date.now() / 1000);

  return await new SignJWT({
    bid: APPLE_BUNDLE_ID,
  })
    .setProtectedHeader({
      alg: "ES256",
      kid: APPLE_KEY_ID,
      typ: "JWT",
    })
    .setIssuer(APPLE_ISSUER_ID)
    .setAudience("appstoreconnect-v1")
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(privateKey);
}

async function askApple(transactionId: string, sandbox = false) {
  const token = await createAppleApiToken();

  const host = sandbox
? "https://api.storekit-sandbox.apple.com"
 : "https://api.storekit.apple.com";

  return await fetch(
    `${host}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );
}

export default {
  fetch: withSupabase(
    { auth: ["publishable", "secret"] },
    async (req, ctx) => {
      try {
        const body = await req.json();
        const transactionId = String(body?.transactionId || "").trim();
        const groupPin = String(body?.groupPin || "").trim();

        if (!transactionId || !groupPin) {
          return Response.json(
            { ok: false, error: "transactionId and groupPin are required" },
            { status: 400 },
          );
        }

        let appleResponse = await askApple(transactionId, false);

        if (appleResponse.status === 404 || appleResponse.status === 401) {
          appleResponse = await askApple(transactionId, true);
        }

        if (!appleResponse.ok) {
          return Response.json(
            {
              ok: false,
              error: "Apple could not verify this transaction",
              appleStatus: appleResponse.status,
            },
            { status: 400 },
          );
        }

        const appleData = await appleResponse.json();
        const signedTransactionInfo = appleData?.signedTransactionInfo;

        if (!signedTransactionInfo) {
          throw new Error("Apple returned no signed transaction");
        }

        const transaction = decodeJwsPayload(signedTransactionInfo);

        if (transaction.bundleId !== APPLE_BUNDLE_ID) {
          throw new Error("Bundle ID does not match");
        }

        if (transaction.productId !== APPLE_PRODUCT_ID) {
          throw new Error("Product ID does not match");
        }

        if (String(transaction.transactionId) !== transactionId) {
          throw new Error("Transaction ID does not match");
        }

        const expiresDate = Number(transaction.expiresDate || 0);

        if (!expiresDate || expiresDate <= Date.now()) {
          return Response.json(
            { ok: false, error: "Subscription is not active" },
            { status: 400 },
          );
        }

        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

        if (!supabaseUrl || !serviceRoleKey) {
          throw new Error("Supabase server configuration is incomplete");
        }

        const supabase = createClient(supabaseUrl, serviceRoleKey);
        const renewalDate = new Date(expiresDate).toISOString().slice(0, 10);

        const { data: updatedGroup, error: updateError } = await supabase
          .from("tens_in_groups")
          .update({
            plan_type: "plus",
            paid_status: "paid",
            renewal_date: renewalDate,
            status: "active",
            updated_at: new Date().toISOString(),
          })
          .eq("group_pin", groupPin)
          .select("group_pin")
          .maybeSingle();

        if (updateError) {
          throw new Error(`PLUS_ACTIVATION_FAILED: ${updateError.message}`);
        }

        if (!updatedGroup) {
          throw new Error(`GROUP_NOT_FOUND: ${groupPin}`);
        }

        console.log(`APPLE PLUS ACTIVATED: group ${groupPin} until ${renewalDate}`);

        return Response.json({
          ok: true,
          verified: true,
          groupPin,
          productId: transaction.productId,
          transactionId: transaction.transactionId,
          originalTransactionId: transaction.originalTransactionId,
          expiresDate,
          environment: transaction.environment,
        });
      } catch (error) {
        console.error("APPLE VERIFY ERROR", error);

        return Response.json(
          {
            ok: false,
            error: "Apple subscription verification failed",
            detail: error instanceof Error ? error.message : String(error),
          },
          { status: 500 },
        );
      }
    },
  ),
};
