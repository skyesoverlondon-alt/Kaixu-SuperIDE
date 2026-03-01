import { wrap } from "./_lib/wrap.js";
import { validateTwilioRequest, sayGatherTwiml, hangupTwiml, dialTwiml, twiml } from "./_lib/twilio.js";
import { getVoiceNumberByTo, upsertCall, addCallMessage, getRecentMessages } from "./_lib/voice.js";
import { callOpenAI, callAnthropic, callGemini } from "./_lib/providers.js";

function safeText(s, max = 1400) {
  const t = (s || "").toString().trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

function buildSystemPrompt(vn, from, to) {
  const pb = vn.playbook || {};
  const base = pb.system_prompt || `You are Kaixu Voice Operator for SOLEnterprises. You answer business calls like a sharp human assistant.
Rules:
- Be concise, polite, and decisive.
- Ask one question at a time.
- If caller asks to speak with a human, offer to transfer.
- Never ask for full credit card numbers or sensitive personal data.
- Confirm any time/date/dollar amounts before finalizing.
- If you are done and the caller has no further requests, end the call.`;

  const routing = pb.routing || {};
  const tz = vn.timezone || "America/Phoenix";

  return `${base}

Context:
- Tenant/Customer ID: ${vn.customer_id}
- Called Number: ${to}
- Caller Number: ${from}
- Timezone: ${tz}

Transfer:
- If transfer is needed, say: "<TRANSFER/>" on its own line at the end of your response.
- If ending the call, say: "<END_CALL/>" on its own line at the end of your response.
`;
}

async function runLLM({ provider, model, messages }) {
  if (provider === "openai") return await callOpenAI({ model, messages });
  if (provider === "anthropic") return await callAnthropic({ model, messages });
  if (provider === "gemini") return await callGemini({ model, messages });
  const err = new Error("Unsupported provider");
  err.status = 400;
  throw err;
}

export default wrap(async (req) => {
  const bodyText = await req.text();
  const params = Object.fromEntries(new URLSearchParams(bodyText));

  const url = new URL(req.url);
  const fullUrl = url.toString();

  const v = validateTwilioRequest({ req, url: fullUrl, params });
  if (!v.ok) return new Response(v.error, { status: v.status || 401, headers: { "content-type": "text/plain" } });

  const callSid = params.CallSid || params.CallSID;
  const from = params.From || "";
  const to = params.To || "";
  const speech = params.SpeechResult || params.speechResult || "";
  if (!callSid || !to) return new Response("Missing CallSid/To", { status: 400 });

  const vn = await getVoiceNumberByTo(to);
  if (!vn) return twiml(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, this number is not configured.</Say><Hangup/></Response>`);

  const call = await upsertCall({
    customerId: vn.customer_id,
    voiceNumberId: vn.id,
    provider: "twilio",
    callSid,
    fromNumber: from,
    toNumber: to,
    meta: { twilio: { account_sid: params.AccountSid || null } }
  });

  const utterance = safeText(speech || "");
  if (utterance) await addCallMessage(call.id, "user", utterance);

  const recent = await getRecentMessages(call.id, 14);

  const system = buildSystemPrompt(vn, from, to);
  const messages = [
    { role: "system", content: system },
    ...recent.map(m => ({ role: m.role, content: m.content }))
  ];

  const provider = (vn.default_llm_provider || "openai").toString().toLowerCase();
  const model = (vn.default_llm_model || "gpt-4.1-mini").toString();

  let assistant = "Sorry—one moment. Could you repeat that?";
  try {
    const res = await runLLM({ provider, model, messages });
    assistant = (res && res.text) ? String(res.text) : assistant;
  } catch (e) {
    assistant = "I hit a system error. Let me connect you with a human.";
    assistant += "\n<TRANSFER/>";
  }

  // Extract control tags
  const lines = assistant.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const hasTransfer = lines.includes("<TRANSFER/>");
  const hasEnd = lines.includes("<END_CALL/>");
  const clean = assistant.replace(/\n\s*<TRANSFER\/>\s*/g, "\n").replace(/\n\s*<END_CALL\/>\s*/g, "\n").trim();

  await addCallMessage(call.id, "assistant", safeText(clean, 4000));

  const actionUrl = new URL("/.netlify/functions/voice-twilio-turn", url.origin).toString();

  if (hasTransfer) {
    const transferNumber = (vn.playbook && vn.playbook.transfer_number) ? String(vn.playbook.transfer_number) : (process.env.VOICE_FALLBACK_TRANSFER_NUMBER || "");
    if (!transferNumber) {
      return twiml(sayGatherTwiml({
        say: clean + " I can't transfer right now—please leave a message after the tone, or call back.",
        actionUrl,
        language: vn.locale || "en-US",
        voice: "alice"
      }));
    }
    return twiml(dialTwiml({ say: clean || "Connecting you now.", dialNumber: transferNumber, voice: "alice", language: vn.locale || "en-US" }));
  }

  if (hasEnd) {
    return twiml(hangupTwiml({ say: clean || "Goodbye.", voice: "alice", language: vn.locale || "en-US" }));
  }

  return twiml(sayGatherTwiml({
    say: clean,
    actionUrl,
    language: vn.locale || "en-US",
    voice: "alice"
  }));
});
