import PromotionsManager from "@/components/PromotionsManager";

// Promotions are managed on Master Data now, so this route is off the sidebar.
// It stays for the same reasons as /recipes: the screen is per-role, and old
// links shouldn't 404.
export default function DealsPage() {
  return <PromotionsManager />;
}
