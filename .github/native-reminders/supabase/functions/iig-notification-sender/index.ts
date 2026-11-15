import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { sendNativeReminders } from "./native-reminders.mjs";
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

type NotificationEvent = {
  id: string;
  group_pin: string;
  title: string;
  message: string;
  attempts: number;
};

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

export default {
  fetch: async (request: Request) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST required" }), {
      status: 405,
      headers: jsonHeaders,
    });
  }

  const expectedRequestKey = Deno.env.get("IIG_NOTIFICATION_CRON_SECRET");
  const suppliedRequestKey = request.headers.get("x-iig-notification-key");

  if (!expectedRequestKey || suppliedRequestKey !== expectedRequestKey) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: jsonHeaders,
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPublicKey = Deno.env.get("IIG_VAPID_PUBLIC_KEY");
  const vapidPrivateKey = Deno.env.get("IIG_VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("IIG_VAPID_SUBJECT");

  if (
    !supabaseUrl || !serviceRoleKey || !vapidPublicKey ||
    !vapidPrivateKey || !vapidSubject
  ) {
    return new Response(JSON.stringify({ error: "Missing server configuration" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: events, error: eventsError } = await db
    .from("iig_notification_events")
    .select("id,group_pin,title,message,attempts")
    .eq("status", "pending")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(20);

  if (eventsError) {
    return new Response(JSON.stringify({ error: eventsError.message }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  const results: Array<Record<string, unknown>> = [];

  for (const event of (events ?? []) as NotificationEvent[]) {
    const { data: setting } = await db
      .from("iig_notification_settings")
      .select("enabled")
      .eq("group_pin", event.group_pin)
      .maybeSingle();

    if (!setting?.enabled) {
      results.push({ id: event.id, status: "disabled" });
      continue;
    }

    const { data: claimed } = await db
      .from("iig_notification_events")
      .update({
        status: "processing",
        attempts: Number(event.attempts || 0) + 1,
        last_error: null,
      })
      .eq("id", event.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (!claimed) continue;

    const { data: subscriptions, error: subscriptionsError } = await db
      .from("iig_push_subscriptions")
      .select("id,endpoint,p256dh,auth")
      .eq("group_pin", event.group_pin)
      .eq("enabled", true);

    if (subscriptionsError) {
      await db.from("iig_notification_events").update({
        status: "failed",
        last_error: subscriptionsError.message,
      }).eq("id", event.id);
      results.push({ id: event.id, status: "failed" });
      continue;
    }

    if (!subscriptions?.length) {
      await db.from("iig_notification_events").update({
        status: "cancelled",
        last_error: "No active notification subscriptions",
      }).eq("id", event.id);
      results.push({ id: event.id, status: "no_subscriptions" });
      continue;
    }

    const payload = JSON.stringify({
      title: event.title || "I'm In Golf",
      body: event.message,
      icon: "https://imingolf.co.uk/app/icon-192.png",
      badge: "https://imingolf.co.uk/app/icon-192.png",
      url: `https://imingolf.co.uk/app/?pin=${encodeURIComponent(event.group_pin)}`,
      tag: `iig-${event.id}`,
    });

    let sent = 0;
    const errors: string[] = [];

    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
          },
          payload,
          { TTL: 60 * 60 * 12, urgency: "normal" },
        );
        sent += 1;
      } catch (error) {
        const statusCode = Number((error as { statusCode?: number })?.statusCode || 0);
        const message = error instanceof Error ? error.message : String(error);
        errors.push(message.slice(0, 300));

        if (statusCode === 404 || statusCode === 410) {
          await db.from("iig_push_subscriptions")
            .update({ enabled: false, updated_at: new Date().toISOString() })
            .eq("id", subscription.id);
        }
      }
    }

    await db.from("iig_notification_events").update(
      sent > 0
        ? {
          status: "sent",
          sent_at: new Date().toISOString(),
          last_error: errors.length ? errors.join(" | ").slice(0, 1000) : null,
        }
        : {
          status: "failed",
          last_error: (errors.join(" | ") || "No notification was delivered").slice(0, 1000),
        },
    ).eq("id", event.id);

    results.push({ id: event.id, status: sent > 0 ? "sent" : "failed", sent });
  }

  const native = await sendNativeReminders({ db, env: (name: string) => Deno.env.get(name) });
  return new Response(JSON.stringify({ processed: results.length, results, native }), {
    status: 200,
    headers: jsonHeaders,
  });
  },
};

