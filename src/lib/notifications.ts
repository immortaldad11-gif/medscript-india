// Notification abstraction — Section 2.2.6 + Risk Register (provider-agnostic so we
// can swap WhatsApp providers without touching callers). Phase 1 ships a Gupshup
// adapter plus a "log" driver for local development.

export interface WhatsAppMessage {
  to: string; // E.164
  body: string;
  mediaUrl?: string; // e.g. presigned PDF URL
  filename?: string;
}

interface NotificationDriver {
  sendWhatsApp(msg: WhatsAppMessage): Promise<{ delivered: boolean; providerId?: string }>;
}

const logDriver: NotificationDriver = {
  async sendWhatsApp(msg) {
    console.log("[notifications:log] WhatsApp →", msg.to, "|", msg.body, msg.mediaUrl ? `| media: ${msg.mediaUrl}` : "");
    return { delivered: true, providerId: `log-${Date.now()}` };
  },
};

const gupshupDriver: NotificationDriver = {
  async sendWhatsApp(msg) {
    const apiKey = process.env.GUPSHUP_API_KEY;
    const source = process.env.GUPSHUP_SOURCE_NUMBER;
    const appName = process.env.GUPSHUP_APP_NAME;
    if (!apiKey || !source || !appName) {
      console.warn("[notifications:gupshup] missing credentials, falling back to log driver");
      return logDriver.sendWhatsApp(msg);
    }

    const params = new URLSearchParams({
      channel: "whatsapp",
      source,
      destination: msg.to.replace(/^\+/, ""),
      "src.name": appName,
      message: JSON.stringify(
        msg.mediaUrl
          ? { type: "file", url: msg.mediaUrl, filename: msg.filename ?? "prescription.pdf", caption: msg.body }
          : { type: "text", text: msg.body },
      ),
    });

    const res = await fetch("https://api.gupshup.io/wa/api/v1/msg", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", apikey: apiKey },
      body: params.toString(),
    });
    const delivered = res.ok;
    if (!delivered) console.error("[notifications:gupshup] send failed", res.status, await res.text().catch(() => ""));
    return { delivered, providerId: undefined };
  },
};

function driver(): NotificationDriver {
  return process.env.NOTIFICATIONS_DRIVER === "gupshup" ? gupshupDriver : logDriver;
}

export async function sendWhatsApp(msg: WhatsAppMessage) {
  return driver().sendWhatsApp(msg);
}

// SMS fallback — Section 2.2.6 (AWS SNS / Textlocal, DLT-registered sender IDs).
// Phase 1 of Phase 2 logs; production wires Textlocal for India-local delivery.
export interface SmsMessage {
  to: string;
  body: string;
}

export async function sendSms(msg: SmsMessage): Promise<{ delivered: boolean }> {
  console.log("[notifications:sms] SMS →", msg.to, "|", msg.body);
  return { delivered: true };
}

// Deliver via WhatsApp, falling back to SMS if WhatsApp delivery fails.
export async function notifyWithFallback(to: string, body: string, mediaUrl?: string) {
  const wa = await sendWhatsApp({ to, body, mediaUrl });
  if (wa.delivered) return { channel: "whatsapp" as const, delivered: true };
  const sms = await sendSms({ to, body });
  return { channel: "sms" as const, delivered: sms.delivered };
}
