const { jsonResponse, clearSessionCookie } = require("./_helpers");

exports.handler = async () => {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Set-Cookie": clearSessionCookie()
    },
    body: JSON.stringify({ ok:true })
  };
};
