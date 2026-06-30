"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, List, Calendar } from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  match: string;
}

interface BottomNavProps {
  tripId: string;
}

export function BottomNav({ tripId }: BottomNavProps) {
  const pathname = usePathname();

  const items: NavItem[] = [
    {
      href: `/trip/${tripId}/discovery`,
      label: "Discover",
      icon: <Compass size={20} />,
      match: "discovery",
    },
    {
      href: `/trip/${tripId}/decisions`,
      label: "My List",
      icon: <List size={20} />,
      match: "decisions",
    },
    {
      href: `/trip/${tripId}/itinerary`,
      label: "Itinerary",
      icon: <Calendar size={20} />,
      match: "itinerary",
    },
  ];

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 h-16 flex items-center border-t"
      style={{ background: "var(--bg-1)", borderColor: "var(--line-1)" }}
    >
      {items.map((item) => {
        const active = pathname.includes(item.match);
        return (
          <Link
            key={item.href}
            href={item.href}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium transition-colors"
            style={{ color: active ? "var(--accent)" : "var(--fg-3)" }}
          >
            {item.icon}
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
