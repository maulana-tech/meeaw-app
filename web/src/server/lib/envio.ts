import "server-only";

import { getServerEnv } from "../../env.server";

// Minimal client for the Envio HyperIndex GraphQL API (Hasura-style).

export function envioConfigured(): boolean {
  return Boolean(getServerEnv().ENVIO_GRAPHQL_URL);
}

export class EnvioQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvioQueryError";
  }
}

export async function envioQuery<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const url = getServerEnv().ENVIO_GRAPHQL_URL;
  if (!url) throw new EnvioQueryError("ENVIO_GRAPHQL_URL is not configured.");
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new EnvioQueryError(`Envio responded ${response.status}`);
  }
  const body = (await response.json()) as {
    data?: T;
    errors?: { message: string }[];
  };
  if (body.errors?.length) {
    throw new EnvioQueryError(body.errors.map((e) => e.message).join("; "));
  }
  if (!body.data) throw new EnvioQueryError("Envio returned no data.");
  return body.data;
}

export type EnvioMeta = {
  chainId: number;
  progressBlock: number;
  progressBlockTime: string | number | null;
  isReady: boolean;
};

export type EnvioNote = {
  leafIndex: number;
  commitment: string;
  ephemeralPk: string;
  ciphertext: string;
  blockNumber: number;
  timestamp: number;
  txHash: string;
};

export type EnvioNullifier = {
  nullifier: string;
  blockNumber: number;
  timestamp: number;
};

export type EnvioPoolStats = {
  notes: number;
  spent: number;
  anonymitySet: number;
  withdrawals: number;
  shieldedTransfers: number;
  merges: number;
  totalWithdrawn: string;
  paused: boolean;
  updatedAt: number;
};

// Hasura caps rows per query; page through larger result sets.
const PAGE = 1000;

export async function envioMeta(chainId: number): Promise<EnvioMeta | null> {
  const data = await envioQuery<{ _meta: EnvioMeta[] }>(
    `query Meta($chainId: Int!) {
      _meta(where: { chainId: { _eq: $chainId } }) {
        chainId progressBlock progressBlockTime isReady
      }
    }`,
    { chainId },
  );
  return data._meta[0] ?? null;
}

// Every pool query is filtered by `pool` (`${chainId}:${address}`): several
// pools share one indexer, and leaf indices repeat across them.

export async function envioNotesAfter(
  pool: string,
  afterLeafIndex: number,
  maxBlock: number,
): Promise<EnvioNote[]> {
  const out: EnvioNote[] = [];
  let cursor = afterLeafIndex;
  for (;;) {
    const data = await envioQuery<{ Note: EnvioNote[] }>(
      `query Notes($pool: String!, $after: Int!, $maxBlock: Int!, $limit: Int!) {
        Note(
          where: {
            pool: { _eq: $pool }
            leafIndex: { _gt: $after }
            blockNumber: { _lte: $maxBlock }
          }
          order_by: { leafIndex: asc }
          limit: $limit
        ) { leafIndex commitment ephemeralPk ciphertext blockNumber timestamp txHash }
      }`,
      { pool, after: cursor, maxBlock, limit: PAGE },
    );
    out.push(...data.Note);
    if (data.Note.length < PAGE) return out;
    cursor = data.Note[data.Note.length - 1].leafIndex;
  }
}

export async function envioNullifiersBetween(
  pool: string,
  afterBlock: number,
  maxBlock: number,
): Promise<EnvioNullifier[]> {
  const out: EnvioNullifier[] = [];
  let offset = 0;
  for (;;) {
    const data = await envioQuery<{ Nullifier: EnvioNullifier[] }>(
      `query Spent($pool: String!, $after: Int!, $maxBlock: Int!, $limit: Int!, $offset: Int!) {
        Nullifier(
          where: {
            pool: { _eq: $pool }
            blockNumber: { _gt: $after, _lte: $maxBlock }
          }
          order_by: [{ blockNumber: asc }, { id: asc }]
          limit: $limit
          offset: $offset
        ) { nullifier blockNumber timestamp }
      }`,
      { pool, after: afterBlock, maxBlock, limit: PAGE, offset },
    );
    out.push(...data.Nullifier);
    if (data.Nullifier.length < PAGE) return out;
    offset += PAGE;
  }
}

export async function envioPoolStats(
  pool: string,
): Promise<EnvioPoolStats | null> {
  const data = await envioQuery<{ PoolStats: EnvioPoolStats[] }>(
    `query Stats($pool: ID!) {
      PoolStats(where: { id: { _eq: $pool } }) {
        notes spent anonymitySet withdrawals shieldedTransfers merges
        totalWithdrawn paused updatedAt
      }
    }`,
    { pool },
  );
  return data.PoolStats[0] ?? null;
}

/** Registry accounts, scoped `${chainId}:${registry address}`. */
export async function envioRegistryAccounts(
  registry: string,
): Promise<number | null> {
  const data = await envioQuery<{ RegistryStats: { accounts: number }[] }>(
    `query Registry($registry: ID!) {
      RegistryStats(where: { id: { _eq: $registry } }) { accounts }
    }`,
    { registry },
  );
  return data.RegistryStats[0]?.accounts ?? null;
}
