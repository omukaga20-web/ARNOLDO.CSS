import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const storefrontOrigin = "https://www.artradeslab.site";
const referencePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed." });

  const authorization = request.headers.get("Authorization");
  const token = authorization?.replace(/^Bearer\s+/i, "");
  if (!authorization || !token) return jsonResponse(401, { error: "Sign in before starting checkout." });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: "Invalid checkout request." });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse(400, { error: "Invalid checkout request." });
  }

  const referenceValue = (body as Record<string, unknown>).order_reference;
  const reference = typeof referenceValue === "string" ? referenceValue : "";
  if (!referencePattern.test(reference)) return jsonResponse(400, { error: "Invalid order reference." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseKey) return jsonResponse(503, { error: "Supabase checkout is not configured." });

  const supabase = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) return jsonResponse(401, { error: "Your sign-in has expired. Sign in and try again." });

  const { data: order, error: orderError } = await supabase
    .from("customer_orders")
    .select("reference, amount, items, payment_method, payment_status, phone_number")
    .eq("reference", reference)
    .eq("user_id", authData.user.id)
    .single();

  if (orderError || !order) return jsonResponse(404, { error: "This order was not found for your account." });
  if (order.payment_method !== "mpesa") return jsonResponse(400, { error: "This order is not configured for M-Pesa." });
  if (order.payment_status !== "pending") return jsonResponse(409, { error: "This order is no longer awaiting payment." });
  if (!Array.isArray(order.items) || order.items.length < 1 || typeof order.phone_number !== "string" || !order.phone_number.trim()) {
    return jsonResponse(400, { error: "The saved order is missing valid payment details." });
  }

  try {
    const response = await fetch(new URL("/api/payments/create", storefrontOrigin), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: authorization,
        Origin: storefrontOrigin,
      },
      body: JSON.stringify({
        reference: order.reference,
        phoneNumber: order.phone_number,
        items: order.items,
      }),
      signal: AbortSignal.timeout(25000),
    });

    const responseBody = await response.text();
    return new Response(responseBody, {
      status: response.status,
      headers: {
        ...corsHeaders,
        "Content-Type": response.headers.get("Content-Type") || "application/json; charset=utf-8",
      },
    });
  } catch {
    return jsonResponse(503, { error: "The storefront payment service is unavailable. Please try again." });
  }
});
