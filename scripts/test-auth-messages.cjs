const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const app=fs.readFileSync(path.join(__dirname,"..","app.js"),"utf8");
const context=vm.createContext({});
vm.runInContext(app.slice(app.indexOf("function authErrorMessage("),app.indexOf("\nlet signup=false;")),context);
const message=error=>context.authErrorMessage(error);

test("email sending limits and default SMTP restrictions are explained in Spanish",()=>{
  assert.match(message({code:"over_email_send_rate_limit",message:"Too many requests"}),/límite de correos/);
  assert.match(message({message:"email rate limit exceeded"}),/límite de correos/);
  assert.match(message({code:"email_address_not_authorized",message:"Email address not authorized"}),/administrador/);
});

test("other authentication errors retain their prior behavior",()=>{
  assert.match(message({message:"Invalid login credentials"}),/Correo o contraseña incorrectos/);
  assert.match(message({message:"Database error saving new user"}),/invitación aprobada/);
  assert.equal(message({message:"Other error"}),"Other error");
});
