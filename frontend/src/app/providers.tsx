import { ApolloClient, ApolloProvider, HttpLink, InMemoryCache } from "@apollo/client";
import { useEffect, type PropsWithChildren } from "react";
import { BrowserRouter } from "react-router-dom";

const client = new ApolloClient({
  link: new HttpLink({
    uri: import.meta.env.VITE_GRAPHQL_URL ?? "/graphql",
    credentials: "include",
  }),
  cache: new InMemoryCache(),
});

export function AppProviders({ children }: PropsWithChildren) {
  useEffect(() => {
    const clear = () => { void client.clearStore(); };
    window.addEventListener("gentum:database-ready", clear);
    return () => window.removeEventListener("gentum:database-ready", clear);
  }, []);
  return (
    <ApolloProvider client={client}>
      <BrowserRouter>{children}</BrowserRouter>
    </ApolloProvider>
  );
}
