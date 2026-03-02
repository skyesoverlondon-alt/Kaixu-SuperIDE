const bcrypt = require("bcryptjs");
const {
  jsonResponse,
  badRequest,
  getDb,
  findUserByEmail,
  createUser,
  isAdminEmail
} = require("./_helpers");

exports.handler = async (event) => {
  try{
    const body = (()=>{ try{ return JSON.parse(event.body||"{}"); }catch(e){ return {}; }})();
    const email = (body.email||"").trim();
    const password = (body.password||"").toString();

    if(!email || !email.includes("@")) return badRequest("Valid email required");
    if(password.length < 10) return badRequest("Password must be 10+ characters");

    const sql = await getDb();
    const existing = await findUserByEmail(sql, email);
    if(existing) return badRequest("Account already exists for this email");

    const hash = await bcrypt.hash(password, 12);
    const role = isAdminEmail(email) ? "admin" : "user";

    const created = await createUser(sql, email, hash, role);

    return jsonResponse(200, { ok:true, user: { user_id: created.id, email: created.email, role: created.role, created_at: created.created_at } });
  }catch(err){
    return jsonResponse(500, { ok:false, error: err.message || "Server error" });
  }
};
