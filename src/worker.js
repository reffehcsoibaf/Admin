// Worker do Painel Admin
// Faz a ponte segura entre o admin.html (navegador) e a Admin API do Supabase.
// A service role key de cada projeto NUNCA é enviada ao navegador — ela só
// existe aqui, como secret configurado no Cloudflare.

const PROJECTS = {
  bancapro: {
    url: "https://nccpmxavmwipsvzquzeg.supabase.co",
    anonKey: "sb_publishable_XAjlhNGUMf9EzoqY4C3J9w_FJ1k-SxT"
  },
  controlefinanceiro: {
    url: "https://arkhifcucqozrpofhceq.supabase.co",
    anonKey: "sb_publishable_fNGQLgpF3_tOycUEciaznw_b0o2FM8h"
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders())
  });
}

function getServiceRoleKey(env, projectKey) {
  if (projectKey === "bancapro") return env.SUPABASE_SERVICE_ROLE_BANCAPRO;
  if (projectKey === "controlefinanceiro") return env.SUPABASE_SERVICE_ROLE_CONTROLEFINANCEIRO;
  return null;
}

// Confere o token de acesso do usuário logado e se ele é admin no projeto pedido.
// Retorna { ok: true, userId } ou { ok: false, status, message }
async function requireAdmin(project, projectKey, accessToken, env) {
  if (!accessToken) {
    return { ok: false, status: 401, message: "Token de acesso ausente." };
  }

  const serviceRoleKey = getServiceRoleKey(env, projectKey);
  if (!serviceRoleKey) {
    return { ok: false, status: 500, message: "Projeto desconhecido ou sem service role configurada." };
  }

  // 1. Descobre quem é o usuário a partir do token dele (validação normal, não-admin)
  const userResp = await fetch(project.url + "/auth/v1/user", {
    headers: {
      apikey: project.anonKey,
      Authorization: "Bearer " + accessToken
    }
  });

  if (!userResp.ok) {
    return { ok: false, status: 401, message: "Token inválido ou expirado." };
  }

  const userData = await userResp.json();
  const userId = userData.id;

  // 2. Confere is_admin na tabela profiles, usando a service role key
  const profileResp = await fetch(
    project.url + "/rest/v1/profiles?id=eq." + userId + "&select=is_admin",
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: "Bearer " + serviceRoleKey
      }
    }
  );

  if (!profileResp.ok) {
    return { ok: false, status: 500, message: "Não foi possível checar a permissão de admin." };
  }

  const profileRows = await profileResp.json();
  if (!profileRows.length || profileRows[0].is_admin !== true) {
    return { ok: false, status: 403, message: "Usuário não tem permissão de administrador." };
  }

  return { ok: true, userId: userId };
}

async function listUsers(project, serviceRoleKey) {
  const resp = await fetch(project.url + "/auth/v1/admin/users", {
    headers: {
      apikey: serviceRoleKey,
      Authorization: "Bearer " + serviceRoleKey
    }
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error("Falha ao listar usuários: " + text);
  }

  const data = await resp.json();
  const rawUsers = data.users || data || [];

  return rawUsers.map(function (u) {
    return {
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at
    };
  });
}

async function deleteUser(project, serviceRoleKey, userId) {
  const resp = await fetch(project.url + "/auth/v1/admin/users/" + userId, {
    method: "DELETE",
    headers: {
      apikey: serviceRoleKey,
      Authorization: "Bearer " + serviceRoleKey
    }
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error("Falha ao remover usuário: " + text);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    // Serve o admin.html e demais arquivos estáticos para qualquer rota fora de /api/
    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    try {
      const body = request.method === "POST" ? await request.json() : {};
      const projectKey = body.project;
      const project = PROJECTS[projectKey];

      if (!project) {
        return jsonResponse({ error: "Projeto inválido." }, 400);
      }

      const accessToken = body.accessToken;
      const auth = await requireAdmin(project, projectKey, accessToken, env);
      if (!auth.ok) {
        return jsonResponse({ error: auth.message }, auth.status);
      }

      const serviceRoleKey = getServiceRoleKey(env, projectKey);

      if (url.pathname === "/api/users" && request.method === "POST") {
        const users = await listUsers(project, serviceRoleKey);
        return jsonResponse({ users: users });
      }

      if (url.pathname === "/api/users/delete" && request.method === "POST") {
        if (body.userId === auth.userId) {
          return jsonResponse({ error: "Você não pode remover a si mesmo por aqui." }, 400);
        }
        await deleteUser(project, serviceRoleKey, body.userId);
        return jsonResponse({ ok: true });
      }

      return jsonResponse({ error: "Rota não encontrada." }, 404);
    } catch (err) {
      return jsonResponse({ error: "Erro no servidor: " + err.message }, 500);
    }
  }
};
