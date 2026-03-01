// Example: AUTO MODE client (browser)
// Chooses SSE stream vs job+polling based on prompt size and max_tokens.
// Requires KaixuClient (assets/kaixu-client.js) to be loaded.
//
// Usage:
//   KaixuClient.autoChat({
//     apiBase: "https://gateway.yourdomain.com", // or omit to use same-origin / KAIXU_API_BASE
//     apiKey: "<YOUR_MASTER_OR_SUBKEY>",
//     payload: { provider:"openai", model:"gpt-4.1-mini", messages:[...], max_tokens: 3000 },
//     expectLargeOutput: true, // optional hint (e.g. DEV mode)
//     onMeta: (m)=>console.log("meta", m),
//     onDelta: (t)=>appendToUI(t),
//     onStatus: (s)=>console.log("job status", s),
//     onDone: (d)=>console.log("done", d)
//   });

async function demoAuto(){
  const out = document.getElementById("out");
  function append(s){ out.textContent += s; }

  await KaixuClient.autoChat({
    apiKey: prompt("API key"),
    payload: {
      provider: "openai",
      model: "gpt-4.1-mini",
      messages: [
        { role: "user", content: "Write a long code response: make 3 HTML files with full content." }
      ],
      max_tokens: 3000,
      temperature: 0.2
    },
    expectLargeOutput: true,
    onMeta: (m)=>console.log("meta", m),
    onDelta: (t)=>append(t),
    onStatus: (s)=>console.log("status", s),
    onDone: (d)=>console.log("done", d)
  });
}

demoAuto().catch(console.error);
