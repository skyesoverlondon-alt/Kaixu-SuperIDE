const cookie = require("cookie");
const { jsonResponse, verifySession, COOKIE_NAME, getDb, findUserByEmail } = require("./_helpers");

exports.handler = async (event) => {
  try{
    const cookies = cookie.parse(event.headers.cookie || "");
    const token = cookies[COOKIE_NAME];
    if(!token) return jsonResponse(401, { ok:false, error:"Not authenticated" });

    let payload;
    try{ payload = await verifySession(token); }catch(_){ return jsonResponse(401, { ok:false, error:"Invalid or expired session" }); }

    const sql = await getDb();
    const user = await findUserByEmail(sql, payload.email);
    if(!user) return jsonResponse(401, { ok:false, error:"Account not found" });

    return jsonResponse(200, { ok:true, user: { user_id: user.id, email: user.email, role: user.role }, exp: payload.exp });
  }catch(err){
    return jsonResponse(500, { ok:false, error: err.message || "Server error" });
  }
};
