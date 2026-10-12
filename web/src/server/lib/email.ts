import "server-only";
import { getServerEnv } from "../../env.server";

export type EmailContent = {
  title: string;
  message: string;
  actionLabel?: string;
  actionUrl?: string;
  unsubscribeUrl?: string;
};

export type SendEmailParams = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type SendEmailResult =
  | { ok: true; id?: string }
  | { ok: false; reason: "not_configured" | "request_failed" | "timeout" };

export function buildEmailHtml(params: EmailContent): string {
  const { title, message, actionLabel, actionUrl, unsubscribeUrl } = params;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
</head>
<body style="margin:0;padding:32px 16px;background-color:#151310;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#faf7f0;">
  <table align="center" width="100%" style="max-width:540px;background-color:#1d1b16;border:1px solid #33312c;border-radius:10px;padding:32px;border-collapse:separate;">
    <tr>
      <td style="padding-bottom:24px;border-bottom:1px solid #33312c;">
        <span style="font-size:18px;font-weight:700;letter-spacing:0.05em;color:#faf7f0;">MEAW</span>
      </td>
    </tr>
    <tr>
      <td style="padding:28px 0 16px;">
        <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;color:#faf7f0;">${title}</h1>
        <p style="margin:0;font-size:15px;line-height:24px;color:#a8a092;">${message}</p>
      </td>
    </tr>
    ${
      actionUrl && actionLabel
        ? `<tr>
      <td style="padding-top:16px;padding-bottom:28px;">
        <a href="${actionUrl}" style="display:inline-block;padding:10px 22px;background-color:#faf7f0;color:#151310;text-decoration:none;font-size:13px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;border-radius:9999px;">${actionLabel}</a>
      </td>
    </tr>`
        : ""
    }
    ${
      unsubscribeUrl
        ? `<tr>
      <td style="padding-top:20px;border-top:1px solid #33312c;font-size:12px;color:#6b655a;line-height:18px;">
        This email was sent to your registered address for payment notifications.<br>
        <a href="${unsubscribeUrl}" style="color:#a8a092;text-decoration:underline;">Unsubscribe from all notifications</a>
      </td>
    </tr>`
        : ""
    }
  </table>
</body>
</html>`;
}

export function buildEmailText(params: EmailContent): string {
  const parts = [`MEAW - ${params.title}`, "", params.message];
  if (params.actionLabel && params.actionUrl) {
    parts.push("", `${params.actionLabel}: ${params.actionUrl}`);
  }
  if (params.unsubscribeUrl) {
    parts.push("", `Unsubscribe: ${params.unsubscribeUrl}`);
  }
  return parts.join("\n");
}

export async function sendEmail(
  params: SendEmailParams,
): Promise<SendEmailResult> {
  const env = getServerEnv();
  if (!env.RESEND_API_KEY) {
    return { ok: false, reason: "not_configured" };
  }

  const from = env.EMAIL_FROM || "Meaw <hello@meaw.xyz>";
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error("[email] Resend returned error status:", response.status);
      return { ok: false, reason: "request_failed" };
    }

    const data = (await response.json()) as { id?: string };
    return { ok: true, id: data.id };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      console.error("[email] Request timed out");
      return { ok: false, reason: "timeout" };
    }
    console.error("[email] Failed to send email:", error);
    return { ok: false, reason: "request_failed" };
  }
}
