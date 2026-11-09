const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const cronSecret = Deno.env.get("CRON_SECRET");

function requireEnv(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function isAuthorized(request: Request, secret: string): boolean {
  const authorization = request.headers.get("authorization") ?? "";
  const expected = new TextEncoder().encode(`Bearer ${secret}`);
  const actual = new TextEncoder().encode(authorization);
  let mismatch = expected.length ^ actual.length;
  for (let i = 0; i < Math.max(expected.length, actual.length); i++) {
    mismatch |= (expected[i] ?? 0) ^ (actual[i] ?? 0);
  }
  return mismatch === 0;
}

async function rpc(name: string, body: Record<string, unknown>) {
  const url = requireEnv(supabaseUrl, "SUPABASE_URL");
  const key = requireEnv(serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const responseBody = await response.text();
  if (!response.ok) {
    throw new Error(`${name} failed with HTTP ${response.status}: ${responseBody.slice(0, 500)}`);
  }
  return responseBody ? JSON.parse(responseBody) : null;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const secret = requireEnv(cronSecret, "CRON_SECRET");
  if (!isAuthorized(request, secret)) return new Response("Unauthorized", { status: 401 });

  try {
    const candidates = await rpc("reclamar_revalidaciones_correo_48h", {});
    if (!Array.isArray(candidates)) throw new Error("Candidate RPC returned an invalid response");

    let resent = 0;
    let alerted = 0;
    for (const candidate of candidates) {
      if (typeof candidate.user_id !== "string" || typeof candidate.email !== "string") {
        throw new Error("Candidate RPC returned an invalid account");
      }

      let sent = false;
      let failure = "";
      try {
        const url = requireEnv(supabaseUrl, "SUPABASE_URL");
        const key = requireEnv(serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY");
        const response = await fetch(`${url}/auth/v1/resend`, {
          method: "POST",
          headers: {
            apikey: key,
            authorization: `Bearer ${key}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ type: "signup", email: candidate.email }),
        });
        const responseBody = await response.text();
        sent = response.ok;
        if (!sent) failure = `Auth devolvio HTTP ${response.status}: ${responseBody.slice(0, 500)}`;
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }

      await rpc("finalizar_revalidacion_correo_48h", {
        p_user_id: candidate.user_id,
        p_enviado: sent,
        p_error: sent ? null : failure,
      });
      if (sent) resent++;
      else alerted++;
    }

    return Response.json({ procesados: candidates.length, reenviados: resent, alertas_supervisor: alerted });
  } catch (error) {
    console.error("Email validation job failed", error);
    return Response.json({ error: "No se pudo completar el proceso de validacion" }, { status: 500 });
  }
});
