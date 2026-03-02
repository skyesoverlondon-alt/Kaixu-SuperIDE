const bcrypt = require("bcryptjs");
const {
  jsonResponse,
  badRequest,
  unauthorized,
  signSession,
  sessionCookie,
  isHttps,
  getDb,
  findUserByEmail,
  touchLogin
} = require("./_helpers");

exports.handler = async (event) => {
  try{
    const body = (()=>{ try{ return JSON.parse(event.body||"{}"); }catch(e){ return {}; }})();
    const email = (body.email||"").trim().toLowerCase();
    const password = (body.password||"").toString();

    if(!email || !password) return badRequest("Email and password required");

    const sql = await getDb();
    const user = await findUserByEmail(sql, email);
    if(!user) return unauthorized("Invalid credentials");

    const ok = await bcrypt.compare(password, user.password_hash || "");
    if(!ok) return unauthorized("Invalid credentials");

    const token = await signSession({ uid: user.id, email: user.email, role: user.role });
    await touchLogin(sql, user.id);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Set-Cookie": sessionCookie(token, isHttps(event))
      },
      body: JSON.stringify({ ok:true, user: { user_id: user.id, email: user.email, role: user.role } })
    };
  }catch(err){
    return jsonResponse(500, { ok:false, error: err.message || "Server error" });
  }
};
