import { wrap } from "./_lib/wrap.js";
import { validateTwilioRequest } from "./_lib/twilio.js";
import { updateCallStatus, finalizeBillingForCall } from "./_lib/voice.js";

/**
 * Twilio status callback webhook.
 * Configure per-number or per-app:
 *  Status Callback URL:
 *    https://<your-site>/.netlify/functions/voice-twilio-status
 *  Events: initiated, ringing, answered, completed
 */
export default wrap(async (req) => {
  const bodyText = await req.text();
  const params = Object.fromEntries(new URLSearchParams(bodyText));

  const url = new URL(req.url);
  const fullUrl = url.toString();

  const v = validateTwilioRequest({ req, url: fullUrl, params });
  if (!v.ok) return new Response(v.error, { status: v.status || 401, headers: { "content-type": "text/plain" } });

  const callSid = params.CallSid || params.CallSID;
  const status = (params.CallStatus || params.callStatus || "").toString();
  const dur = params.CallDuration ? parseInt(params.CallDuration, 10) : null;

  if (!callSid) return new Response("Missing CallSid", { status: 400 });

  const row = await updateCallStatus({ provider: "twilio", callSid, status, durationSeconds: Number.isFinite(dur) ? dur : null });
  if (!row) return new Response("OK", { status: 200 });

  // If completed, finalize billing rollups
  const terminal = ["completed","canceled","failed","busy","no-answer"].includes(status);
  if (terminal) await finalizeBillingForCall(row);

  return new Response("OK", { status: 200 });
});
