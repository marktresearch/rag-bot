"use client";

import { useState, type ReactNode } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";

type ConvexClientProviderProps = {
  children: ReactNode;
};

export default function ConvexClientProvider({
  children,
}: ConvexClientProviderProps) {
  const [client] = useState(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url) {
      throw new Error("NEXT_PUBLIC_CONVEX_URL is not defined");
    }

    return new ConvexReactClient(url);
  });

  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
