import { and, eq, or } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { createSeedState } from "@/app/data";
import { getDb } from "@/db";
import { partnerships, profiles, syncOperations, userStates } from "@/db/schema";
import { canAccessState } from "@/lib/access.mjs";

export const dynamic = "force-dynamic";

const idForEmail = (email: string) =>
  `profile-${Array.from(new TextEncoder().encode(email.toLowerCase()))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 48)}`;

async function currentProfile() {
  const user = await getChatGPTUser();
  if (!user) return null;

  const db = getDb();
  const id = idForEmail(user.email);
  await db
    .insert(profiles)
    .values({
      id,
      email: user.email.toLowerCase(),
      displayName: user.fullName ?? user.email.split("@")[0],
    })
    .onConflictDoUpdate({
      target: profiles.id,
      set: {
        displayName: user.fullName ?? user.email.split("@")[0],
        updatedAt: new Date().toISOString(),
      },
    });
  return {
    id,
    email: user.email.toLowerCase(),
    name: user.fullName ?? user.email.split("@")[0],
  };
}

async function partnerIdFor(ownerId: string) {
  const db = getDb();
  const [link] = await db
    .select()
    .from(partnerships)
    .where(
      and(
        eq(partnerships.status, "active"),
        or(
          eq(partnerships.inviterId, ownerId),
          eq(partnerships.partnerId, ownerId),
        ),
      ),
    )
    .limit(1);
  if (!link) return null;
  return link.inviterId === ownerId ? link.partnerId : link.inviterId;
}

export async function GET(request: Request) {
  try {
    const profile = await currentProfile();
    if (!profile) {
      return Response.json({ error: "Требуется вход" }, { status: 401 });
    }

    const url = new URL(request.url);
    const wantsPartner = url.searchParams.get("profile") === "partner";
    const linkedPartnerId = await partnerIdFor(profile.id);
    const ownerId = wantsPartner ? linkedPartnerId : profile.id;
    if (!ownerId) {
      return Response.json({ state: null, partner: null });
    }
    if (
      !canAccessState({
        requesterId: profile.id,
        ownerId,
        linkedPartnerId,
        write: false,
      })
    ) {
      return Response.json({ error: "Доступ запрещён" }, { status: 403 });
    }

    const db = getDb();
    const [owner] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, ownerId))
      .limit(1);
    const [stored] = await db
      .select()
      .from(userStates)
      .where(eq(userStates.ownerId, ownerId))
      .limit(1);

    const state = stored
      ? JSON.parse(stored.payload)
      : createSeedState(
          owner?.displayName ?? profile.name,
          owner?.email ?? profile.email,
        );

    return Response.json({
      state,
      updatedAt: stored?.updatedAt ?? null,
      partner: wantsPartner
        ? { name: owner?.displayName ?? "Партнёр" }
        : null,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Не удалось загрузить данные",
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const profile = await currentProfile();
    if (!profile) {
      return Response.json({ error: "Требуется вход" }, { status: 401 });
    }

    const body = (await request.json()) as {
      state?: unknown;
      operationId?: string;
      version?: number;
    };
    if (!body.state || !body.operationId) {
      return Response.json({ error: "Некорректные данные" }, { status: 400 });
    }
    if (
      !canAccessState({
        requesterId: profile.id,
        ownerId: profile.id,
        write: true,
      })
    ) {
      return Response.json({ error: "Доступ запрещён" }, { status: 403 });
    }

    const db = getDb();
    const [seen] = await db
      .select({ id: syncOperations.id })
      .from(syncOperations)
      .where(eq(syncOperations.id, body.operationId))
      .limit(1);
    if (seen) {
      return Response.json({ synced: true, duplicate: true });
    }

    const now = new Date().toISOString();
    await db.batch([
      db
        .insert(userStates)
        .values({
          ownerId: profile.id,
          payload: JSON.stringify(body.state),
          version: body.version ?? 1,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: userStates.ownerId,
          set: {
            payload: JSON.stringify(body.state),
            version: body.version ?? 1,
            updatedAt: now,
          },
        }),
      db
        .insert(syncOperations)
        .values({ id: body.operationId, ownerId: profile.id }),
    ]);

    return Response.json({ synced: true, updatedAt: now });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось синхронизировать данные",
      },
      { status: 500 },
    );
  }
}
