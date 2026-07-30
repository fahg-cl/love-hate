export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "https://fahg-cl.github.io",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({
          ok: false,
          message: "Método no permitido"
        }),
        {
          status: 405,
          headers: corsHeaders
        }
      );
    }

    try {
      const body = await request.json();
      const code = String(body.code ?? "");

      if (!/^\d{6}$/.test(code)) {
        return new Response(
          JSON.stringify({
            ok: false,
            message: "Código inválido"
          }),
          {
            status: 400,
            headers: corsHeaders
          }
        );
      }

      const valid = code === env.APP_BOOTSTRAP_CODE;

      return new Response(
        JSON.stringify({
          ok: valid
        }),
        {
          status: valid ? 200 : 401,
          headers: corsHeaders
        }
      );
    } catch {
      return new Response(
        JSON.stringify({
          ok: false,
          message: "Solicitud inválida"
        }),
        {
          status: 400,
          headers: corsHeaders
        }
      );
    }
  }
};