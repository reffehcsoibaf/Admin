// Worker do Painel Admin
// Faz a ponte segura entre o admin.html (navegador) e a Admin API do Supabase.
// A service role key de cada projeto NUNCA é enviada ao navegador — ela só
// existe aqui, como secret configurado no Cloudflare.

const PROJECTS = {
  bancapro: {
    url: "https://nccpmxavmwipsvzquzeg.supabase.co",
    anonKey: "sb_publishable_XAjlhNGUMf9EzoqY4C3J9w_FJ1k-SxT",
    recordsTable: "apostas",
    recordsLabel: "Apostas",
    hasDetailedAiCounts: true
  },
  controlefinanceiro: {
    url: "https://arkhifcucqozrpofhceq.supabase.co",
    anonKey: "sb_publishable_fNGQLgpF3_tOycUEciaznw_b0o2FM8h",
    recordsTable: "lancamentos",
    recordsLabel: "Lançamentos",
    hasDocumentsToggle: true
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
// Projeto usado como "porta de entrada" única do painel: a autenticação e a
// checagem de is_admin sempre acontecem aqui, não importa qual projeto o
// admin queira gerenciar depois de logado.
const ADMIN_PROJECT_KEY = "controlefinanceiro";

// Confere o token de acesso do usuário logado e se ele é admin no projeto de
// identidade (ADMIN_PROJECT_KEY). Retorna { ok: true, userId } ou
// { ok: false, status, message }
async function requireAdmin(accessToken, env) {
  if (!accessToken) {
    return { ok: false, status: 401, message: "Token de acesso ausente." };
  }

  const adminProject = PROJECTS[ADMIN_PROJECT_KEY];
  const serviceRoleKey = getServiceRoleKey(env, ADMIN_PROJECT_KEY);
  if (!serviceRoleKey) {
    return { ok: false, status: 500, message: "Projeto de identidade sem service role configurada." };
  }

  // 1. Descobre quem é o usuário a partir do token dele (validação normal, não-admin)
  const userResp = await fetch(adminProject.url + "/auth/v1/user", {
    headers: {
      apikey: adminProject.anonKey,
      Authorization: "Bearer " + accessToken
    }
  });

  if (!userResp.ok) {
    return { ok: false, status: 401, message: "Token inválido ou expirado." };
  }

  const userData = await userResp.json();
  const userId = userData.id;

  // 2. Confere is_admin na tabela profiles do projeto de identidade
  const profileResp = await fetch(
    adminProject.url + "/rest/v1/profiles?id=eq." + userId + "&select=is_admin",
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

  const camposProfile = "id,ai_enabled,ai_calls_count"
    + (project.hasDocumentsToggle ? ",documents_enabled" : "")
    + (project.hasDetailedAiCounts ? ",ai_calls_bilhete,ai_calls_estatisticas" : "");
  const profilesResp = await fetch(project.url + "/rest/v1/profiles?select=" + camposProfile, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: "Bearer " + serviceRoleKey
    }
  });
  const profiles = profilesResp.ok ? await profilesResp.json() : [];
  const profileById = {};
  profiles.forEach(function (p) { profileById[p.id] = p; });

  // Conta os registros (apostas/lançamentos) de cada usuário. Usa o header
  // Prefer: count=exact junto com um select mínimo por usuário — simples e
  // suficiente para o volume de usuários de um app pessoal.
  const recordCounts = {};
  await Promise.all(rawUsers.map(async function (u) {
    try {
      const countResp = await fetch(
        project.url + "/rest/v1/" + project.recordsTable + "?user_id=eq." + u.id + "&select=id",
        {
          headers: {
            apikey: serviceRoleKey,
            Authorization: "Bearer " + serviceRoleKey,
            Prefer: "count=exact",
            Range: "0-0"
          }
        }
      );
      const contentRange = countResp.headers.get("content-range"); // formato "0-0/123"
      const total = contentRange ? parseInt(contentRange.split("/")[1], 10) : null;
      recordCounts[u.id] = Number.isFinite(total) ? total : null;
    } catch (e) {
      recordCounts[u.id] = null;
    }
  }));

  return rawUsers.map(function (u) {
    const profile = profileById[u.id];
    return {
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      ai_enabled: profile && profile.hasOwnProperty("ai_enabled") ? profile.ai_enabled : true,
      ai_calls_count: profile && profile.hasOwnProperty("ai_calls_count") ? profile.ai_calls_count : 0,
      ai_calls_bilhete: project.hasDetailedAiCounts ? (profile && profile.ai_calls_bilhete) || 0 : null,
      ai_calls_estatisticas: project.hasDetailedAiCounts ? (profile && profile.ai_calls_estatisticas) || 0 : null,
      documents_enabled: project.hasDocumentsToggle ? (profile && profile.hasOwnProperty("documents_enabled") ? profile.documents_enabled : true) : null,
      records_count: recordCounts[u.id]
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

async function resetPassword(project, serviceRoleKey, userId, newPassword) {
  const resp = await fetch(project.url + "/auth/v1/admin/users/" + userId, {
    method: "PUT",
    headers: {
      apikey: serviceRoleKey,
      Authorization: "Bearer " + serviceRoleKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ password: newPassword })
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error("Falha ao redefinir senha: " + text);
  }
}

async function setAiEnabled(project, serviceRoleKey, userId, aiEnabled) {
  const resp = await fetch(project.url + "/rest/v1/profiles?id=eq." + userId, {
    method: "PATCH",
    headers: {
      apikey: serviceRoleKey,
      Authorization: "Bearer " + serviceRoleKey,
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify({ ai_enabled: aiEnabled })
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error("Falha ao atualizar acesso à IA: " + text);
  }
}

async function setDocumentsEnabled(project, serviceRoleKey, userId, documentsEnabled) {
  const resp = await fetch(project.url + "/rest/v1/profiles?id=eq." + userId, {
    method: "PATCH",
    headers: {
      apikey: serviceRoleKey,
      Authorization: "Bearer " + serviceRoleKey,
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify({ documents_enabled: documentsEnabled })
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error("Falha ao atualizar acesso a documentos: " + text);
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
      const auth = await requireAdmin(accessToken, env);
      if (!auth.ok) {
        return jsonResponse({ error: auth.message }, auth.status);
      }

      const serviceRoleKey = getServiceRoleKey(env, projectKey);

      if (url.pathname === "/api/users" && request.method === "POST") {
        const users = await listUsers(project, serviceRoleKey);
        return jsonResponse({ users: users, recordsLabel: project.recordsLabel, hasDocumentsToggle: !!project.hasDocumentsToggle, hasDetailedAiCounts: !!project.hasDetailedAiCounts });
      }

      if (url.pathname === "/api/users/set-documents-access" && request.method === "POST") {
        if (!project.hasDocumentsToggle) {
          return jsonResponse({ error: "Este projeto não tem controle de envio de documentos." }, 400);
        }
        await setDocumentsEnabled(project, serviceRoleKey, body.userId, body.documentsEnabled === true);
        return jsonResponse({ ok: true });
      }

      if (url.pathname === "/api/users/delete" && request.method === "POST") {
        if (body.userId === auth.userId) {
          return jsonResponse({ error: "Você não pode remover a si mesmo por aqui." }, 400);
        }
        await deleteUser(project, serviceRoleKey, body.userId);
        return jsonResponse({ ok: true });
      }

      if (url.pathname === "/api/users/reset-password" && request.method === "POST") {
        const newPassword = body.newPassword;
        if (!newPassword || newPassword.length < 8) {
          return jsonResponse({ error: "A nova senha precisa ter ao menos 8 caracteres." }, 400);
        }
        await resetPassword(project, serviceRoleKey, body.userId, newPassword);
        return jsonResponse({ ok: true });
      }

      if (url.pathname === "/api/users/set-ai-access" && request.method === "POST") {
        await setAiEnabled(project, serviceRoleKey, body.userId, body.aiEnabled === true);
        return jsonResponse({ ok: true });
      }

      return jsonResponse({ error: "Rota não encontrada." }, 404);
    } catch (err) {
      return jsonResponse({ error: "Erro no servidor: " + err.message }, 500);
    }
  }
};
