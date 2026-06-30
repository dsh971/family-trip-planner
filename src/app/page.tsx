"use client";

import Link from "next/link";
import { Card, CardBody, Button } from "@sumiui/react";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 pt-16">
      <Card className="w-full max-w-sm">
        <CardBody className="flex flex-col items-center gap-6 py-10 px-6 text-center">
          <h1
            className="text-4xl font-semibold tracking-tight"
            style={{ fontFamily: "var(--font-display)", color: "var(--fg-1)" }}
          >
            FamTripPlanner
          </h1>
          <p className="text-sm" style={{ color: "var(--fg-2)" }}>
            Plan your perfect Tokyo family trip
          </p>
          <Button variant="primary" size="lg" asChild>
            <Link href="/profile">Plan a trip</Link>
          </Button>
        </CardBody>
      </Card>
    </main>
  );
}
