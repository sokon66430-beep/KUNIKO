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

/** The groups that apply to a product, by its category. */
export function groupsForCategory(groups: OptionGroup[] | undefined, category?: string): OptionGroup[] {
  if (!groups?.length || !category) return [];
  return groups.filter((g) => g.choices.length > 0 && g.categories.includes(category));
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
