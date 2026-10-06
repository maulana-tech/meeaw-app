/**
 * Fixed-amount payment links were stored with 7 decimals (left over from
 * Stellar USDC) while the app reads them with 6, so every link showed and
 * charged 10x its intended amount. Rescale the stored base units to 6.
 *
 * A 7th decimal digit cannot be represented in 6 decimals; such amounts are
 * rounded down and logged so the owner can re-check those links.
 *
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  const links = db.collection("payment_links");
  const fixed = await links
    .find({ amount: { $type: "string" } }, { projection: { amount: 1 } })
    .toArray();
  for (const link of fixed) {
    const stored = BigInt(link.amount);
    if (stored % 10n !== 0n) {
      console.warn(
        `[migration] payment link ${link._id}: ${link.amount} had a 7th decimal; rounded down`,
      );
    }
    const rescaled = stored / 10n;
    await links.updateOne(
      { _id: link._id, amount: link.amount },
      // A link that rounds to zero can no longer charge anything; make it open.
      { $set: { amount: rescaled > 0n ? rescaled.toString() : null } },
    );
  }
};

/**
 * Lossy for links `up` rounded: their 7th decimal is gone, and links rounded
 * to zero stay open-amount.
 *
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  const links = db.collection("payment_links");
  const fixed = await links
    .find({ amount: { $type: "string" } }, { projection: { amount: 1 } })
    .toArray();
  for (const link of fixed) {
    await links.updateOne(
      { _id: link._id, amount: link.amount },
      { $set: { amount: (BigInt(link.amount) * 10n).toString() } },
    );
  }
};
