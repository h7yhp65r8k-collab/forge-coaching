import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return response({ error: "Metodo non consentito" }, 405);
  }

  try {
    const authorization = req.headers.get("Authorization");

    if (!authorization) {
      return response({ error: "Accesso richiesto" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: {
          headers: { Authorization: authorization },
        },
      },
    );

    const { data: userData, error: userError } =
      await supabase.auth.getUser();

    if (userError || !userData.user) {
      return response({ error: "Sessione non valida" }, 401);
    }

    const { data: approved, error: approvalError } =
      await supabase.rpc("is_forge_approved");

    if (approvalError || !approved) {
      return response({ error: "Account non autorizzato" }, 403);
    }

    const body = await req.json();

    const query = String(
      body.query ?? body.search ?? ""
    ).trim();

    if (query.length < 2 || query.length > 120) {
      return response({
        error: "Inserisci un nome alimento valido",
      }, 400);
    }

    const url = new URL(
      "https://world.openfoodfacts.org/cgi/search.pl"
    );

    url.searchParams.set("search_terms", query);
    url.searchParams.set("search_simple", "1");
    url.searchParams.set("action", "process");
    url.searchParams.set("json", "1");
    url.searchParams.set("page_size", "30");

    url.searchParams.set(
      "fields",
      "code,product_name,product_name_it,brands,nutriments,image_front_small_url"
    );

    const result = await fetch(url, {
      headers: {
        "User-Agent": "ForgeCoaching/1.0",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!result.ok) {
      return response({
        error: "Database alimentare temporaneamente non disponibile",
      }, 502);
    }

    const data = await result.json();

    function numberOrNull(value: unknown) {
      if (
        value === undefined ||
        value === null ||
        value === ""
      ) return null;

      const n = Number(value);

      return Number.isFinite(n) && n >= 0
        ? n
        : null;
    }

    const foods = (data.products ?? [])
      .map((p: any) => {
        const n = p.nutriments ?? {};

        return {
          external_id: p.code ?? null,
          name: p.product_name_it || p.product_name || "",
          brand: p.brands ?? "",
          source: "Open Food Facts",
          serving_g: 100,
          kcal: numberOrNull(n["energy-kcal_100g"]),
          protein: numberOrNull(n.proteins_100g),
          carbs: numberOrNull(n.carbohydrates_100g),
          fat: numberOrNull(n.fat_100g),
          fiber: numberOrNull(n.fiber_100g),
          sugars: numberOrNull(n.sugars_100g),
          salt: numberOrNull(n.salt_100g),
          image_url: p.image_front_small_url ?? null,
        };
      })
      .filter((food: any) =>
        food.name &&
        food.kcal !== null &&
        food.protein !== null &&
        food.carbs !== null &&
        food.fat !== null
      );

    return response({
      success: true,
      module: "FORGE NUTRITION",
      source: "Open Food Facts",
      query,
      count: foods.length,
      foods,
    });

  } catch (error) {
    console.error(error);

    return response({
      success: false,
      error: "Errore durante la ricerca alimentare",
    }, 500);
  }
});
