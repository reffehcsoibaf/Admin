// Worker do Painel Admin
// Faz a ponte segura entre o admin.html (navegador) e a Admin API do Supabase.
// A service role key do Hub NUNCA é enviada ao navegador — ela só existe
// aqui, como secret configurado no Cloudflare.
//
// A partir da consolidação em projeto único (Hub), o painel não gerencia
// mais "projetos" separados — gerencia MÓDULOS dentro do mesmo projeto
// Supabase. Login e checagem de is_admin acontecem uma vez só, contra o
// Hub; a escolha de módulo só filtra QUAIS dados aparecem na tabela.

const HUB = {
  url: "https://zlclakzjktpsbpfkltxa.supabase.co",
  anonKey: "sb_publishable_o5Rn3Qp_C3boiYCRqQ5Ykw_2sNd3KiQ"
};

const MODULES = {
  banca: {
    label: "Banca Pro",
    modulo: "banca",
    recordsTable: "banca_apostas",
    recordsLabel: "Apostas",
    hasAiToggle: true,
    hasDetailedAiCounts: true,
    aiUsageTable: "banca_ai_usage",
    hasDocumentsToggle: false
  },
  financeiro: {
    label: "Controle Financeiro",
    modulo: "financeiro",
    recordsTable: "financeiro_lancamentos",
    recordsLabel: "Lançamentos",
    hasAiToggle: true,
    hasDetailedAiCounts: false,
    hasDocumentsToggle: true,
    bucket: "documentos"
  },
  saude: {
    label: "Plano de Saúde",
    modulo: "saude",
    recordsTable: "saude_procedimentos",
    recordsLabel: "Procedimentos",
    hasAiToggle: false,
    hasDetailedAiCounts: false,
    hasDocumentsToggle: true,
    bucket: "documentos_saude"
  },
  contracheque: {
    label: "Contracheque",
    modulo: "contracheque",
    recordsTable: "contracheque_lancamentos_mes",
    recordsLabel: "Lançamentos",
    // Sem toggle de IA nem de documentos: o app do contracheque não checa
    // ai_enabled/documents_enabled hoje (diferente de Banca Pro/Financeiro/
    // Saúde). Só "habilitado" é de fato gated (via modulo_habilitado() na
    // RLS). Se os outros toggles forem implementados lá, ligar aqui.
    hasAiToggle: false,
    hasDetailedAiCounts: false,
    hasDocumentsToggle: false,
    bucket: "contracheque-documentos"
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

// Confere o token de acesso do usuário logado e se ele é admin no Hub.
// Retorna { ok: true, userId } ou { ok: false, status, message }
async function requireAdmin(accessToken, env) {
  if (!accessToken) {
    return { ok: false, status: 401, message: "Token de acesso ausente." };
  }

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_HUB;
  if (!serviceRoleKey) {
    return { ok: false, status: 500, message: "Hub sem service role configurada." };
  }

  const userResp = await fetch(HUB.url + "/auth/v1/user", {
    headers: {
      apikey: HUB.anonKey,
      Authorization: "Bearer " + accessToken
    }
  });

  if (!userResp.ok) {
    return { ok: false, status: 401, message: "Token inválido ou expirado." };
  }

  const userData = await userResp.json();
  const userId = userData.id;

  const profileResp = await fetch(
    HUB.url + "/rest/v1/profiles?id=eq." + userId + "&select=is_admin",
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

async function searchUsers(serviceRoleKey, termo) {
  const resp = await fetch(HUB.url + "/auth/v1/admin/users", {
    headers: {
      apikey: serviceRoleKey,
      Authorization: "Bearer " + serviceRoleKey
    }
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error("Falha ao buscar usuários: " + text);
  }

  const data = await resp.json();
  const rawUsers = data.users || data || [];
  const termoLower = termo.toLowerCase();

  return rawUsers
    .filter(function (u) { return (u.email || "").toLowerCase().includes(termoLower); })
    .map(function (u) { return { id: u.id, email: u.email, created_at: u.created_at }; })
    .slice(0, 20);
}

async function listUsers(mod, serviceRoleKey) {
  const resp = await fetch(HUB.url + "/auth/v1/admin/users", {
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

  // profiles_modulos: habilitado / ai_enabled / ai_calls_count / documents_enabled,
  // filtrado pelo módulo atual.
  const modResp = await fetch(
    HUB.url + "/rest/v1/profiles_modulos?modulo=eq." + mod.modulo
      + "&select=user_id,habilitado,ai_enabled,ai_calls_count,documents_enabled",
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: "Bearer " + serviceRoleKey
      }
    }
  );
  const modRows = modResp.ok ? await modResp.json() : [];
  const modByUserId = {};
  modRows.forEach(function (r) { modByUserId[r.user_id] = r; });

  // Subcontadores específicos de IA (hoje só o Banca Pro tem).
  let aiUsageByUserId = {};
  if (mod.hasDetailedAiCounts && mod.aiUsageTable) {
    const aiResp = await fetch(HUB.url + "/rest/v1/" + mod.aiUsageTable + "?select=*", {
      headers: {
        apikey: serviceRoleKey,
        Authorization: "Bearer " + serviceRoleKey
      }
    });
    if (aiResp.ok) {
      const rows = await aiResp.json();
      rows.forEach(function (r) { aiUsageByUserId[r.user_id] = r; });
    }
  }

  // Conta os registros do módulo (apostas/lançamentos/procedimentos) por usuário.
  const recordCounts = {};
  await Promise.all(rawUsers.map(async function (u) {
    try {
      const countResp = await fetch(
        HUB.url + "/rest/v1/" + mod.recordsTable + "?user_id=eq." + u.id + "&select=id",
        {
          headers: {
            apikey: serviceRoleKey,
            Authorization: "Bearer " + serviceRoleKey,
            Prefer: "count=exact",
            Range: "0-0"
          }
        }
      );
      const contentRange = countResp.headers.get("content-range");
      const total = contentRange ? parseInt(contentRange.split("/")[1], 10) : null;
      recordCounts[u.id] = Number.isFinite(total) ? total : null;
    } catch (e) {
      recordCounts[u.id] = null;
    }
  }));

  // Uso de armazenamento por usuário (só em módulos com bucket de documentos).
  const storageByUserId = {};
  if (mod.hasDocumentsToggle && mod.bucket) {
    try {
      const storageResp = await fetch(HUB.url + "/rest/v1/rpc/storage_usage_por_usuario", {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          Authorization: "Bearer " + serviceRoleKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ bucket_name: mod.bucket })
      });
      if (storageResp.ok) {
        const rows = await storageResp.json();
        rows.forEach(function (r) { storageByUserId[r.user_id] = r.total_bytes; });
      }
    } catch (e) {
      // segue sem esse dado se a chamada falhar; não deve travar a listagem
    }
  }

  return rawUsers.map(function (u) {
    const mr = modByUserId[u.id];
    const aiUsage = aiUsageByUserId[u.id];
    return {
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      habilitado: mr ? mr.habilitado === true : false,
      ai_enabled: mod.hasAiToggle ? (mr ? mr.ai_enabled === true : false) : null,
      ai_calls_count: mod.hasAiToggle ? (mr && typeof mr.ai_calls_count === "number" ? mr.ai_calls_count : 0) : null,
      ai_calls_bilhete: mod.hasDetailedAiCounts ? (aiUsage && aiUsage.ai_calls_bilhete) || 0 : null,
      ai_calls_estatisticas: mod.hasDetailedAiCounts ? (aiUsage && aiUsage.ai_calls_estatisticas) || 0 : null,
      ai_calls_liga: mod.hasDetailedAiCounts ? (aiUsage && aiUsage.ai_calls_liga) || 0 : null,
      documents_enabled: mod.hasDocumentsToggle ? (mr ? mr.documents_enabled === true : false) : null,
      storage_bytes: mod.hasDocumentsToggle ? (storageByUserId.hasOwnProperty(u.id) ? Number(storageByUserId[u.id]) : 0) : null,
      records_count: recordCounts[u.id]
    };
  });
}

const HUB_PROJECT_REF = "zlclakzjktpsbpfkltxa"; // extraído da HUB.url

// Consulta se o autocadastro está permitido hoje (Management API).
async function getSignupConfig(env) {
  const resp = await fetch("https://api.supabase.com/v1/projects/" + HUB_PROJECT_REF + "/config/auth", {
    headers: { Authorization: "Bearer " + env.SUPABASE_MANAGEMENT_TOKEN }
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error("Falha ao consultar configuração de autocadastro: " + text);
  }
  const data = await resp.json();
  return { allowSignup: data.disable_signup !== true };
}

// Liga/desliga o autocadastro (qualquer pessoa se cadastrar sozinha nos apps).
async function setSignupConfig(env, allowSignup) {
  const resp = await fetch("https://api.supabase.com/v1/projects/" + HUB_PROJECT_REF + "/config/auth", {
    method: "PATCH",
    headers: {
      Authorization: "Bearer " + env.SUPABASE_MANAGEMENT_TOKEN,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ disable_signup: !allowSignup })
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error("Falha ao atualizar configuração de autocadastro: " + text);
  }
}

async function getUsoTotalProjeto(serviceRoleKey) {
  const resp = await fetch(HUB.url + "/rest/v1/rpc/uso_total_projeto", {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: "Bearer " + serviceRoleKey,
      "Content-Type": "application/json"
    },
    body: "{}"
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error("Falha ao consultar uso do projeto: " + text);
  }
  const rows = await resp.json();
  const row = rows[0] || {};
  return {
    storage_bytes: Number(row.storage_bytes) || 0,
    database_bytes: Number(row.database_bytes) || 0
  };
}

// Traz o estado de um único usuário em TODOS os módulos de uma vez, para a
// tela de "gerenciar usuário" (evita ter que trocar de módulo no painel só
// para ativar/desativar algo).
async function getUserDetail(serviceRoleKey, userId) {
  const userResp = await fetch(HUB.url + "/auth/v1/admin/users/" + userId, {
    headers: { apikey: serviceRoleKey, Authorization: "Bearer " + serviceRoleKey }
  });
  if (!userResp.ok) {
    const text = await userResp.text();
    throw new Error("Falha ao buscar usuário: " + text);
  }
  const userData = await userResp.json();

  const profileResp = await fetch(
    HUB.url + "/rest/v1/profiles?id=eq." + userId + "&select=is_admin",
    { headers: { apikey: serviceRoleKey, Authorization: "Bearer " + serviceRoleKey } }
  );
  const profileRows = profileResp.ok ? await profileResp.json() : [];
  const isAdmin = profileRows.length ? profileRows[0].is_admin === true : false;

  const modResp = await fetch(
    HUB.url + "/rest/v1/profiles_modulos?user_id=eq." + userId + "&select=modulo,habilitado,ai_enabled,documents_enabled",
    { headers: { apikey: serviceRoleKey, Authorization: "Bearer " + serviceRoleKey } }
  );
  const modRows = modResp.ok ? await modResp.json() : [];
  const modByKey = {};
  modRows.forEach(function (r) { modByKey[r.modulo] = r; });

  const modules = Object.keys(MODULES).map(function (key) {
    const mod = MODULES[key];
    const mr = modByKey[mod.modulo];
    return {
      key: key,
      label: mod.label,
      habilitado: mr ? mr.habilitado === true : false,
      hasAiToggle: !!mod.hasAiToggle,
      ai_enabled: mod.hasAiToggle ? (mr ? mr.ai_enabled === true : false) : null,
      hasDocumentsToggle: !!mod.hasDocumentsToggle,
      documents_enabled: mod.hasDocumentsToggle ? (mr ? mr.documents_enabled === true : false) : null
    };
  });

  return { id: userId, email: userData.email, isAdmin: isAdmin, modules: modules };
}

async function setUserIsAdmin(serviceRoleKey, userId, isAdmin) {
  const resp = await fetch(HUB.url + "/rest/v1/profiles?id=eq." + userId, {
    method: "PATCH",
    headers: {
      apikey: serviceRoleKey,
      Authorization: "Bearer " + serviceRoleKey,
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify({ is_admin: isAdmin })
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error("Falha ao atualizar permissão de administrador: " + text);
  }
}

async function createUser(serviceRoleKey, email, password) {
  const resp = await fetch(HUB.url + "/auth/v1/admin/users", {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: "Bearer " + serviceRoleKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email: email, password: password, email_confirm: true })
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error("Falha ao criar usuário: " + text);
  }
  return await resp.json();
}

async function deleteUser(serviceRoleKey, userId) {
  const resp = await fetch(HUB.url + "/auth/v1/admin/users/" + userId, {
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

async function resetPassword(serviceRoleKey, userId, newPassword) {
  const resp = await fetch(HUB.url + "/auth/v1/admin/users/" + userId, {
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

async function editUserEmail(serviceRoleKey, userId, newEmail) {
  const resp = await fetch(HUB.url + "/auth/v1/admin/users/" + userId, {
    method: "PUT",
    headers: {
      apikey: serviceRoleKey,
      Authorization: "Bearer " + serviceRoleKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email: newEmail, email_confirm: true })
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error("Falha ao editar e-mail: " + text);
  }
}

// Grava um campo em profiles_modulos via upsert (a linha pode ainda não
// existir para esse usuário x módulo — ex: usuário novo que nunca teve
// nenhum módulo concedido). merge-duplicates faz update parcial, sem
// mexer nos outros campos da linha.
async function upsertModuloField(serviceRoleKey, userId, modulo, campo, valor) {
  const body = { user_id: userId, modulo: modulo };
  body[campo] = valor;

  const resp = await fetch(HUB.url + "/rest/v1/profiles_modulos?on_conflict=user_id,modulo", {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: "Bearer " + serviceRoleKey,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error("Falha ao atualizar " + campo + ": " + text);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    try {
      const body = request.method === "POST" ? await request.json() : {};
      const moduleKey = body.module;
      const mod = MODULES[moduleKey];

      const accessToken = body.accessToken;
      const auth = await requireAdmin(accessToken, env);
      if (!auth.ok) {
        return jsonResponse({ error: auth.message }, auth.status);
      }

      const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_HUB;

      if (url.pathname === "/api/users/search" && request.method === "POST") {
        const termo = (body.query || "").trim();
        if (!termo) return jsonResponse({ users: [] });
        const resultados = await searchUsers(serviceRoleKey, termo);
        return jsonResponse({ users: resultados });
      }

      if (url.pathname === "/api/users" && request.method === "POST") {
        if (!mod) return jsonResponse({ error: "Módulo inválido." }, 400);
        const users = await listUsers(mod, serviceRoleKey);
        return jsonResponse({
          users: users,
          recordsLabel: mod.recordsLabel,
          hasAiToggle: !!mod.hasAiToggle,
          hasDocumentsToggle: !!mod.hasDocumentsToggle,
          hasDetailedAiCounts: !!mod.hasDetailedAiCounts
        });
      }

      if (url.pathname === "/api/uso-projeto" && request.method === "POST") {
        const uso = await getUsoTotalProjeto(serviceRoleKey);
        return jsonResponse(uso);
      }

      if (url.pathname === "/api/auth-config" && request.method === "POST") {
        const config = await getSignupConfig(env);
        return jsonResponse(config);
      }

      if (url.pathname === "/api/auth-config/set-signup" && request.method === "POST") {
        await setSignupConfig(env, body.allowSignup === true);
        return jsonResponse({ ok: true });
      }

      if (url.pathname === "/api/users/create" && request.method === "POST") {
        const email = (body.email || "").trim();
        const password = body.password;
        if (!email || !password || password.length < 8) {
          return jsonResponse({ error: "Informe um e-mail válido e uma senha com ao menos 8 caracteres." }, 400);
        }
        const novoUsuario = await createUser(serviceRoleKey, email, password);
        return jsonResponse({ ok: true, user: { id: novoUsuario.id, email: novoUsuario.email } });
      }

      if (url.pathname === "/api/users/detail" && request.method === "POST") {
        const detail = await getUserDetail(serviceRoleKey, body.userId);
        return jsonResponse(detail);
      }

      if (url.pathname === "/api/users/set-is-admin" && request.method === "POST") {
        if (body.userId === auth.userId && body.isAdmin !== true) {
          return jsonResponse({ error: "Você não pode remover sua própria permissão de administrador por aqui." }, 400);
        }
        await setUserIsAdmin(serviceRoleKey, body.userId, body.isAdmin === true);
        return jsonResponse({ ok: true });
      }

      if (url.pathname === "/api/users/set-module-access" && request.method === "POST") {
        if (!mod) return jsonResponse({ error: "Módulo inválido." }, 400);
        await upsertModuloField(serviceRoleKey, body.userId, mod.modulo, "habilitado", body.habilitado === true);
        return jsonResponse({ ok: true });
      }

      if (url.pathname === "/api/users/set-ai-access" && request.method === "POST") {
        if (!mod || !mod.hasAiToggle) {
          return jsonResponse({ error: "Este módulo não tem controle de acesso à IA." }, 400);
        }
        await upsertModuloField(serviceRoleKey, body.userId, mod.modulo, "ai_enabled", body.aiEnabled === true);
        return jsonResponse({ ok: true });
      }

      if (url.pathname === "/api/users/set-documents-access" && request.method === "POST") {
        if (!mod || !mod.hasDocumentsToggle) {
          return jsonResponse({ error: "Este módulo não tem controle de envio de documentos." }, 400);
        }
        await upsertModuloField(serviceRoleKey, body.userId, mod.modulo, "documents_enabled", body.documentsEnabled === true);
        return jsonResponse({ ok: true });
      }

      if (url.pathname === "/api/users/delete" && request.method === "POST") {
        if (body.userId === auth.userId) {
          return jsonResponse({ error: "Você não pode remover a si mesmo por aqui." }, 400);
        }
        await deleteUser(serviceRoleKey, body.userId);
        return jsonResponse({ ok: true });
      }

      if (url.pathname === "/api/users/reset-password" && request.method === "POST") {
        const newPassword = body.newPassword;
        if (!newPassword || newPassword.length < 8) {
          return jsonResponse({ error: "A nova senha precisa ter ao menos 8 caracteres." }, 400);
        }
        await resetPassword(serviceRoleKey, body.userId, newPassword);
        return jsonResponse({ ok: true });
      }

      if (url.pathname === "/api/users/edit-email" && request.method === "POST") {
        const newEmail = (body.newEmail || "").trim();
        if (!newEmail || !newEmail.includes("@")) {
          return jsonResponse({ error: "Informe um e-mail válido." }, 400);
        }
        await editUserEmail(serviceRoleKey, body.userId, newEmail);
        return jsonResponse({ ok: true, newEmail: newEmail });
      }

      return jsonResponse({ error: "Rota não encontrada." }, 404);
    } catch (err) {
      return jsonResponse({ error: "Erro no servidor: " + err.message }, 500);
    }
  }
};
