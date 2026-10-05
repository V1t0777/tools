import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const URL = Deno.env.get("SUPABASE_URL")!;
function adminKey() {
  try {
    const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.default) return parsed.default;
    }
  } catch {}
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}
const ADMIN_KEY = adminKey();
if (!ADMIN_KEY) throw new Error("服务端数据库密钥未配置");

const admin = createClient(URL, ADMIN_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const ORIGINS = new Set([
  "https://v1t0777.github.io",
  "https://zhao-toolbox-secure.pages.dev",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
]);
const ACTION_LIMITS: Record<string, number> = {
  bootstrap: 30,
  create_room: 8,
  join_room: 30,
  state: 180,
  toggle_ready: 60,
  start_game: 20,
  hit: 120,
  stand: 120,
  timeout: 120,
  advance_round: 60,
  play_again: 20,
  close_room: 20,
  leave_room: 30,
};

const headers = (req: Request) => ({
  "Access-Control-Allow-Origin": ORIGINS.has(req.headers.get("origin") || "")
    ? (req.headers.get("origin") || "")
    : "https://v1t0777.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Vary": "Origin",
});
const reply = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: headers(req) });

function fail(message: string, status = 400, code?: string): never {
  const error = new Error(message) as Error & { status?: number; code?: string };
  error.status = status;
  error.code = code;
  throw error;
}

function roomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[randomInt(chars.length)]).join("");
}
function randomInt(maxExclusive: number) {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) throw new Error("invalid random range");
  const span = 0x1_0000_0000;
  const limit = span - (span % maxExclusive);
  const word = new Uint32Array(1);
  do crypto.getRandomValues(word); while (word[0] >= limit);
  return word[0] % maxExclusive;
}
function shuffledDeck() {
  const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const suits = ["S", "H", "D", "C"];
  const deck = suits.flatMap((suit) => ranks.map((rank) => `${rank}${suit}`));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
function cleanCode(value: unknown) {
  return String(value || "").toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6);
}
function cleanActionId(value: unknown) {
  const id = String(value || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    fail("操作标识无效，请重试", 400, "INVALID_ACTION_ID");
  }
  return id;
}
function cleanRoundLimit(value: unknown) {
  const n = Number(value);
  if (![3, 5, 10].includes(n)) fail("局数设置无效");
  return n;
}

async function identify(req: Request) {
  const authorization = req.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) fail("请先登录", 401, "AUTH_REQUIRED");
  const key = req.headers.get("apikey") || Deno.env.get("SUPABASE_ANON_KEY") || "";
  const client = createClient(URL, key, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const context = await client.rpc("blackjack_session_context");
  if (context.error) fail("登录状态暂时无法验证，请重试", 503, "SESSION_CHECK_FAILED");
  if (!context.data?.id || !context.data?.user_id) {
    fail("当前账号不在工具箱成员名单中或会话已失效", 403, "SESSION_REVOKED");
  }
  return context.data;
}

async function readBody(req: Request) {
  const maxBytes = 64 * 1024;
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > maxBytes) fail("请求数据过大", 413);
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) fail("请求数据过大", 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    fail("请求数据无效", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) fail("请求数据无效", 400);
  return body as Record<string, unknown>;
}

async function limitAction(userId: string, action: string) {
  const bytes = new TextEncoder().encode(`blackjack|${userId}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const key = [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
  const out = await admin.rpc("flappy_rate_limit_check", {
    p_key: key,
    p_action: `blackjack:${action}`,
    p_limit: ACTION_LIMITS[action],
    p_window_seconds: 60,
  });
  if (out.error) fail("请求校验暂时不可用，请稍后重试", 503, "RATE_LIMIT_UNAVAILABLE");
  if (out.data !== true) fail("请求过于频繁，请稍后再试", 429, "RATE_LIMITED");
}

async function roomById(id: string) {
  const out = await admin.from("blackjack_rooms").select("*").eq("id", id).maybeSingle();
  if (out.error) throw out.error;
  if (!out.data) fail("房间不存在", 404);
  return out.data;
}
async function player(roomId: string, userId: string) {
  const out = await admin
    .from("blackjack_players")
    .select("*")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();
  if (out.error) throw out.error;
  if (!out.data) fail("你不在这个房间", 403);
  return out.data;
}
async function state(roomId: string, userId: string, enforceTimeout = true) {
  const fn = enforceTimeout ? "blackjack_timeout_service" : "blackjack_state_service";
  const out = await admin.rpc(fn, { p_room_id: roomId, p_user_id: userId });
  if (out.error) fail(out.error.message || "牌局状态读取失败", 400, out.error.code);
  return out.data;
}
async function gameRpc(name: string, args: Record<string, unknown>) {
  const out = await admin.rpc(name, args);
  if (!out.error) return out.data;
  if (out.error.code === "40001") fail("操作状态已更新，请重试", 409, "STALE_ACTION");
  if (out.error.code === "P4290") fail("请求过于频繁，请稍后再试", 429, "RATE_LIMITED");
  fail(out.error.message || "操作失败", 400, out.error.code);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(req) });
  if (req.method !== "POST") return reply(req, { error: "仅支持 POST" }, 405);
  const origin = req.headers.get("origin") || "";
  if (origin && !ORIGINS.has(origin)) return reply(req, { error: "来源未获授权" }, 403);

  try {
    const body = await readBody(req);
    const action = String(body.action || "");
    if (!Object.hasOwn(ACTION_LIMITS, action)) fail("未知操作", 400, "UNKNOWN_ACTION");
    const member = await identify(req);
    if (action !== "hit" && action !== "stand") {
      await limitAction(member.user_id, action);
    }

    if (action === "bootstrap" && !body.code) return reply(req, { member });

    if (action === "create_room") {
      const roundLimit = cleanRoundLimit(body.round_limit ?? 5);
      let room: any = null;
      for (let attempt = 0; attempt < 8 && !room; attempt++) {
        const created = await admin
          .from("blackjack_rooms")
          .insert({
            room_code: roomCode(),
            host_user_id: member.user_id,
            round_limit: roundLimit,
            status: "lobby",
            phase: "lobby",
          })
          .select("*")
          .single();
        if (!created.error) room = created.data;
      }
      if (!room) fail("暂时无法生成房间码", 503);

      const inserted = await admin.from("blackjack_players").insert({
        room_id: room.id,
        user_id: member.user_id,
        display_name: member.nickname,
        seat: 1,
        ready: true,
        active: true,
      });
      if (inserted.error) {
        await admin.from("blackjack_rooms").delete().eq("id", room.id);
        throw inserted.error;
      }
      return reply(req, { member, state: await state(room.id, member.user_id, false) });
    }

    if (action === "join_room" || action === "bootstrap") {
      const code = cleanCode(body.code);
      if (code.length !== 6) fail("请输入 6 位房间码");
      const found = await admin.from("blackjack_rooms").select("*").eq("room_code", code).maybeSingle();
      if (found.error) throw found.error;
      if (!found.data) fail("没有找到这个房间", 404);
      if (["closed", "abandoned"].includes(found.data.status)) fail("这个房间已经结束", 410);

      const old = await admin
        .from("blackjack_players")
        .select("*")
        .eq("room_id", found.data.id)
        .eq("user_id", member.user_id)
        .maybeSingle();
      if (old.error) throw old.error;

      if (old.data?.active) {
        return reply(req, { member, state: await state(found.data.id, member.user_id) });
      }
      if (old.data && found.data.status === "lobby") {
        await admin
          .from("blackjack_players")
          .update({ active: true, ready: false, updated_at: new Date().toISOString() })
          .eq("room_id", found.data.id)
          .eq("user_id", member.user_id);
      } else if (!old.data) {
        if (found.data.status !== "lobby") fail("对局已经开始，只有原房间成员可以重连", 403);
        const current = await admin
          .from("blackjack_players")
          .select("seat")
          .eq("room_id", found.data.id)
          .eq("active", true)
          .order("seat");
        if (current.error) throw current.error;
        if ((current.data || []).length >= 3) fail("房间已满");
        const used = new Set((current.data || []).map((x: any) => Number(x.seat)));
        const seat = [1, 2, 3].find((n) => !used.has(n));
        if (!seat) fail("房间已满");
        const joined = await admin.from("blackjack_players").insert({
          room_id: found.data.id,
          user_id: member.user_id,
          display_name: member.nickname,
          seat,
          ready: false,
          active: true,
        });
        if (joined.error) throw joined.error;
      } else {
        fail("这个房间不能重新加入", 410);
      }
      await admin
        .from("blackjack_rooms")
        .update({
          version: Number(found.data.version || 0) + 1,
          last_activity_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", found.data.id)
        .eq("version", found.data.version);
      return reply(req, { member, state: await state(found.data.id, member.user_id, false) });
    }

    const roomId = String(body.room_id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(roomId)) fail("房间标识无效");
    if (action === "state") {
      return reply(req, { state: await state(roomId, member.user_id) });
    }
    if (action === "toggle_ready") {
      const next = await gameRpc("blackjack_toggle_ready_service", {
        p_room_id: roomId,
        p_user_id: member.user_id,
      });
      return reply(req, { state: next });
    }
    if (action === "start_game") {
      const next = await gameRpc("blackjack_start_game_service", {
        p_room_id: roomId,
        p_user_id: member.user_id,
        p_deck: shuffledDeck(),
        p_action_id: cleanActionId(body.action_id),
      });
      return reply(req, { state: next });
    }
    if (action === "hit" || action === "stand") {
      const token = String(body.expected_token || "");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) fail("操作状态无效，请刷新后重试");
      const next = await gameRpc("blackjack_action_gateway_service", {
        p_room_id: roomId,
        p_user_id: member.user_id,
        p_action: action,
        p_expected_token: token,
        p_action_id: cleanActionId(body.action_id),
      });
      return reply(req, { state: next });
    }
    if (action === "timeout") {
      const next = await gameRpc("blackjack_timeout_service", {
        p_room_id: roomId,
        p_user_id: member.user_id,
      });
      return reply(req, { state: next });
    }
    if (action === "advance_round") {
      const next = await gameRpc("blackjack_advance_service", {
        p_room_id: roomId,
        p_user_id: member.user_id,
        p_deck: shuffledDeck(),
        p_action_id: cleanActionId(body.action_id),
      });
      return reply(req, { state: next });
    }
    if (action === "play_again") {
      const next = await gameRpc("blackjack_play_again_service", {
        p_room_id: roomId,
        p_user_id: member.user_id,
      });
      return reply(req, { state: next });
    }
    if (action === "close_room") {
      await player(roomId, member.user_id);
      const room = await roomById(roomId);
      if (room.host_user_id !== member.user_id) fail("只有房主可以结束房间", 403);
      await admin
        .from("blackjack_rooms")
        .update({
          status: "closed",
          closed_reason: "host_closed",
          finished_at: new Date().toISOString(),
          version: Number(room.version || 0) + 1,
          updated_at: new Date().toISOString(),
          last_activity_at: new Date().toISOString(),
        })
        .eq("id", roomId);
      return reply(req, { closed: true });
    }
    if (action === "leave_room") {
      await player(roomId, member.user_id);
      const room = await roomById(roomId);
      const now = new Date().toISOString();
      if (room.host_user_id === member.user_id) {
        await admin
          .from("blackjack_rooms")
          .update({
            status: "closed",
            closed_reason: "host_left",
            finished_at: now,
            version: Number(room.version || 0) + 1,
            updated_at: now,
            last_activity_at: now,
          })
          .eq("id", roomId);
        return reply(req, { left: true, room_status: "closed" });
      }
      if (room.status === "lobby" || room.status === "finished") {
        await admin
          .from("blackjack_players")
          .update({ active: false, updated_at: now })
          .eq("room_id", roomId)
          .eq("user_id", member.user_id);
        await admin
          .from("blackjack_rooms")
          .update({
            version: Number(room.version || 0) + 1,
            updated_at: now,
            last_activity_at: now,
          })
          .eq("id", roomId);
        return reply(req, { left: true, room_status: room.status });
      }
      await admin
        .from("blackjack_players")
        .update({ active: false, updated_at: now })
        .eq("room_id", roomId)
        .eq("user_id", member.user_id);
      await admin
        .from("blackjack_rooms")
        .update({
          status: "abandoned",
          closed_reason: "player_left",
          finished_at: now,
          version: Number(room.version || 0) + 1,
          updated_at: now,
          last_activity_at: now,
        })
        .eq("id", roomId);
      return reply(req, { left: true, room_status: "abandoned" });
    }

    fail("未知操作", 400, "UNKNOWN_ACTION");
  } catch (error) {
    console.error("blackjack-game", error);
    const e = error as Error & { status?: number; code?: string };
    return reply(req, { error: e.message || "服务器暂时不可用", code: e.code }, e.status || 500);
  }
});
