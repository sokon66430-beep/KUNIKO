import RecipesManager from "@/components/RecipesManager";

// Recipes are managed on Master Data now, so this route is off the sidebar. It
// stays because the screen itself is per-role (store leadership can write a
// recipe; Master Data is owner-only), and because old links shouldn't 404.
export default function RecipesPage() {
  return <RecipesManager />;
}
