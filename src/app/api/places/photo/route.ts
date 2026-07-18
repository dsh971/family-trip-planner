import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ref = searchParams.get("ref");
  const maxWidth = searchParams.get("maxWidth") ?? "800";

  if (!ref || ref === "") {
    return NextResponse.json({ error: "ref is required" }, { status: 400 });
  }

  const upstream = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxWidth}&photo_reference=${ref}&key=${process.env.GOOGLE_PLACES_API_KEY}`;

  const upstreamResponse = await fetch(upstream);

  if (!upstreamResponse.ok) {
    return NextResponse.json({ error: "upstream error" }, { status: 502 });
  }

  return new NextResponse(upstreamResponse.body, {
    status: 200,
    headers: {
      "Content-Type":
        upstreamResponse.headers.get("Content-Type") ?? "image/jpeg",
    },
  });
}
