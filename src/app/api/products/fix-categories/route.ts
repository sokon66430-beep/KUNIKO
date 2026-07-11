import { NextResponse } from "next/server";
import { mutateDB } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// Clean up products whose "category" is actually a numeric code (came in from an
// import where the Category column held a code instead of a name). Those are
// reset to "Uncategorized" so the category filter shows real names, not numbers.
export async function POST() {
  const result = await mutateDB((db) => {
    let fixed = 0;
    const codes = new Set<string>();
    for (const p of db.products) {
      const cat = (p.category || "").trim();
      if (/^\d+$/.test(cat)) {
        codes.add(cat);
        p.category = "Uncategorized";
        fixed++;
      }
    }
    if (fixed > 0) {
      logAudit(db, {
        actor: "Admin",
        action: "Updated",
        entityType: "Product",
        entity: "Category cleanup",
        detail: `Reset ${fixed} products with numeric categories (${[...codes].slice(0, 20).join(", ")})`,
      });
    }
    return { fixed, codes: codes.size };
  });

  return NextResponse.json(result);
}
