import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { familyProfiles } from "@/db/schema";
import { validateProfile } from "@/services/profile/validation";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = validateProfile(body);
  if (!result.valid) {
    return NextResponse.json({ errors: result.errors }, { status: 400 });
  }

  const db = getDb();
  const rows = db
    .insert(familyProfiles)
    .values({
      adultCount: result.data!.adultCount,
      children: result.data!.children,
      dietaryTags: result.data!.dietaryTags,
      accessibilityTags: result.data!.accessibilityTags,
      pacingWindows: result.data!.pacingWindows,
    })
    .returning()
    .all();

  return NextResponse.json(rows[0], { status: 201 });
}
