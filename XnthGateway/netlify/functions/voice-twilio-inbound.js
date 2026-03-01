import { wrap } from "./_lib/wrap.js";
import { validateTwilioRequest, sayGatherTwiml, twiml } from "./_lib/twilio.js";
import { getVoiceNumberByTo, upsertCall, addCallMessage } from "./_lib/voice.js";

/**
 * Twilio inbound webhook (Voice).
 * Configure in Twilio number: Voice → "A CALL COMES IN" → Webhook:
 *   https://<your-site>/.netlify/functions/voice-twilio-inbound
 *
 * This is a lightweight "Gather Speech" loop (cheap + robust).
 * Upgrade path (later): ConversationRelay / realtime streaming.
 */
export default wrap(async (req) => {
  // Twilio sends application/x-www-form-urlencoded
  const bodyText = await req.text();
  const params = Object.fromEntries(new URLSearchParams(bodyText));

  const url = new URL(req.url);
  const fullUrl = url.toString();

  const v = validateTwilioRequest({ req, url: fullUrl, params });
  if (!v.ok) return new Response(v.error, { status: v.status || 401, headers: { "content-type": "text/plain" } });

  const callSid = params.CallSid || params.CallSID;
  const from = params.From || "";
  const to = params.To || "";
  if (!callSid || !to) return new Response("Missing CallSid/To", { status: 400 });

  const vn = await getVoiceNumberByTo(to);
  if (!vn) {
    return twiml(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, this number is not configured.</Say><Hangup/></Response>`);
  }

  const call = await upsertCall({
    customerId: vn.customer_id,
    voiceNumberId: vn.id,
    provider: "twilio",
    callSid,
    fromNumber: from,
    toNumber: to,
    meta: { twilio: { account_sid: params.AccountSid || null } }
  });

  const greeting = (vn.playbook && vn.playbook.greeting) ? vn.playbook.greeting : "SOLEnterprises. How can I help you today?";
  await addCallMessage(call.id, "system", `CALL_START from=${from} to=${to}`);
  await addCallMessage(call.id, "assistant", greeting);

  const actionUrl = new URL("/.netlify/functions/voice-twilio-turn", url.origin).toString();
  const xml = sayGatherTwiml({
    say: greeting,
    actionUrl,
    language: vn.locale || "en-US",
    voice: "alice"
  });

  return twiml(xml);
});
