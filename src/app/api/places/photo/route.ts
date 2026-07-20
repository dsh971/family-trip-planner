import { NextResponse } from "next/server";
import { resolvePhotoUrl } from "@/services/discovery/places";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ref = searchParams.get("ref");
  const width = Number(searchParams.get("width") ?? "400");

  if (!ref) {
    return NextResponse.json({ error: "ref required" }, { status: 400 });
  }

  const cdnUrl = await resolvePhotoUrl(ref, width);
  if (!cdnUrl) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  return NextResponse.redirect(cdnUrl, 302);
}
