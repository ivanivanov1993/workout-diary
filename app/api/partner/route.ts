import { and, eq, or } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { partnerships, profiles } from "@/db/schema";

export const dynamic = "force-dynamic";

const idForEmail = (email: string) =>
  `profile-${Array.from(new TextEncoder().encode(email.toLowerCase()))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 48)}`;

const randomCode = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((value) => (value % 36).toString(36))
    .join("")
    .toUpperCase();

async function profileForRequest() {
  const user = await getChatGPTUser();
  if (!user) return null;
  const db = getDb();
  const profile = {
    id: idForEmail(user.email),
    email: user.email.toLowerCase(),
    name: user.fullName ?? user.email.split("@")[0],
  };
  await db
    .insert(profiles)
    .values({
      id: profile.id,
      email: profile.email,
      displayName: profile.name,
    })
    .onConflictDoNothing();
  return profile;
}

export async function GET() {
  try {
    const profile = await profileForRequest();
    if (!profile) return Response.json({ error: "Требуется вход" }, { status: 401 });
    const db = getDb();
    const [link] = await db
      .select()
      .from(partnerships)
      .where(
        or(
          eq(partnerships.inviterId, profile.id),
          eq(partnerships.partnerId, profile.id),
        ),
      )
      .limit(1);
    if (!link) return Response.json({ partnership: null });

    const partnerId =
      link.inviterId === profile.id ? link.partnerId : link.inviterId;
    const [partner] = partnerId
      ? await db
          .select()
          .from(profiles)
          .where(eq(profiles.id, partnerId))
          .limit(1)
      : [];
    return Response.json({
      partnership: {
        status: link.status,
        inviteCode: link.inviterId === profile.id ? link.inviteCode : null,
        partnerName: partner?.displayName ?? null,
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Ошибка связи" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const profile = await profileForRequest();
    if (!profile) return Response.json({ error: "Требуется вход" }, { status: 401 });
    const body = (await request.json()) as { action?: string; code?: string };
    const db = getDb();

    const [existing] = await db
      .select()
      .from(partnerships)
      .where(
        or(
          eq(partnerships.inviterId, profile.id),
          eq(partnerships.partnerId, profile.id),
        ),
      )
      .limit(1);

    if (body.action === "create") {
      if (existing) {
        return Response.json({
          partnership: {
            status: existing.status,
            inviteCode: existing.inviteCode,
          },
        });
      }
      const inviteCode = randomCode();
      await db.insert(partnerships).values({
        id: crypto.randomUUID(),
        inviterId: profile.id,
        inviteCode,
      });
      return Response.json({
        partnership: { status: "pending", inviteCode },
      });
    }

    if (body.action === "accept" && body.code) {
      if (existing) {
        return Response.json(
          { error: "Профиль уже связан с партнёром" },
          { status: 409 },
        );
      }
      const [invitation] = await db
        .select()
        .from(partnerships)
        .where(
          and(
            eq(partnerships.inviteCode, body.code.trim().toUpperCase()),
            eq(partnerships.status, "pending"),
          ),
        )
        .limit(1);
      if (!invitation || invitation.inviterId === profile.id) {
        return Response.json(
          { error: "Приглашение не найдено" },
          { status: 404 },
        );
      }
      await db
        .update(partnerships)
        .set({
          partnerId: profile.id,
          status: "active",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(partnerships.id, invitation.id));
      return Response.json({ partnership: { status: "active" } });
    }

    if (body.action === "unlink" && existing) {
      await db.delete(partnerships).where(eq(partnerships.id, existing.id));
      return Response.json({ partnership: null });
    }

    return Response.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Ошибка связи" },
      { status: 500 },
    );
  }
}
