import type { OptionGroup, SaleItemOption } from "./types";

/**
 * Condiments — how a made-to-order item is prepared.
 *
 * One place for the rules, because four screens have to agree about them: the
 * till offers the choice, the basket keeps two differently-made bowls apart,
 * the receipt shows the customer what they asked for, and the kitchen ticket
 * tells the cook what to do. If any of those disagreed, the customer would be
 * handed food that doesn't match their receipt.
 */

/**
 * The condiment questions to ask for a product.
 *
 * Chosen PER PRODUCT: only dishes that are actually made to order should stop
 * the cashier with a question, and a category is too blunt for that — a menu
 * category holds bottled drinks next to made-to-order bowls.
 *
 * A group may still name categories as a shortcut for bulk setup; a product's
 * own list wins where both exist. Order follows the store's group list, so the
 * till always asks the questions in the same sequence.
 */
export function groupsForProduct(
  groups: OptionGroup[] | undefined,
  product: { category?: string; optionGroupIds?: string[] } | undefined,
): OptionGroup[] {
  if (!groups?.length || !product) return [];
  const ids = new Set(product.optionGroupIds || []);
  return groups.filter(
    (g) => g.choices.length > 0 && (ids.has(g.id) || (!ids.size && !!product.category && g.categories.includes(product.category))),
  );
}

/** True when the till must ask before this item can go in the basket. */
export function needsChoice(groups: OptionGroup[]): boolean {
  return groups.some((g) => g.required !== false);
}

/**
 * What the options add to ONE unit's price. Nearly always 0 — a spice level is
 * free — but summed here so a chargeable option needs no special case anywhere.
 */
export function optionsPrice(options?: SaleItemOption[]): number {
  if (!options?.length) return 0;
  return Math.round(options.reduce((n, o) => n + (Number(o.priceDelta) || 0), 0) * 100) / 100;
}

/**
 * A stable signature for a set of choices, used in the basket line key.
 *
 * Two bowls of the same noodle at different spice levels must be two lines —
 * merging them would send the kitchen one ticket for a dish that has to be
 * cooked two different ways. Sorted so the key doesn't depend on the order the
 * cashier happened to tap.
 */
export function optionsKey(options?: SaleItemOption[]): string {
  if (!options?.length) return "";
  return options
    .map((o) => `${o.group}=${o.choice}`)
    .sort()
    .join("|");
}

/** One line of human text for a receipt or a kitchen ticket: "Spicy level: 5". */
export function optionsLabel(options?: SaleItemOption[]): string {
  if (!options?.length) return "";
  return options.map((o) => `${o.group}: ${o.choice}`).join(" · ");
}
