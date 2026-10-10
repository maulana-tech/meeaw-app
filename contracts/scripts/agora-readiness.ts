import { parsePoolManifest } from "../../web/src/lib/pools";
import { configuredIndexerAddresses } from "./deployment-config";

export function agoraConfiguration(input: {
  chainId: number;
  manifest: string | undefined;
  legacy: Parameters<typeof parsePoolManifest>[0]["legacy"];
  indexer: string;
}) {
  if (!input.manifest) throw new Error("A complete pool manifest is required.");
  const pools = parsePoolManifest({
    manifest: input.manifest,
    chainId: input.chainId,
    legacy: input.legacy,
  });
  const indexed = configuredIndexerAddresses(
    input.indexer,
    input.chainId,
    "Pool",
  ).filter(
    (address) => address !== "0x0000000000000000000000000000000000000000",
  );
  const described = new Set(pools.map((pool) => pool.address.toLowerCase()));
  return {
    pools,
    missingDescriptors: indexed.filter((address) => !described.has(address)),
    notIndexed: [...described].filter((address) => !indexed.includes(address)),
  };
}
